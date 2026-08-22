// OIDC (OpenID Connect) sign-in routes — mounted at /api/auth/oidc.
// Additive to the existing local username/password login in routes/auth.js
// (untouched by this file): local login is the permanent fallback, and
// every route here degrades to a clear, safe response when OIDC isn't
// configured rather than ever taking the rest of the panel down with it.
//
// This file owns provider config, the PKCE/state/nonce flow, and ID token
// validation (services/oidc.js). It deliberately does NOT own user or role
// resolution — once a token is validated, /callback hands the (already
// verified) issuer+subject straight to authService.loginWithExternalIdentity(),
// which is Jim's auth.js work and decides find-vs-refuse/role policy.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import authService from "../services/auth.js";
import { createLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/sanitize.js";
import {
  getOidcSettings,
  isOidcConfigured,
  buildOidcAuthorizationRequest,
  handleOidcCallback,
} from "../services/oidc.js";

const log = createLogger("OIDC");
const router = Router();

// Mirrors routes/auth.js's own loginLimiter (5/min) — same reasoning
// applies here: both routes below do real work (a redirect build, a full
// token exchange + DB lookup) that's worth protecting from abuse, same as
// the local login route already is. Separate instances (not one shared
// limiter) so a legitimate user's normal login→callback round trip doesn't
// spend a single shared budget twice per attempt.
function makeOidcLimiter() {
  return rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again later." },
  });
}
const loginRateLimiter = makeOidcLimiter();
const callbackRateLimiter = makeOidcLimiter();

const FLOW_COOKIE_NAME = "oidcFlow";
const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — enough for an IdP login + MFA, short enough to limit exposure.

// Mirrors routes/auth.js's getRefreshCookieOptions (kept local rather than
// imported — that file is owned by another agent's in-flight work on
// roles). If that ever changes shape, this needs to change with it; flagged
// to the integrator in the accompanying report rather than silently risking
// drift.
function getRefreshCookieOptions(req) {
  const forceSecureCookies =
    process.env.HTTPS === "true" || process.env.FORCE_HSTS === "true";
  const requestIsSecure =
    req.secure || req.headers["x-forwarded-proto"] === "https";
  return {
    httpOnly: true,
    secure: forceSecureCookies || requestIsSecure,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

// The state/nonce/PKCE cookie deliberately uses SameSite=Lax, not Strict:
// unlike the refresh-token cookie above (only ever sent by same-site XHR
// from the panel's own SPA), this one MUST be sent when the browser lands
// back on /api/auth/oidc/callback via a top-level cross-site GET redirect
// FROM the identity provider's domain — SameSite=Strict cookies are not
// sent on that navigation and the flow would break on every provider.
// Unsigned is fine: it carries no secret, only values the IdP is separately
// asked to echo back — any tampering just fails the state/nonce/PKCE
// comparison inside openid-client and the sign-in is refused, same as if
// the cookie were absent.
function getFlowCookieOptions(req) {
  const forceSecureCookies =
    process.env.HTTPS === "true" || process.env.FORCE_HSTS === "true";
  const requestIsSecure =
    req.secure || req.headers["x-forwarded-proto"] === "https";
  return {
    httpOnly: true,
    secure: forceSecureCookies || requestIsSecure,
    sameSite: "lax",
    path: "/api/auth/oidc",
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
  };
}

// GET /api/auth/oidc/status — public, no secrets. Lets the login screen
// decide whether to offer an SSO option at all.
router.get("/status", (_req, res) => {
  const settings = getOidcSettings();
  res.json({
    configured: isOidcConfigured(settings),
    providerName: settings.providerName,
  });
});

// GET /api/auth/oidc/login — starts the flow.
router.get("/login", loginRateLimiter, async (req, res) => {
  if (!isOidcConfigured()) {
    return res.status(404).json({ error: "OIDC is not configured" });
  }

  try {
    const { authorizationUrl, state, nonce, codeVerifier } =
      await buildOidcAuthorizationRequest();

    res.cookie(
      FLOW_COOKIE_NAME,
      JSON.stringify({ state, nonce, codeVerifier }),
      getFlowCookieOptions(req),
    );
    res.redirect(authorizationUrl);
  } catch (error) {
    log.warn(`OIDC login start failed: ${error.message}`);
    res.status(502).json({
      error: sanitizeError(
        "Could not reach the identity provider. Try local sign-in, or contact your administrator.",
      ),
    });
  }
});

// GET /api/auth/oidc/callback — the redirect back from the IdP. This is a
// full-page browser navigation, not an XHR, so on both success and failure
// it redirects the browser rather than returning raw JSON — always back to
// the panel's own root, which already handles "there's a valid refresh
// cookie" as part of its existing auto-login bootstrap (see
// routes/auth.js's POST /refresh), so no client-side change is needed to
// pick up a session set here. Failures redirect with a short, generic
// reason code only — never a raw error message — for whichever future UI
// work wants to surface it.
router.get("/callback", callbackRateLimiter, async (req, res) => {
  if (!isOidcConfigured()) {
    return res.redirect("/?oidcError=not_configured");
  }

  const rawFlowCookie = req.cookies?.[FLOW_COOKIE_NAME];
  const { maxAge: _unused, ...clearFlowCookieOptions } = getFlowCookieOptions(req);
  res.clearCookie(FLOW_COOKIE_NAME, clearFlowCookieOptions);

  let flow;
  try {
    flow = rawFlowCookie ? JSON.parse(rawFlowCookie) : null;
  } catch {
    flow = null;
  }
  if (!flow) {
    log.warn("OIDC callback with no/invalid flow cookie (expired, or CSRF attempt)");
    return res.redirect("/?oidcError=expired_flow");
  }

  const settings = getOidcSettings();
  const currentUrl = new URL(settings.redirectUri);
  const queryIndex = req.url.indexOf("?");
  currentUrl.search = queryIndex === -1 ? "" : req.url.slice(queryIndex);

  let claims;
  try {
    claims = await handleOidcCallback(currentUrl, flow);
  } catch (error) {
    log.warn(`OIDC callback rejected: ${error.message}`);
    return res.redirect("/?oidcError=invalid_token");
  }

  // User/role resolution is entirely authService's call (Jim's
  // loginWithExternalIdentity, final signature per god) — this route only
  // supplies the VALIDATED issuer+subject+email and reacts to the outcome.
  // loginWithExternalIdentity does NO token verification itself; that
  // already happened above in handleOidcCallback. Refuse-by-default: an
  // identity with no local account already linked to it is NOT
  // auto-created (linked:false, canBootstrapAdmin:false).
  let result;
  try {
    result = await authService.loginWithExternalIdentity(
      { issuer: claims.iss, subject: claims.sub, email: claims.email },
      true,
    );
  } catch (error) {
    log.error(`OIDC session issuance failed: ${error.message}`);
    return res.redirect("/?oidcError=session_failed");
  }

  // -----------------------------------------------------------------------
  // BOOTSTRAP GATE SEAM — DO NOT CALL bootstrapAdminFromExternalIdentity()
  // FROM THIS ROUTE. DO NOT INVENT A GATING MECHANISM HERE.
  // -----------------------------------------------------------------------
  // canBootstrapAdmin:true means zero local users exist — the exact same
  // trust boundary /api/auth/setup relies on for the password path. Kevin
  // is CURRENTLY closing that boundary (a per-install setup secret,
  // generated at first boot, written to console/log) because today it's a
  // free-for-all: whoever reaches a fresh panel first becomes admin. If
  // this route bootstrapped an OIDC admin without going through whatever
  // Kevin lands, it would be a side door around his front door — anyone
  // who can complete a Google login on a fresh panel would own it,
  // regardless of the setup secret. So: this branch NEVER calls
  // bootstrapAdminFromExternalIdentity. It only signals the distinct case
  // (setup_required, not refused) so a future setup flow — gated by
  // Kevin's mechanism, coordinated through god once its shape is settled —
  // can pick it up. Until then a brand-new panel's first admin can only be
  // created via the existing password-based /api/auth/setup route.
  if (!result.linked) {
    log.warn(
      `OIDC identity not linked to any account (sub=${claims.sub}, canBootstrapAdmin=${result.canBootstrapAdmin})`,
    );
    return res.redirect(
      result.canBootstrapAdmin ? "/?oidcError=setup_required" : "/?oidcError=refused",
    );
  }

  res.cookie("refreshToken", result.refreshToken, getRefreshCookieOptions(req));
  log.info(`OIDC sign-in: ${result.user.username} (sub=${claims.sub})`);
  res.redirect("/");
});

export default router;
