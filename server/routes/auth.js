/**
 * Auth Routes — /api/auth/*
 * Handles login, setup, token refresh, and auth status.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import authService from '../services/auth.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeError } from '../utils/sanitize.js';
import { getDataPaths } from '../utils/paths.js';

const log = createLogger('Auth');
const router = Router();

// Latched Secure flag: once we've seen HTTPS (env or runtime), always issue Secure cookies
// to prevent downgrade attacks where a subsequent HTTP request re-sets the cookie insecurely.
const forceSecureCookies = process.env.HTTPS === 'true' || process.env.FORCE_HSTS === 'true';
let secureCookieLatch = forceSecureCookies;

function getRefreshCookieOptions(req, includeMaxAge = true) {
  const requestIsSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (requestIsSecure) secureCookieLatch = true;
  return {
    httpOnly: true,
    secure: secureCookieLatch,
    sameSite: 'strict',
    path: '/api/auth',
    ...(includeMaxAge ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authService.authenticateAccessToken(authHeader.substring(7));
}

// Strict rate limit on login attempts — 5 per minute per IP
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

/**
 * GET /api/auth/status
 * Returns whether setup is needed and if auth is enabled.
 * This is always accessible (no auth required).
 */
router.get('/status', async (req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    const authEnabled = await authService.isAuthEnabled();
    res.json({ needsSetup, authEnabled });
  } catch (error) {
    log.error(`Failed to get auth status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get auth status' });
  }
});

// Setup rate limit — prevent brute-force account creation on fresh VPS installs
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many setup attempts. Please try again later.' },
});

/**
 * POST /api/auth/setup
 * First-run account creation. Only works if no users exist.
 */
router.post('/setup', setupLimiter, async (req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    if (!needsSetup) {
      return res.status(400).json({ error: 'Setup already completed. Use login instead.' });
    }

    const { username, password, rememberMe = false } = req.body || {};
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await authService.createUser(username, password);

    // Auto-login after setup — generate tokens
    const result = await authService.login(username, password, rememberMe === true);

    // Set refresh token as httpOnly cookie
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(req));
    }

    log.info(`Setup complete — admin account created: ${username}`);
    res.status(201).json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    log.error(`Setup failed: ${error.message}`);
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

/**
 * POST /api/auth/login
 * Authenticate and return access token. Sets refresh token cookie for auto-login.
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, rememberMe = false } = req.body || {};
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const result = await authService.login(username, password, rememberMe === true);

    // Set refresh token as httpOnly cookie for auto-login
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(req));
    }

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    log.warn(`Login failed: ${error.message}`);
    res.status(401).json({ error: sanitizeError(error.message) });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token cookie. 
 * This is how auto-login works — the browser sends the httpOnly cookie automatically.
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
    }

    const result = await authService.refreshAccessToken(refreshToken);
    if (!result) {
      // Clear invalid cookie
      res.clearCookie('refreshToken', getRefreshCookieOptions(req, false));
      return res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' });
    }

    // Rotate the refresh token — set updated cookie
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions(req));
    }

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    log.error(`Token refresh failed: ${error?.message || error}`);
    // Always clear stale cookie on any failure
    try { res.clearCookie('refreshToken', getRefreshCookieOptions(req, false)); } catch {}
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

/**
 * POST /api/auth/logout
 * Clear refresh token cookie.
 */
router.post('/logout', async (req, res) => {
  await authService.logout(req.cookies?.refreshToken);
  res.clearCookie('refreshToken', getRefreshCookieOptions(req, false));
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Get current user info (requires valid access token).
 */
router.get('/me', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({ user: { id: user.userId, username: user.username, role: user.role } });
  } catch (error) {
    res.status(401).json({ error: 'Authentication error' });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for the authenticated user.
 */
router.post('/change-password', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    await authService.changePassword(user.userId, currentPassword, newPassword);
    res.clearCookie('refreshToken', getRefreshCookieOptions(req, false));

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

// Rate limit for reset — 3 attempts per 15 minutes
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset attempts. Please try again later.' },
});

/**
 * GET /api/auth/reset-status
 * Check if a password reset token file exists on disk.
 * This tells the frontend whether to show the "Reset Password" option.
 */
router.get('/reset-status', async (req, res) => {
  try {
    const { dataDir } = getDataPaths();
    const tokenPath = path.join(dataDir, 'reset-token.txt');
    if (!fs.existsSync(tokenPath)) {
      return res.json({ resetAvailable: false });
    }
    // Token files expire after 24h to avoid forgotten files sitting on disk indefinitely.
    const stat = fs.statSync(tokenPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const available = ageMs < 24 * 60 * 60 * 1000;
    res.json({ resetAvailable: available });
  } catch (error) {
    res.json({ resetAvailable: false });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset the admin password using a reset token file.
 * 
 * Security model: The caller must provide the exact token from data/reset-token.txt.
 * This proves they have filesystem access to the server machine.
 * The token file is deleted after a successful reset.
 */
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || typeof token !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'Password must be 128 characters or fewer' });
    }

    const { dataDir } = getDataPaths();
    const tokenPath = path.join(dataDir, 'reset-token.txt');

    if (!fs.existsSync(tokenPath)) {
      log.warn('Password reset attempted but no reset-token.txt exists');
      return res.status(403).json({ error: 'No reset token found. Create data/reset-token.txt on the server first.' });
    }

    // Guard against oversized token files
    const stat = fs.statSync(tokenPath);
    if (stat.size > 1024) {
      log.warn('Password reset token file is too large');
      return res.status(403).json({ error: 'Reset token file is invalid (too large). Max 1KB.' });
    }

    // Token files older than 24h are rejected to prevent stale reset files from being abused.
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 24 * 60 * 60 * 1000) {
      log.warn('Password reset attempted with expired token file (>24h old)');
      try { fs.unlinkSync(tokenPath); } catch {}
      return res.status(403).json({ error: 'Reset token file is older than 24 hours. Recreate it on the server.' });
    }

    const storedToken = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (!storedToken || storedToken.length < 8) {
      log.warn('Password reset attempted with invalid token file (too short)');
      return res.status(403).json({ error: 'Reset token file is invalid. It must contain at least 8 characters.' });
    }

    // Hash both sides to a constant-length digest before timing-safe comparison.
    // This avoids leaking the token's length via the length-mismatch short-circuit.
    const candidateDigest = crypto.createHash('sha256').update(token.trim(), 'utf8').digest();
    const storedDigest = crypto.createHash('sha256').update(storedToken, 'utf8').digest();
    if (!crypto.timingSafeEqual(candidateDigest, storedDigest)) {
      log.warn('Password reset attempted with incorrect token');
      return res.status(403).json({ error: 'Invalid reset token' });
    }

    const result = await authService.resetPassword(newPassword);

    // Delete the token file after successful reset
    try {
      fs.unlinkSync(tokenPath);
    } catch (unlinkErr) {
      log.warn(`Could not delete reset-token.txt: ${unlinkErr.message}`);
    }

    log.info(`Password reset successful for user: ${result.username}`);
    res.json({ success: true, message: `Password reset for ${result.username}` });
  } catch (error) {
    log.error(`Password reset failed: ${error.message}`);
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

export default router;
