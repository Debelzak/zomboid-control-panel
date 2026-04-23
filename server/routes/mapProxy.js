import express from 'express';
import { createLogger } from '../utils/logger.js';
const log = createLogger('API:MapProxy');

const router = express.Router();

// Max time we'll wait for an upstream tile fetch. Without this a slow/dead
// upstream can hold an Express handler open forever, eventually starving the
// pool on a busy map view.
const TILE_FETCH_TIMEOUT_MS = 10_000;

async function fetchTileWithTimeout(url) {
  // Node 18+ supports AbortSignal.timeout; older runtimes would throw a
  // TypeError which we catch and surface as a 502 (same as any network error).
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) });
  } catch (err) {
    // Normalise timeout/abort errors so the caller can log them uniformly.
    throw err;
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
  if (isNaN(floor) || floor < -17 || floor > 30) {
    return res.status(400).json({ error: 'Invalid floor' });
  }
  // layer0 uses jpg, all other layers use webp
  const ext = floor === 0 ? 'jpg' : 'webp';
  if (!new RegExp(`^\\d+_\\d+\\.${ext}$`).test(tile)) {
    return res.status(400).json({ error: 'Invalid tile' });
  }

  const url = `https://b42map.com/map_data/base/layer${floor}_files/${level}/${tile}`;
  try {
    const response = await fetchTileWithTimeout(url);
    if (!response.ok) {
      return res.status(response.status).end();
    }
    res.set('Content-Type', floor === 0 ? 'image/jpeg' : 'image/webp');
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    log.debug(`B42 tile proxy failed for floor${floor}/${level}/${tile}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
  }
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
  try {
    const response = await fetchTileWithTimeout(url);
    if (!response.ok) {
      return res.status(response.status).end();
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    log.debug(`B41 tile proxy failed for ${level}/${tile}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
  }
});

export default router;
