import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression/coverage for getB42Map()'s dynamic B42 build discovery
// (conv-mapbuild): the endpoint it used to call (build_list.json) is dead,
// and every JSON/XML descriptor path this needs is behind a Cloudflare
// challenge for Node's own TLS stack (fetch AND https alike) that curl gets
// through far more reliably -- see the header comment in
// server/routes/mapProxy.js. This proves BOTH branches by forcing them, per
// god's dispatch: (a) discovery succeeds and resolves the build pzmap.org
// itself flags as default via /api/builds/default, including the reversed
// (newest-first) full-list walk when that specific build isn't rendered
// yet; (b) discovery fails outright and the panel still serves the
// hardcoded fallback AND reports it honestly via getB42ResolutionStatus().
// Two source states only: 'dynamic' | 'fallback' -- a client-resolve tier
// was proposed, investigated, and explicitly rejected (see conv-mapbuild)
// because its own success rate couldn't be verified through Cloudflare from
// any browser, and shipping unverifiable fallback machinery would repeat
// the exact "looks healthy, isn't" shape this feature exists to fix.

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args) => mockExecFile(...args),
}));

function curlResult(status, body) {
  return { stdout: `${body}\n__CURL_HTTP_STATUS__:${status}`, stderr: "" };
}

// Maps a URL to a canned curl response. `impl` receives the URL (the last
// non-flag arg before "--") and returns a curlResult(...), or throws an
// Error (simulating curl itself failing / ENOENT) to reject the call.
function mockCurlRouter(impl) {
  mockExecFile.mockImplementation((_file, args, _options, callback) => {
    const url = args[args.length - 1];
    try {
      const result = impl(url);
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  });
}

const GEOMETRY_42_20_0 = {
  tileSize: 2048,
  width: 2318656,
  height: 1019040,
  maxLevel: 22,
};

function dziXml(g) {
  return `<?xml version="1.0"?><Image TileSize="${g.tileSize}" Overlap="0" Format="jpg"><Size Width="${g.width}" Height="${g.height}"/></Image>`;
}

function mapInfoJson() {
  return JSON.stringify({ x0: 1040384, y0: -139296, sqr: 128, skip: 0 });
}

async function freshModule() {
  vi.resetModules();
  return await import("../routes/mapProxy.js");
}

beforeEach(() => {
  mockExecFile.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("getB42Map() discovery: forcing success", () => {
  it("resolves the default-flagged build in one round trip when it's fully rendered", async () => {
    mockCurlRouter((url) => {
      if (url.endsWith("/api/builds/default")) {
        return curlResult(200, JSON.stringify({ id: 10, directory: "42.20.0", default: true }));
      }
      if (url.includes("/base/layer0.dzi")) {
        return curlResult(200, dziXml(GEOMETRY_42_20_0));
      }
      if (url.includes("/base/map_info.json")) {
        return curlResult(200, mapInfoJson());
      }
      throw new Error(`unexpected curl URL in test: ${url}`);
    });

    const { getB42Dir, getB42ResolutionStatus } = await freshModule();
    // hasTileCoverage() uses plain fetch (tile bytes aren't behind the
    // challenge) -- stub global fetch so the HEAD coverage probe succeeds.
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => ({ ok: true }));
    try {
      const dir = await getB42Dir();
      expect(dir).toBe("42.20.0");
      expect(getB42ResolutionStatus()).toEqual({
        source: "dynamic",
        directory: "42.20.0",
        reason: null,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls through to the reversed full-list walk when the default build has no rendered coverage yet, and picks the newest usable one -- proving the ordering fix", async () => {
    // api/builds is oldest-first in real life; a NEWER build than the
    // (unrendered) default sits at the END of a realistic list, and a
    // forward walk would never reach it. This list includes one such case:
    // 42.21.0 (newer than the flagged default, appended last) should win
    // over 42.19.0 (older, appears first).
    const buildList = [
      { directory: "41.78.16", default: false },
      { directory: "42.19.0", default: false },
      { directory: "42.21.0", default: false },
    ];
    mockCurlRouter((url) => {
      if (url.endsWith("/api/builds/default")) {
        // Flagged default (42.20.0) isn't even in the list below -- e.g.
        // listed but pulled -- so this candidate is tried and fails.
        return curlResult(200, JSON.stringify({ directory: "42.20.0", default: true }));
      }
      if (url.endsWith("/api/builds")) {
        return curlResult(200, JSON.stringify(buildList));
      }
      if (url.includes("42.20.0/base/layer0.dzi")) {
        // The default build: geometry reads fine, but has no coverage --
        // simulated via global.fetch below returning ok:false for it only.
        return curlResult(200, dziXml(GEOMETRY_42_20_0));
      }
      if (url.includes("42.21.0/base/layer0.dzi")) {
        return curlResult(200, dziXml(GEOMETRY_42_20_0));
      }
      if (url.includes("/base/map_info.json")) {
        return curlResult(200, mapInfoJson());
      }
      // 41.78.16 / 42.19.0 geometry: never reached if the reverse walk is
      // correct, since 42.21.0 (tried first in a newest-first walk) succeeds.
      throw new Error(`unexpected curl URL in test (would prove the ordering bug): ${url}`);
    });

    const { getB42Dir, getB42ResolutionStatus } = await freshModule();
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => ({ ok: String(url).includes("42.21.0") }));
    try {
      const dir = await getB42Dir();
      expect(dir).toBe("42.21.0");
      expect(getB42ResolutionStatus().source).toBe("dynamic");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("getB42Map() discovery: forcing failure", () => {
  it("falls back to the hardcoded build and reports it honestly when curl itself is unavailable", async () => {
    mockExecFile.mockImplementation((_file, _args, _options, callback) => {
      const err = new Error("spawn curl ENOENT");
      err.code = "ENOENT";
      callback(err);
    });

    const { getB42Dir, getB42ResolutionStatus } = await freshModule();
    const dir = await getB42Dir();
    expect(dir).toBe("42.20.0"); // B42_DIR_FALLBACK

    const status = getB42ResolutionStatus();
    expect(status.source).toBe("fallback");
    expect(status.directory).toBe("42.20.0");
    expect(status.reason).toMatch(/curl is not available/i);
  });

  it("falls back when upstream is reachable but every candidate is unusable", async () => {
    mockCurlRouter((url) => {
      if (url.endsWith("/api/builds/default")) {
        return curlResult(404, "");
      }
      if (url.endsWith("/api/builds")) {
        return curlResult(200, JSON.stringify([{ directory: "41.78.16" }]));
      }
      throw new Error(`unexpected curl URL: ${url}`);
    });

    const { getB42Dir, getB42ResolutionStatus } = await freshModule();
    const dir = await getB42Dir();
    expect(dir).toBe("42.20.0");
    expect(getB42ResolutionStatus().source).toBe("fallback");
  });
});
