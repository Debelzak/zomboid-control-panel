import express from "express";
import fs from "fs";
import path from "path";
import { createLogger } from "../utils/logger.js";
import { getDataPaths } from "../utils/paths.js";
const log = createLogger("API:MapProxy");

const router = express.Router();

// ─── Persistent disk-backed tile cache ───────────────────────────────────
// A given PZ map build's tiles never change once published, so unlike a
// typical HTTP cache these never need to expire — once a tile has been
// fetched from map.projectzomboid.com it's cached on disk indefinitely.
// Over time this turns the proxy into a self-hosted mirror of whatever
// parts of the map players have actually looked at, with zero upfront
// download and no dependency on the upstream host for anything already
// cached. A small in-memory LRU sits in front of disk to avoid a
// filesystem read on every request for hot tiles.
const TILE_CACHE_DIR = path.join(getDataPaths().dataDir, "map-tiles-cache");
const MEM_CACHE_MAX = 500;
const memCache = new Map(); // relPath -> { buffer, contentType }

function memCacheGet(relPath) {
  const entry = memCache.get(relPath);
  if (!entry) return null;
  // Refresh LRU position
  memCache.delete(relPath);
  memCache.set(relPath, entry);
  return entry;
}

function memCachePut(relPath, buffer, contentType) {
  if (memCache.size >= MEM_CACHE_MAX) {
    const oldestKey = memCache.keys().next().value;
    if (oldestKey !== undefined) memCache.delete(oldestKey);
  }
  memCache.set(relPath, { buffer, contentType });
}

function diskPathFor(relPath) {
  return path.join(TILE_CACHE_DIR, relPath);
}

async function readDiskCache(relPath) {
  try {
    return await fs.promises.readFile(diskPathFor(relPath));
  } catch {
    return null;
  }
}

// Fire-and-forget: a disk cache write failing (permissions, full disk) just
// means we re-fetch from upstream next time — never block the response on it.
function writeDiskCacheAsync(relPath, buffer) {
  const dest = diskPathFor(relPath);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.promises
    .mkdir(path.dirname(dest), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, buffer))
    .then(() => fs.promises.rename(tmp, dest))
    .catch((err) => {
      log.debug(`Disk tile cache write failed for ${relPath}: ${err.message}`);
      fs.promises.unlink(tmp).catch(() => {});
    });
}

// ─── B42 map version resolution ──────────────────────────────────────────────
// b42map.com has migrated to map.projectzomboid.com. Tiles are now served at
// https://map.projectzomboid.com/maps/<version>/base/layer<floor>_files/<level>/<tile>
// We resolve the latest B42 version directory dynamically from build_list.json
// so tile loading stays current when PZ ships new map builds without a panel update.
const PZ_MAP_ROOT = "https://map.projectzomboid.com";
const B42_DIR_FALLBACK = "42.19.0";
const B42_DIR_TTL_MS = 24 * 60 * 60 * 1000; // re-resolve at most once per 24 h
let _b42Dir = null;
let _b42DirFetchedAt = 0;

async function getB42Dir() {
  const now = Date.now();
  if (_b42Dir && now - _b42DirFetchedAt < B42_DIR_TTL_MS) {
    return _b42Dir;
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
    // Entries are ordered newest-first. Find the first B42+ entry.
    // The full string (not just a prefix) must match a plain version
    // pattern — this now also becomes a disk cache path segment, so a
    // malformed/adversarial value from upstream must never reach fs calls.
    const entry =
      Array.isArray(list) &&
      list.find((e) => /^4[2-9][\w.\-]*$/.test(e.directory || ""));
    if (entry?.directory) {
      if (_b42Dir !== entry.directory) {
        log.info(`B42 map directory resolved: ${entry.directory}`);
      }
      _b42Dir = entry.directory;
      _b42DirFetchedAt = now;
      return _b42Dir;
    }
  } catch (err) {
    log.warn(
      `Failed to resolve B42 map directory from build_list.json: ${err.message}. Falling back to ${_b42Dir || B42_DIR_FALLBACK}.`,
    );
  }
  _b42Dir = _b42Dir || B42_DIR_FALLBACK;
  return _b42Dir;
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

async function serveTile(req, res, url, contentType, relPath) {
  // Tier 1: in-memory LRU — fastest, no I/O at all.
  const hot = memCacheGet(relPath);
  if (hot) {
    res.set("Content-Type", hot.contentType);
    res.set("Cache-Control", "public, max-age=604800"); // 7 days
    res.set("X-Tile-Cache", "hit-mem");
    res.send(hot.buffer);
    return;
  }

  // Tier 2: disk — this PZ map version's tiles are immutable, so a disk hit
  // means we never have to touch map.projectzomboid.com for this tile again.
  const onDisk = await readDiskCache(relPath);
  if (onDisk) {
    memCachePut(relPath, onDisk, contentType);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=604800");
    res.set("X-Tile-Cache", "hit-disk");
    res.send(onDisk);
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
    memCachePut(relPath, buffer, contentType);
    writeDiskCacheAsync(relPath, buffer);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=604800");
    res.set("X-Tile-Cache", "miss");
    res.send(buffer);
  } catch (err) {
    log.debug(`Tile proxy failed for ${url}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
  }
}

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
  const relPath = path.join("b42", dir, `layer${floor}`, String(level), tile);
  await serveTile(req, res, url, contentType, relPath);
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
  const relPath = path.join("b42-top", dir, String(level), tile);
  await serveTile(req, res, url, "image/webp", relPath);
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
  const relPath = path.join("b41", String(level), tile);
  await serveTile(req, res, url, "image/jpeg", relPath);
});

export default router;
