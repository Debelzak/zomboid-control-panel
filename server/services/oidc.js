// OIDC (OpenID Connect) sign-in — additive to local username/password login,
// never a replacement for it. Local login MUST keep working when OIDC is
// unconfigured, misconfigured, or the identity provider is unreachable: an
// operator locked out of the panel because a third-party IdP is down would
// mean losing control of their own game server.
//
// Uses openid-client (github.com/panva/openid-client), which wraps the
// lower-level oauth4webapi for all of discovery, PKCE, and — critically —
// ID token validation (signature via the provider's JWKS, issuer, audience,
// expiry, nonce). None of that crypto is reimplemented here.
//
// Scope, deliberately: ONE standards-compliant OIDC provider, configured by
// its issuer URL rather than hardcoding Google/Discord/etc. Authorization
// Code flow with PKCE. Every authorization request also carries and checks a
// nonce, even though the spec only requires that for the implicit flow —
// belt-and-braces per the operator's "good security" ask.
import * as client from "openid-client";
import { createLogger } from "../utils/logger.js";

const log = createLogger("OIDC");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getOidcSettings() {
  return {
    issuerUrl: readEnv("PANEL_OIDC_ISSUER_URL"),
    clientId: readEnv("PANEL_OIDC_CLIENT_ID"),
    clientSecret: readEnv("PANEL_OIDC_CLIENT_SECRET"),
    redirectUri: readEnv("PANEL_OIDC_REDIRECT_URI"),
    scope: readEnv("PANEL_OIDC_SCOPE") || "openid email profile",
    // Optional, cosmetic only (e.g. "Sign in with Authentik" on a future
    // login button) — never used for any security decision.
    providerName: readEnv("PANEL_OIDC_PROVIDER_NAME") || "SSO",
    // Off by default: openid-client refuses plain HTTP for discovery and
    // every subsequent request, which is the right default for a panel
    // exposed to the internet. Only needed for a self-hosted IdP reachable
    // solely over a private HTTP-only origin (e.g. behind a VPN/reverse
    // proxy that terminates TLS elsewhere) — and for this module's own
    // tests, which run a local HTTP mock IdP.
    allowInsecureHttp: readEnv("PANEL_OIDC_ALLOW_INSECURE_HTTP") === "true",
  };
}

export function isOidcConfigured(settings = getOidcSettings()) {
  return Boolean(
    settings.issuerUrl &&
      settings.clientId &&
      settings.clientSecret &&
      settings.redirectUri,
  );
}

// Discovery is a network call to the IdP — never do it at module import time
// (that would make the whole panel's startup depend on a third-party
// service being reachable). Memoized so concurrent requests don't each
// trigger their own discovery round trip, but a FAILED discovery is not
// cached: an IdP that's down right now and reachable a minute from now
// should self-heal on the next login attempt rather than staying broken
// until the panel restarts.
let _configPromise = null;

export async function getOidcConfig() {
  const settings = getOidcSettings();
  if (!isOidcConfigured(settings)) return null;

  if (!_configPromise) {
    // enableNonRepudiationChecks is REQUIRED here, not optional: by default
    // openid-client treats the token endpoint's TLS connection itself as
    // sufficient proof of the ID token's authenticity for the authorization
    // code flow, and skips verifying its JWS signature against the
    // provider's JWKS. That default is spec-compliant, but the operator
    // explicitly asked for "good security", and a wrong or missing check
    // here is exactly the kind of silent gap that's worse than not having
    // OIDC at all — so this always verifies the signature independently of
    // the TLS channel, belt-and-braces.
    const execute = [client.enableNonRepudiationChecks];
    if (settings.allowInsecureHttp) execute.push(client.allowInsecureRequests);

    _configPromise = client
      .discovery(
        new URL(settings.issuerUrl),
        settings.clientId,
        settings.clientSecret,
        undefined,
        { execute },
      )
      .catch((error) => {
        _configPromise = null;
        log.warn(`OIDC discovery against ${settings.issuerUrl} failed: ${error.message}`);
        throw error;
      });
  }
  return _configPromise;
}

// Test-only: force the next getOidcConfig() call to re-run discovery
// instead of reusing a memoized Configuration from an earlier test.
export function _resetOidcConfigCacheForTests() {
  _configPromise = null;
}

// ---------------------------------------------------------------------------
// Authorization request (the "log in with SSO" redirect)
// ---------------------------------------------------------------------------

/**
 * Builds the URL to send the browser to at the IdP, plus the PKCE/state/
 * nonce values the caller must persist (e.g. in a short-lived cookie) and
 * hand back to `handleOidcCallback` unchanged.
 */
export async function buildOidcAuthorizationRequest() {
  const config = await getOidcConfig();
  if (!config) {
    throw new Error("OIDC is not configured");
  }
  const settings = getOidcSettings();

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: settings.redirectUri,
    scope: settings.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return { authorizationUrl: url.href, state, nonce, codeVerifier };
}

// ---------------------------------------------------------------------------
// Callback (the redirect back from the IdP)
// ---------------------------------------------------------------------------

/**
 * `currentUrl` must be a URL whose origin+pathname equal the configured
 * redirect_uri and whose query string is exactly what the IdP sent back
 * (code, state, or error) — see routes/oidc.js for how that's built from
 * the incoming request. `flow` is the { state, nonce, codeVerifier } this
 * module handed back from buildOidcAuthorizationRequest and the caller
 * persisted across the redirect.
 *
 * Resolves to the VALIDATED ID token claims (signature, issuer, audience,
 * expiry, and nonce all already checked by openid-client/oauth4webapi) on
 * success. Throws on any validation failure, including the IdP itself
 * reporting an error (e.g. the user denied consent) — callers must not
 * treat a caught exception here as anything other than "not authenticated".
 */
export async function handleOidcCallback(currentUrl, flow) {
  const config = await getOidcConfig();
  if (!config) {
    throw new Error("OIDC is not configured");
  }
  if (!flow || !flow.state || !flow.nonce || !flow.codeVerifier) {
    throw new Error("OIDC sign-in session is missing or expired");
  }

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });

  // Already fully validated by authorizationCodeGrant above (signature via
  // the provider's JWKS, iss, aud, exp, and nonce) — this just reads the
  // result out, it performs no additional checking of its own.
  const claims = tokens.claims();
  if (!claims || !claims.sub) {
    throw new Error("OIDC provider did not return a subject claim");
  }

  return claims;
}
