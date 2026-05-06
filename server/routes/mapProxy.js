import express from 'express';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:MapProxy');

const router = express.Router();

// Max time we'll wait for an upstream tile fetch. Without this a slow/dead
// upstream can hold an Express handler open forever, eventually starving the
// pool on a busy map view.
const TILE_FETCH_TIMEOUT_MS = 10_000;

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
      'User-Agent': 'ZomboidControlPanel/1.0 (+https://github.com/fpsacha/zomboid-control-panel)',
      'Accept': 'image/*,*/*;q=0.8',
    },
  });
}

// Fetch with one retry on transient upstream failures (502/503/504/network).
// 404 is NOT retried — it just means the tile is outside the map bounds.
async function fetchTileWithRetry(url) {
  try {
    const r = await fetchTileWithTimeout(url);
    if (r.ok || r.status === 404) return r;
    if (r.status >= 500 && r.status < 600) {
      // Brief backoff before single retry — Cloudflare 503 on rate-limit
      // typically clears within a few hundred ms.
      await new Promise(res => setTimeout(res, 250));
      return await fetchTileWithTimeout(url);
    }
    return r;
  } catch (err) {
    await new Promise(res => setTimeout(res, 250));
    return await fetchTileWithTimeout(url);
  }
}

async function serveTile(req, res, url, contentType) {
  // Cache hit — serve from memory, no upstream call.
  const cached = getCachedTile(url);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
    res.set('X-Tile-Cache', 'hit');
    res.send(cached.buffer);
    return;
  }
  try {
    const response = await fetchTileWithRetry(url);
    if (!response.ok) {
      // Pass 404 through quietly — that's "tile out of map bounds", not an error.
      // Map upstream 5xx to 502 so the client knows the panel itself is fine.
      const status = response.status === 404 ? 404 : (response.status >= 500 ? 502 : response.status);
      return res.status(status).end();
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    putCachedTile(url, buffer, contentType);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    res.set('X-Tile-Cache', 'miss');
    res.send(buffer);
  } catch (err) {
    log.debug(`Tile proxy failed for ${url}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
  }
}

// Proxy DZI tiles from b42map.com to avoid CORS restrictions.
// Validates inputs to prevent SSRF — only allows numeric level 0-22,
// floor -17..30, and tile filenames matching the DZI convention.
router.get('/tiles/:level/:tile', async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;
  const floorRaw = Array.isArray(req.query.floor) ? req.query.floor[0] : req.query.floor;
  const floor = parseInt(String(floorRaw ?? '0'), 10);

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: 'Invalid level' });
  }
  // Client clamps floor to -17..29 (WorldMap.tsx changeFloor); keep the
  // backend in sync so anything outside the real range is rejected early.
  if (isNaN(floor) || floor < -17 || floor > 29) {
    return res.status(400).json({ error: 'Invalid floor' });
  }
  // layer0 uses jpg, all other layers use webp
  const ext = floor === 0 ? 'jpg' : 'webp';
  if (!new RegExp(`^\\d+_\\d+\\.${ext}$`).test(tile)) {
    return res.status(400).json({ error: 'Invalid tile' });
  }

  const url = `https://b42map.com/map_data/base/layer${floor}_files/${level}/${tile}`;
  const contentType = floor === 0 ? 'image/jpeg' : 'image/webp';
  await serveTile(req, res, url, contentType);
});

// Proxy B41 DZI tiles from map.projectzomboid.com
router.get('/b41tiles/:level/:tile', async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: 'Invalid level' });
  }
  if (!/^\d+_\d+\.jpg$/.test(tile)) {
    return res.status(400).json({ error: 'Invalid tile' });
  }

  const url = `https://map.projectzomboid.com/maps/SurvivalB417812L0/map_files/${level}/${tile}`;
  await serveTile(req, res, url, 'image/jpeg');
});

export default router;

