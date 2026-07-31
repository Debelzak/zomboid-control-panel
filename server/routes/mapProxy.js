import express from "express";
import { createLogger } from "../utils/logger.js";
const log = createLogger("API:MapProxy");

const router = express.Router();

// ─── B42 map version resolution ──────────────────────────────────────────────
// b42map.com has migrated to map.projectzomboid.com. Tiles are now served at
// https://map.projectzomboid.com/maps/<version>/base/layer<floor>_files/<level>/<tile>
// We resolve the latest B42 version directory dynamically from build_list.json
// so tile loading stays current when PZ ships new map builds without a panel update.
const PZ_MAP_ROOT = "https://map.projectzomboid.com";
const B42_DIR_FALLBACK = "42.19.0";
const B42_DIR_TTL_MS = 24 * 60 * 60 * 1000; // re-resolve at most once per 24 h
// Geometry of B42_DIR_FALLBACK, used only when layer0.dzi can't be fetched.
const B42_GEOMETRY_FALLBACK = {
  tileSize: 1024,
  width: 1157312,
  height: 509520,
  maxLevel: 21,
};
// Map builds are not all rendered at the same resolution: 42.19.0 is
// TileSize=1024 / 1157312x509520, while 42.20.0 doubled to TileSize=2048 /
// 2318656x1019040. Nothing about the geometry can be assumed, so read it from
// the build's own DZI descriptor and hand it to the client.
async function fetchMapGeometry(directory) {
  try {
    const resp = await fetch(
      `${PZ_MAP_ROOT}/maps/${directory}/base/layer0.dzi`,
      {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent":
            "ZomboidControlPanel/1.0 (+https://github.com/fpsacha/zomboid-control-panel)",
        },
      },
    );
    if (!resp.ok) return null;
    const xml = await resp.text();
    const tileSize = Number(xml.match(/TileSize="(\d+)"/)?.[1]);
    const width = Number(xml.match(/Width="(\d+)"/)?.[1]);
    const height = Number(xml.match(/Height="(\d+)"/)?.[1]);
    if (!tileSize || !width || !height) return null;
    return {
      tileSize,
      width,
      height,
      maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
    };
  } catch {
    return null;
  }
}

// A brand-new PZ build's tiles can be listed as the "default" entry in
// build_list.json before map.projectzomboid.com has actually finished
// rendering full world coverage for it. Probing a few inhabited-area tiles
// lets us detect "listed but not rendered yet" and fall back to the previous
// build instead of showing an empty map.
//
// The probe coordinates are derived from the build's own geometry rather than
// hardcoded: a fixed `15/9_3.jpg`-style path is only meaningful for a
// TileSize=1024 build and silently false-negatives on a 2048 one, which would
// pin every install to an outdated build forever.
const COVERAGE_PROBE_FRACTIONS = [
  [0.51, 0.4],
  [0.56, 0.45],
  [0.61, 0.5],
];
let _b42Map = null;
let _b42DirFetchedAt = 0;

async function hasTileCoverage(directory, geometry) {
  const level = Math.max(0, geometry.maxLevel - 6);
  const levelScale = 2 ** (geometry.maxLevel - level);
  const levelW = Math.ceil(geometry.width / levelScale);
  const levelH = Math.ceil(geometry.height / levelScale);
  for (const [fx, fy] of COVERAGE_PROBE_FRACTIONS) {
    const col = Math.floor((levelW * fx) / geometry.tileSize);
    const row = Math.floor((levelH * fy) / geometry.tileSize);
    try {
      const resp = await fetch(
        `${PZ_MAP_ROOT}/maps/${directory}/base/layer0_files/${level}/${col}_${row}.jpg`,
        {
          method: "HEAD",
          signal: AbortSignal.timeout(4000),
          headers: {
            "User-Agent":
              "ZomboidControlPanel/1.0 (+https://github.com/fpsacha/zomboid-control-panel)",
          },
        },
      );
      if (resp.ok) return true;
    } catch {
      // Treat as not-covered and try the next probe tile.
    }
  }
  return false;
}

async function getB42Map() {
  const now = Date.now();
  if (_b42Map && now - _b42DirFetchedAt < B42_DIR_TTL_MS) {
    return _b42Map;
  }
  try {
    const resp = await fetch(`${PZ_MAP_ROOT}/build_list.json`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "ZomboidControlPanel/1.0 (+https://github.com/fpsacha/zomboid-control-panel)",
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const list = await resp.json();
    // Entries are ordered newest-first. Walk B42+ candidates until one
    // actually has rendered tile coverage, not just a build_list.json entry.
    const candidates = Array.isArray(list)
      ? list.filter((e) => /^4[2-9]\./.test(e.directory || ""))
      : [];
    for (const entry of candidates) {
      if (!entry?.directory) continue;
      const geometry = await fetchMapGeometry(entry.directory);
      if (!geometry) {
        log.warn(
          `B42 map directory ${entry.directory} has no readable layer0.dzi — trying older build.`,
        );
        continue;
      }
      if (await hasTileCoverage(entry.directory, geometry)) {
        if (_b42Map?.directory !== entry.directory) {
          log.info(
            `B42 map directory resolved: ${entry.directory} (${geometry.width}x${geometry.height}, tile ${geometry.tileSize}, max level ${geometry.maxLevel})`,
          );
        }
        _b42Map = { directory: entry.directory, ...geometry };
        _b42DirFetchedAt = now;
        return _b42Map;
      }
      log.warn(
        `B42 map directory ${entry.directory} listed but has no rendered tile coverage yet — trying older build.`,
      );
    }
  } catch (err) {
    log.warn(
      `Failed to resolve B42 map directory from build_list.json: ${err.message}. Falling back to ${_b42Map?.directory || B42_DIR_FALLBACK}.`,
    );
  }
  _b42Map = _b42Map || { directory: B42_DIR_FALLBACK, ...B42_GEOMETRY_FALLBACK };
  return _b42Map;
}

async function getB42Dir() {
  return (await getB42Map()).directory;
}

// Max time we'll wait for an upstream tile fetch. Without this a slow/dead
// upstream can hold an Express handler open forever, eventually starving the
// pool on a busy map view.
const TILE_FETCH_TIMEOUT_MS = 10_000;

// ─── Circuit breaker for the upstream tile hosts ─────────────────────────
// Without this, a truly dead upstream (e.g. a Cloudflare outage on the map
// host) makes EVERY tile request pay the full timeout+retry cost
// (~10-20s each) with no backpressure, and the map view fires dozens of
// tile requests per pan/zoom — piling up slow handlers. After enough
// consecutive failures we fail fast for a cooldown instead of continuing to
// hammer (and wait on) a host that's already down.
const CIRCUIT_FAILURE_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 30_000;
let circuitConsecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}

function recordTileSuccess() {
  circuitConsecutiveFailures = 0;
}

function recordTileFailure() {
  circuitConsecutiveFailures++;
  if (
    circuitConsecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD &&
    !isCircuitOpen()
  ) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    log.warn(
      `Tile proxy circuit breaker OPEN for ${CIRCUIT_COOLDOWN_MS / 1000}s after ${circuitConsecutiveFailures} consecutive upstream failures`,
    );
  }
}

// In-memory cache for successfully fetched tiles. The map UI loads dozens of
// tiles per pan/zoom and Cloudflare on the upstream domains will rate-limit
// us if we re-fetch the same tile every refresh. Cached tiles are tiny
// (~5–40 KB each) so even a 500-entry cache stays under ~20 MB.
const TILE_CACHE_MAX = 500;
const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const tileCache = new Map(); // url -> { buffer, contentType, cachedAt }

function getCachedTile(url) {
  const entry = tileCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TILE_CACHE_TTL_MS) {
    tileCache.delete(url);
    return null;
  }
  // Refresh LRU position
  tileCache.delete(url);
  tileCache.set(url, entry);
  return entry;
}

function putCachedTile(url, buffer, contentType) {
  if (tileCache.size >= TILE_CACHE_MAX) {
    // Drop oldest entry (Map iterates in insertion order)
    const oldestKey = tileCache.keys().next().value;
    if (oldestKey !== undefined) tileCache.delete(oldestKey);
  }
  tileCache.set(url, { buffer, contentType, cachedAt: Date.now() });
}

async function fetchTileWithTimeout(url) {
  // Node 18+ supports AbortSignal.timeout; older runtimes throw a TypeError
  // which propagates to the caller's catch block and is surfaced as a 502
  // (same shape as any network error).
  return fetch(url, {
    signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
    headers: {
      // Some upstreams (Cloudflare on b42map.com) return 403/503 when the
      // User-Agent header is missing entirely. Send a neutral identifier.
      "User-Agent":
        "ZomboidControlPanel/1.0 (+https://github.com/fpsacha/zomboid-control-panel)",
      Accept: "image/*,*/*;q=0.8",
    },
  });
}

// Fetch with one retry on transient upstream failures (502/503/504/network).
// 404 is NOT retried — it just means the tile is outside the map bounds.
async function fetchTileWithRetry(url) {
  if (isCircuitOpen()) {
    throw new Error(
      "Tile proxy circuit breaker is open (upstream has been failing repeatedly)",
    );
  }
  try {
    const r = await fetchTileWithTimeout(url);
    if (r.ok || r.status === 404) {
      recordTileSuccess();
      return r;
    }
    if (r.status >= 500 && r.status < 600) {
      // Brief backoff before single retry — Cloudflare 503 on rate-limit
      // typically clears within a few hundred ms.
      await new Promise((res) => setTimeout(res, 250));
      const retried = await fetchTileWithTimeout(url);
      if (retried.ok || retried.status === 404) recordTileSuccess();
      else recordTileFailure();
      return retried;
    }
    // Other 4xx (not 404) isn't a "broken upstream" signal — don't count it
    // toward the circuit breaker.
    return r;
  } catch (err) {
    try {
      await new Promise((res) => setTimeout(res, 250));
      const retried = await fetchTileWithTimeout(url);
      if (retried.ok || retried.status === 404) recordTileSuccess();
      else recordTileFailure();
      return retried;
    } catch (retryErr) {
      recordTileFailure();
      throw retryErr;
    }
  }
}

async function serveTile(req, res, url, contentType) {
  // Cache hit — serve from memory, no upstream call.
  const cached = getCachedTile(url);
  if (cached) {
    res.set("Content-Type", cached.contentType);
    res.set("Cache-Control", "public, max-age=604800"); // 7 days
    res.set("X-Tile-Cache", "hit");
    res.send(cached.buffer);
    return;
  }
  try {
    const response = await fetchTileWithRetry(url);
    if (!response.ok) {
      // Pass 404 through quietly — that's "tile out of map bounds", not an error.
      // Map upstream 5xx to 502 so the client knows the panel itself is fine.
      const status =
        response.status === 404
          ? 404
          : response.status >= 500
            ? 502
            : response.status;
      return res.status(status).end();
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    putCachedTile(url, buffer, contentType);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=604800");
    res.set("X-Tile-Cache", "miss");
    res.send(buffer);
  } catch (err) {
    log.debug(`Tile proxy failed for ${url}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
  }
}

// Geometry of the B42 build currently being proxied. The client needs this to
// address tiles correctly — tile size and full-res dimensions differ between
// map builds, so neither side can hardcode them.
router.get("/info", async (req, res) => {
  const map = await getB42Map();
  res.set("Cache-Control", "public, max-age=3600");
  res.json(map);
});

// Proxy DZI tiles from map.projectzomboid.com (migrated from b42map.com) to
// avoid CORS restrictions. Resolves the latest B42 map directory dynamically
// from build_list.json so new PZ map builds are picked up automatically.
// Validates inputs to prevent SSRF — only allows numeric level 0-22,
// floor -17..30, and tile filenames matching the DZI convention.
router.get("/tiles/:level/:tile", async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;
  const floorRaw = Array.isArray(req.query.floor)
    ? req.query.floor[0]
    : req.query.floor;
  const floor = parseInt(String(floorRaw ?? "0"), 10);

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: "Invalid level" });
  }
  // Client clamps floor to -17..29 (WorldMap.tsx changeFloor); keep the
  // backend in sync so anything outside the real range is rejected early.
  if (isNaN(floor) || floor < -17 || floor > 29) {
    return res.status(400).json({ error: "Invalid floor" });
  }
  // layer0 uses jpg, all other layers use webp
  const ext = floor === 0 ? "jpg" : "webp";
  if (!new RegExp(`^\\d+_\\d+\\.${ext}$`).test(tile)) {
    return res.status(400).json({ error: "Invalid tile" });
  }

  const dir = await getB42Dir();
  const url = `${PZ_MAP_ROOT}/maps/${dir}/base/layer${floor}_files/${level}/${tile}`;
  const contentType = floor === 0 ? "image/jpeg" : "image/webp";
  await serveTile(req, res, url, contentType);
});

// Proxy B42 top-down DZI tiles (used by ChunkCleaner for overhead map view).
// These tiles use webp format at all levels.
// Only floor 0 is available in the top-down view.
router.get("/toptiles/:level/:tile", async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: "Invalid level" });
  }
  if (!/^\d+_\d+\.webp$/.test(tile)) {
    return res.status(400).json({ error: "Invalid tile" });
  }

  const dir = await getB42Dir();
  const url = `${PZ_MAP_ROOT}/maps/${dir}/base_top/layer0_files/${level}/${tile}`;
  await serveTile(req, res, url, "image/webp");
});

// Proxy B41 DZI tiles from map.projectzomboid.com
router.get("/b41tiles/:level/:tile", async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: "Invalid level" });
  }
  if (!/^\d+_\d+\.jpg$/.test(tile)) {
    return res.status(400).json({ error: "Invalid tile" });
  }

  const url = `https://map.projectzomboid.com/maps/SurvivalB417812L0/map_files/${level}/${tile}`;
  await serveTile(req, res, url, "image/jpeg");
});

export default router;
