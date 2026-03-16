/**
 * Auth Routes — /api/auth/*
 * Handles login, setup, token refresh, and auth status.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import authService from '../services/auth.js';
import { createLogger } from '../utils/logger.js';
import { sanitizeError } from '../utils/sanitize.js';

const log = createLogger('Auth');
const router = Router();

function getRefreshCookieOptions(req, includeMaxAge = true) {
  return {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'strict',
    path: '/api/auth',
    ...(includeMaxAge ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
  };
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

/**
 * POST /api/auth/setup
 * First-run account creation. Only works if no users exist.
 */
router.post('/setup', async (req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    if (!needsSetup) {
      return res.status(400).json({ error: 'Setup already completed. Use login instead.' });
    }

    const { username, password, rememberMe = true } = req.body;
    const user = await authService.createUser(username, password);

    // Auto-login after setup — generate tokens
    const result = await authService.login(username, password, rememberMe);

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
    const { username, password, rememberMe = true } = req.body;
    const result = await authService.login(username, password, rememberMe);

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
    log.error(`Token refresh failed: ${error.message}`);
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

    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(user.userId, currentPassword, newPassword);
    res.clearCookie('refreshToken', getRefreshCookieOptions(req, false));

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

export default router;
