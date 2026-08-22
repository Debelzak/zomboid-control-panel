// A tiny local identity provider used only by oidc*.test.js to validate
// this codebase's OIDC integration against a REAL discovery document, JWKS,
// and token endpoint over real HTTP -- rather than asserting against this
// module's own internal logic. It deliberately does no real authentication
// of its own (no /authorize step, no code/PKCE validation at the token
// endpoint): the caller controls exactly what ID token claims and signing
// key the next /token response uses, so tests can assert on how the PANEL's
// OIDC client reacts to a given (possibly deliberately-broken) response.
import http from "http";
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from "jose";

export async function makeSigningKey() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey, publicJwk, kid };
}

export async function startMockOidcProvider({ clientId, defaultSubject = "user-123" }) {
  const validKey = await makeSigningKey();
  let baseUrl;
  let nextIdTokenClaims = null; // null = use the default happy-path claims
  let nextSigningKey = null; // null = sign with validKey (the one published in JWKS)

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);

    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          jwks_uri: `${baseUrl}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [validKey.publicJwk] }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: baseUrl,
        aud: clientId,
        sub: defaultSubject,
        iat: now,
        exp: now + 300,
        ...(nextIdTokenClaims || {}),
      };
      const key = nextSigningKey || validKey;
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: key.kid })
        .sign(key.privateKey);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "mock-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    validKey,
    /** Set the claims/signing key the NEXT /token response will use. Pass `{}` to reset to the default happy-path claims. */
    setNextIdToken({ claims = null, signingKey = null } = {}) {
      nextIdTokenClaims = claims;
      nextSigningKey = signingKey;
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
