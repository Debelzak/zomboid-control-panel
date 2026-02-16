/**
 * Authentication Service
 * Handles user registration, login, JWT tokens, and session management.
 * 
 * Design:
 * - bcryptjs for password hashing (pure JS, compatible with pkg)
 * - JWT access tokens (short-lived, 24h) + refresh tokens (long-lived, 30d)
 * - Auto-login via refresh token stored in httpOnly cookie
 * - First-run setup creates the admin account
 * - JWT secret is auto-generated per installation and stored in db.json
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { getSetting, setSetting, getDb } from '../database/init.js';

const log = createLogger('Auth');

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';

class AuthService {
  constructor() {
    this.jwtSecret = null;
    this.initialized = false;
  }

  /**
   * Initialize the auth service — loads or generates JWT secret
   */
  async init() {
    try {
      // Load or generate JWT secret
      let secret = await getSetting('jwtSecret');
      if (!secret) {
        secret = crypto.randomBytes(64).toString('hex');
        await setSetting('jwtSecret', secret);
        log.info('Generated new JWT secret');
      }
      this.jwtSecret = secret;
      this.initialized = true;
      log.info('Auth service initialized');
    } catch (error) {
      log.error(`Failed to initialize auth service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if setup is needed (no users exist)
   */
  async needsSetup() {
    const db = await getDb();
    const users = db.data.users || [];
    return users.length === 0;
  }

  /**
   * Check if authentication is enabled
   */
  async isAuthEnabled() {
    const authEnabled = await getSetting('authEnabled');
    // Default to true once users exist
    if (authEnabled === undefined || authEnabled === null) {
      const needsSetup = await this.needsSetup();
      return !needsSetup; // Auth enabled only if users exist
    }
    return authEnabled !== false;
  }

  /**
   * Create a new user account (admin)
   */
  async createUser(username, password) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    if (username.length < 3 || username.length > 32) {
      throw new Error('Username must be 3-32 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error('Username can only contain letters, numbers, underscores and hyphens');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const db = await getDb();
    if (!db.data.users) {
      db.data.users = [];
    }

    // Check for duplicate username
    const existing = db.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
      throw new Error('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = {
      id: crypto.randomUUID(),
      username,
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString(),
      lastLogin: null,
    };

    db.data.users.push(user);
    await db.write();

    log.info(`User created: ${username}`);
    return { id: user.id, username: user.username, role: user.role };
  }

  /**
   * Authenticate user and return tokens
   */
  async login(username, password, rememberMe = true) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const db = await getDb();
    const users = db.data.users || [];
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
      // Use generic error to prevent username enumeration
      throw new Error('Invalid username or password');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid username or password');
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    await db.write();

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = rememberMe ? this.generateRefreshToken(user) : null;

    log.info(`User logged in: ${username}`);
    return {
      user: { id: user.id, username: user.username, role: user.role },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Generate a short-lived access token
   */
  generateAccessToken(user) {
    return jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      this.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generate a long-lived refresh token (for auto-login / remember me)
   * Includes tokenGen counter so tokens can be invalidated by incrementing the counter.
   */
  generateRefreshToken(user) {
    return jwt.sign(
      { userId: user.id, type: 'refresh', tokenGen: user.tokenGen || 0 },
      this.jwtSecret,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );
  }

  /**
   * Verify an access token and return the payload
   */
  verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, this.jwtSecret);
      // Reject refresh tokens used as access tokens (token type confusion)
      if (payload.type === 'refresh') return null;
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Refresh the access token using a refresh token.
   * Also rotates the refresh token (issues a new one, old one becomes invalid on next gen bump).
   */
  async refreshAccessToken(refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, this.jwtSecret);
      if (payload.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      const db = await getDb();
      const users = db.data.users || [];
      const user = users.find(u => u.id === payload.userId);

      if (!user) {
        throw new Error('User not found');
      }

      // Validate tokenGen — reject tokens from before a password change or logout-all
      const currentGen = user.tokenGen || 0;
      const tokenGen = payload.tokenGen ?? 0;
      if (tokenGen < currentGen) {
        throw new Error('Refresh token has been revoked');
      }

      const accessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);
      return {
        user: { id: user.id, username: user.username, role: user.role },
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId, currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }

    const db = await getDb();
    const users = db.data.users || [];
    const user = users.find(u => u.id === userId);

    if (!user) {
      throw new Error('User not found');
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      throw new Error('Current password is incorrect');
    }

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Bump tokenGen to invalidate all existing refresh tokens
    user.tokenGen = (user.tokenGen || 0) + 1;
    await db.write();

    log.info(`Password changed for user: ${user.username}`);
    return true;
  }

  /**
   * Get all users (without password hashes)
   */
  async getUsers() {
    const db = await getDb();
    const users = db.data.users || [];
    return users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
    }));
  }

  /**
   * Express middleware — verifies JWT and attaches user to req
   * Skips auth check if auth is disabled or setup is needed
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Only protect API routes — let static files and SPA page routes through
        if (!req.path.startsWith('/api')) {
          return next();
        }

        // Always allow auth routes (login, setup, status)
        if (req.path.startsWith('/api/auth/')) {
          return next();
        }
  
        // Allow health check
        if (req.path === '/api/health') {
          return next();
        }

        // Skip auth if no users exist (setup needed)
        const needsSetup = await this.needsSetup();
        if (needsSetup) {
          return next();
        }

        // Skip auth if it's been explicitly disabled  
        const authEnabled = await this.isAuthEnabled();
        if (!authEnabled) {
          return next();
        }

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        }

        const token = authHeader.substring(7);
        const payload = this.verifyAccessToken(token);

        if (!payload) {
          return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_EXPIRED' });
        }

        // Attach user info to request
        req.user = payload;
        next();
      } catch (error) {
        log.error(`Auth middleware error: ${error.message}`);
        return res.status(500).json({ error: 'Authentication error' });
      }
    };
  }
}

// Singleton instance
const authService = new AuthService();
export default authService;
