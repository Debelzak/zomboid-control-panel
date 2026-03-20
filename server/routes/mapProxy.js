import express from 'express';

const router = express.Router();

// Proxy DZI tiles from b42map.com to avoid CORS restrictions.
// Validates inputs to prevent SSRF — only allows numeric level 0-22
// and tile filenames matching the DZI convention ({col}_{row}.jpg).
router.get('/tiles/:level/:tile', async (req, res) => {
  const level = parseInt(req.params.level, 10);
  const tile = req.params.tile;

  if (isNaN(level) || level < 0 || level > 22) {
    return res.status(400).json({ error: 'Invalid level' });
  }
  if (!/^\d+_\d+\.jpg$/.test(tile)) {
    return res.status(400).json({ error: 'Invalid tile' });
  }

  const url = `https://b42map.com/map_data/base/layer0_files/${level}/${tile}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).end();
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    res.status(502).end();
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
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).end();
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    res.status(502).end();
  }
});

export default router;
