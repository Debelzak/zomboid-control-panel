/**
 * Auth Routes — /api/auth/*
 * Handles login, setup, token refresh, and auth status.
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import authService, { USER_ROLES, requireRole } from "../services/auth.js";
import { createLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/sanitize.js";
import { getDataPaths } from "../utils/paths.js";
import { setSetting } from "../database/init.js";
import { verifySetupToken, clearSetupToken } from "../utils/setupToken.js";
import { getRefreshCookieOptions } from "../utils/refreshCookie.js";

const log = createLogger("Auth");
const router = Router();

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

const RESET_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_MAX_BYTES = 1024;
const LOOPBACK_REMOTE_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function normalizeIpAddress(address) {
  if (typeof address !== "string") return "";
  const trimmed = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!trimmed) return "";
  const withoutZone = trimmed.split("%")[0];
  return withoutZone.startsWith("::ffff:") ? withoutZone.slice(7) : withoutZone;
}

// Docker's default bridge network pool (172.17.0.0/16 through
// 172.31.0.0/16, i.e. all of 172.16.0.0/12). When this process runs
// directly on a Docker host, os.networkInterfaces() includes the docker0 /
// custom-bridge gateway addresses as "this machine's own" addresses. Docker
// hairpin NAT can make a connection FROM any container TO a host-published
// port on this panel arrive with a source address rewritten to the bridge
// gateway IP — so trusting those addresses as "local" would let any
// container on the host bypass the local-only reset-token protection.
// Loopback is unaffected: it's added separately below and always trusted.
function isDockerBridgeAddress(address) {
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(address);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first === 172 && second >= 16 && second <= 31;
}

function getLocalPanelAddresses() {
  const addresses = new Set(
    [...LOOPBACK_REMOTE_ADDRESSES]
      .map((address) => normalizeIpAddress(address))
      .filter(Boolean),
  );

  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const normalized = normalizeIpAddress(entry.address);
      if (normalized && !isDockerBridgeAddress(normalized)) {
        addresses.add(normalized);
      }
    }
  }

  return addresses;
}

function getResetTokenPath() {
  const { dataDir } = getDataPaths();
  return path.join(dataDir, "reset-token.txt");
}

export function isLocalPanelRequest(req) {
  const candidateAddresses = [
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ]
    .map((address) => normalizeIpAddress(address))
    .filter(Boolean);

  const localAddresses = getLocalPanelAddresses();
  return candidateAddresses.some((address) => localAddresses.has(address));
}

export function createLocalResetResponse(message) {
  return {
    success: true,
    resetAvailable: true,
    message,
  };
}

function getResetTokenState() {
  const tokenPath = getResetTokenPath();
  if (!fs.existsSync(tokenPath)) {
    return { tokenPath, available: false, reason: "missing", token: null };
  }

  const stat = fs.statSync(tokenPath);
  if (stat.size > RESET_TOKEN_MAX_BYTES) {
    return {
      tokenPath,
      available: false,
      reason: "too-large",
      token: null,
      stat,
    };
  }

  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs > RESET_TOKEN_MAX_AGE_MS) {
    return {
      tokenPath,
      available: false,
      reason: "expired",
      token: null,
      stat,
    };
  }

  const token = fs.readFileSync(tokenPath, "utf-8").trim();
  if (!token || token.length < 8) {
    return {
      tokenPath,
      available: false,
      reason: "too-short",
      token: null,
      stat,
    };
  }

  return { tokenPath, available: true, reason: "ok", token, stat, ageMs };
}

async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
  message: { error: "Too many login attempts. Please try again later." },
});

/**
 * GET /api/auth/status
 * Returns whether setup is needed and if auth is enabled.
 * This is always accessible (no auth required).
 */
router.get("/status", async (req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    const authEnabled = await authService.isAuthEnabled();
    res.json({ needsSetup, authEnabled });
  } catch (error) {
    log.error(`Failed to get auth status: ${error.message}`);
    res.status(500).json({ error: "Failed to get auth status" });
  }
});

// Setup rate limit — prevent brute-force account creation on fresh VPS installs
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many setup attempts. Please try again later." },
});

/**
 * POST /api/auth/setup
 * First-run account creation. Only works if no users exist.
 */
router.post("/setup", setupLimiter, async (req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    if (!needsSetup) {
      return res
        .status(400)
        .json({ error: "Setup already completed. Use login instead." });
    }

    // "Zero users exist" is the dangerous state on a publicly reachable
    // panel, not this route specifically — see server/utils/setupToken.js.
    // Checked before touching anything else so a wrong/missing token never
    // gets as far as writing panelPort or creating an account.
    const { setupToken } = req.body || {};
    if (!(await verifySetupToken(setupToken))) {
      return res.status(403).json({
        error: "Invalid or missing setup token",
        code: "SETUP_TOKEN_REQUIRED",
      });
    }

    const { username, password, rememberMe = false, panelPort = 3001 } = req.body || {};
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }
    const normalizedPanelPort = Number(panelPort);
    if (!Number.isInteger(normalizedPanelPort) || normalizedPanelPort < 1024 || normalizedPanelPort > 65535) {
      return res.status(400).json({ error: "Panel port must be a whole number between 1024 and 65535" });
    }
    await setSetting("panelPort", normalizedPanelPort);
    await authService.createUser(username, password);
    await clearSetupToken();

    // Auto-login after setup — generate tokens
    const result = await authService.login(
      username,
      password,
      rememberMe === true,
    );

    // Set refresh token as httpOnly cookie
    if (result.refreshToken) {
      res.cookie(
        "refreshToken",
        result.refreshToken,
        getRefreshCookieOptions(req),
      );
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
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password, rememberMe = false } = req.body || {};
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }
    const result = await authService.login(
      username,
      password,
      rememberMe === true,
    );

    // Set refresh token as httpOnly cookie for auto-login
    if (result.refreshToken) {
      res.cookie(
        "refreshToken",
        result.refreshToken,
        getRefreshCookieOptions(req),
      );
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
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res
        .status(401)
        .json({ error: "No refresh token", code: "NO_REFRESH_TOKEN" });
    }

    const result = await authService.refreshAccessToken(refreshToken);
    if (!result) {
      // Clear invalid cookie
      res.clearCookie("refreshToken", getRefreshCookieOptions(req, false));
      return res
        .status(401)
        .json({
          error: "Invalid refresh token",
          code: "INVALID_REFRESH_TOKEN",
        });
    }

    // Rotate the refresh token — set updated cookie
    if (result.refreshToken) {
      res.cookie(
        "refreshToken",
        result.refreshToken,
        getRefreshCookieOptions(req),
      );
    }

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    log.error(`Token refresh failed: ${error?.message || error}`);
    // Always clear stale cookie on any failure
    try {
      res.clearCookie("refreshToken", getRefreshCookieOptions(req, false));
    } catch {
      // Headers may already be sent; the 401 below is what matters.
    }
    res.status(401).json({ error: "Token refresh failed" });
  }
});

/**
 * POST /api/auth/logout
 * Clear refresh token cookie.
 */
router.post("/logout", async (req, res) => {
  await authService.logout(req.cookies?.refreshToken);
  res.clearCookie("refreshToken", getRefreshCookieOptions(req, false));
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Get current user info (requires valid access token).
 */
router.get("/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    res.json({
      user: { id: user.userId, username: user.username, role: user.role },
    });
  } catch (error) {
    res.status(401).json({ error: "Authentication error" });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for the authenticated user.
 */
router.post("/change-password", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
      return res
        .status(400)
        .json({ error: "Current and new password are required" });
    }
    await authService.changePassword(user.userId, currentPassword, newPassword);
    res.clearCookie("refreshToken", getRefreshCookieOptions(req, false));

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

/**
 * GET /api/auth/users
 * List all local accounts. Admin-only — usernames, roles and login history
 * for every account are exactly the kind of thing a technician or moderator
 * account must not be able to enumerate.
 */
router.get("/users", requireRole("admin"), async (req, res) => {
  try {
    const users = await authService.getUsers();
    res.json({ users });
  } catch (error) {
    log.error(`Failed to list users: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

/**
 * POST /api/auth/users
 * Create an additional account with an explicit role. Admin-only. Unlike
 * /api/auth/setup, this does not auto-login or set a session cookie for the
 * caller — it creates an account for someone else to log in with.
 */
router.post("/users", requireRole("admin"), async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }
    if (!USER_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: `role must be one of: ${USER_ROLES.join(", ")}` });
    }
    const user = await authService.createUser(username, password, role);
    log.info(`User created by admin: ${username} (role: ${role})`);
    res.status(201).json({ success: true, user });
  } catch (error) {
    log.warn(`User creation failed: ${error.message}`);
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

/**
 * PATCH /api/auth/users/:id/role
 * Change an existing account's role. Admin-only. Refuses to demote the
 * last remaining admin (enforced in authService.changeUserRole).
 */
router.patch("/users/:id/role", requireRole("admin"), async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!USER_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: `role must be one of: ${USER_ROLES.join(", ")}` });
    }
    const user = await authService.changeUserRole(req.params.id, role);
    log.info(`Role changed by admin: ${user.username} -> ${role}`);
    res.json({ success: true, user });
  } catch (error) {
    log.warn(`Role change failed: ${error.message}`);
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

/**
 * POST /api/auth/regenerate-jwt-secret
 * Admin-only. Immediately invalidates EVERY existing session — access and
 * refresh tokens, every user, every device, including the caller's own.
 *
 * Exists for an operator who has ever shared or offsited a backup taken
 * before the JWT secret moved out of db.json (older backups still contain
 * the old key in plaintext — see CHANGELOG). There is no automatic or
 * scheduled rotation by design; this is a deliberate, rare, explicit action.
 */
router.post(
  "/regenerate-jwt-secret",
  requireRole("admin"),
  async (req, res) => {
    try {
      await authService.regenerateJwtSecret();
      log.warn(
        `JWT secret regenerated by admin: ${req.user?.username || "unknown"}`,
      );
      res.clearCookie("refreshToken", getRefreshCookieOptions(req, false));
      res.json({
        success: true,
        message:
          "JWT signing key regenerated. Every session has been invalidated, including this one — you will need to log in again.",
      });
    } catch (error) {
      log.error(`JWT secret regeneration failed: ${error.message}`);
      res.status(400).json({ error: sanitizeError(error.message) });
    }
  },
);

// Rate limit for reset — 3 attempts per 15 minutes
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts. Please try again later." },
});

/**
 * GET /api/auth/reset-status
 * Check if a password reset token file exists on disk.
 * This tells the frontend whether to show the "Reset Password" option.
 */
router.get("/reset-status", async (req, res) => {
  try {
    const tokenState = getResetTokenState();
    res.json({
      resetAvailable: tokenState.available,
      localResetSupported: isLocalPanelRequest(req),
    });
  } catch (error) {
    res.json({ resetAvailable: false, localResetSupported: false });
  }
});

const localResetTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many local recovery attempts. Please try again later.",
  },
});

/**
 * Recovery codes — the no-filesystem-access path.
 *
 * Generated while signed in, redeemable from the login screen. Only hashes are
 * stored, and each code works exactly once.
 */
router.get("/recovery-codes", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json(await authService.getRecoveryCodeStatus());
  } catch (error) {
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.post("/recovery-codes", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const result = await authService.generateRecoveryCodes(10);
    log.info("New recovery codes generated");
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

router.get("/recovery-status", async (req, res) => {
  try {
    const status = await authService.getRecoveryCodeStatus();
    res.json({ recoveryCodesAvailable: status.remaining > 0 });
  } catch {
    res.json({ recoveryCodesAvailable: false });
  }
});

router.post("/recover-with-code", resetLimiter, async (req, res) => {
  try {
    const { code, newPassword } = req.body || {};
    if (!isNonEmptyString(code) || !isNonEmptyString(newPassword)) {
      return res
        .status(400)
        .json({ error: "A recovery code and a new password are required" });
    }
    const result = await authService.redeemRecoveryCode(code, newPassword);
    log.info(`Password recovered via recovery code for ${result.username}`);
    res.json({
      success: true,
      message: `Password reset for ${result.username}`,
      remaining: result.remaining,
    });
  } catch (error) {
    log.warn(`Recovery code redemption failed: ${error.message}`);
    res.status(403).json({ error: sanitizeError(error.message) });
  }
});

/**
 * POST /api/auth/reset-token/local
 * Create or reuse a reset token when the panel is opened locally on the server host.
 *
 * Security model: this is only allowed for requests that originate from the server itself
 * (loopback or one of the machine's own assigned IP addresses). The response never
 * includes the token value; the caller must still read data/reset-token.txt on disk.
 */
router.post("/reset-token/local", localResetTokenLimiter, async (req, res) => {
  try {
    if (!isLocalPanelRequest(req)) {
      return res.status(403).json({
        error:
          "This recovery action is only available when the panel is opened from the server itself.",
      });
    }

    const tokenState = getResetTokenState();
    if (tokenState.available && tokenState.token) {
      return res.json(
        createLocalResetResponse(
          "A recovery token is already available at data/reset-token.txt. Paste it below to continue.",
        ),
      );
    }

    if (
      tokenState.reason === "expired" ||
      tokenState.reason === "too-large" ||
      tokenState.reason === "too-short"
    ) {
      try {
        fs.unlinkSync(tokenState.tokenPath);
      } catch (error) {
        log.warn(
          `Could not remove ${tokenState.reason} reset token file: ${error.message}`,
        );
      }
    }

    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(tokenState.tokenPath, `${token}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });

    log.info(
      "Local recovery token created from a request originating on the server",
    );
    res.json(
      createLocalResetResponse(
        "Recovery token created at data/reset-token.txt. Paste it below to continue.",
      ),
    );
  } catch (error) {
    log.error(`Local recovery token creation failed: ${error.message}`);
    res
      .status(500)
      .json({ error: "Could not create a recovery token on this server." });
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
router.post("/reset-password", resetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (
      !token ||
      !newPassword ||
      typeof token !== "string" ||
      typeof newPassword !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Token and new password are required" });
    }

    if (newPassword.length > 128) {
      return res
        .status(400)
        .json({ error: "Password must be 128 characters or fewer" });
    }

    const tokenPath = getResetTokenPath();

    if (!fs.existsSync(tokenPath)) {
      log.warn("Password reset attempted but no reset-token.txt exists");
      return res
        .status(403)
        .json({
          error:
            "No reset token found. Create data/reset-token.txt on the server first.",
        });
    }

    // Guard against oversized token files
    const stat = fs.statSync(tokenPath);
    if (stat.size > RESET_TOKEN_MAX_BYTES) {
      log.warn("Password reset token file is too large");
      return res
        .status(403)
        .json({ error: "Reset token file is invalid (too large). Max 1KB." });
    }

    // Token files older than 24h are rejected to prevent stale reset files from being abused.
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > RESET_TOKEN_MAX_AGE_MS) {
      log.warn("Password reset attempted with expired token file (>24h old)");
      try {
        fs.unlinkSync(tokenPath);
      } catch (error) {
        log.warn(`Could not remove expired reset token file: ${error.message}`);
      }
      return res
        .status(403)
        .json({
          error:
            "Reset token file is older than 24 hours. Recreate it on the server.",
        });
    }

    const storedToken = fs.readFileSync(tokenPath, "utf-8").trim();
    if (!storedToken || storedToken.length < 8) {
      log.warn("Password reset attempted with invalid token file (too short)");
      return res
        .status(403)
        .json({
          error:
            "Reset token file is invalid. It must contain at least 8 characters.",
        });
    }

    // Hash both sides to a constant-length digest before timing-safe comparison.
    // This avoids leaking the token's length via the length-mismatch short-circuit.
    const candidateDigest = crypto
      .createHash("sha256")
      .update(token.trim(), "utf8")
      .digest();
    const storedDigest = crypto
      .createHash("sha256")
      .update(storedToken, "utf8")
      .digest();
    if (!crypto.timingSafeEqual(candidateDigest, storedDigest)) {
      log.warn("Password reset attempted with incorrect token");
      return res.status(403).json({ error: "Invalid reset token" });
    }

    const result = await authService.resetPassword(newPassword);

    // Delete the token file after successful reset
    try {
      fs.unlinkSync(tokenPath);
    } catch (unlinkErr) {
      log.warn(`Could not delete reset-token.txt: ${unlinkErr.message}`);
    }

    log.info(`Password reset successful for user: ${result.username}`);
    res.json({
      success: true,
      message: `Password reset for ${result.username}`,
    });
  } catch (error) {
    log.error(`Password reset failed: ${error.message}`);
    res.status(400).json({ error: sanitizeError(error.message) });
  }
});

export default router;
