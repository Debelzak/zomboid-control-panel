import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hunt-wave10-2026-08-29, suspect 4 (REAL): serveTile() set
// Cache-Control: public, max-age=604800 (7 days) on every tile response,
// but the browser-facing URL (/api/map/tiles/:level/:tile) has no
// component identifying WHICH resolved B42 build (getB42Dir()) produced
// the bytes -- only this server's own disk cache is namespaced by that
// build directory (relPath includes `dir`). If the resolved build changes
// while a browser still holds a 7-day-old cached response for the same
// URL, that browser keeps showing bytes from the OLD build indefinitely
// (up to the rest of the 7-day window) -- "operator regenerates map,
// browser keeps showing the old world", the exact shape god's card named.
//
// Fix: bound the browser-facing Cache-Control to the same freshness
// window as /resolve's own descriptor (1h), so staleness can never
// outlive the client's own belief about the current build by more than
// that -- serveTile's own disk/mem tiers stay correctly namespaced by
// `dir` and keep making a "miss" here instant, so this costs nothing on
// the hot path, only bounds how long a WRONG answer can survive.
//
// This test calls the real route handlers directly (same pattern as
// mapProxyRenderedMaxLevel.test.js's findRoute helper) against all three
// cache tiers (miss / hit-mem / hit-disk) for both tile routes that go
// through serveTile() with a `dir`-namespaced disk path (/tiles,
// /toptiles) plus /b41tiles (fixed build, still shares serveTile()).

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args) => mockExecFile(...args),
}));

function curlResult(status, body) {
  return { stdout: `${body}\n__CURL_HTTP_STATUS__:${status}`, stderr: "" };
}

function mockCurlRouter(impl) {
  mockExecFile.mockImplementation((_file, args, _options, callback) => {
    const url = args[args.length - 1];
    try {
      callback(null, impl(url));
    } catch (err) {
      callback(err);
    }
  });
}

const GEOMETRY_42_20_0 = { tileSize: 2048, width: 2318656, height: 1019040 };

function dziXml(g) {
  return `<?xml version="1.0"?><Image TileSize="${g.tileSize}" Overlap="0" Format="jpg"><Size Width="${g.width}" Height="${g.height}"/></Image>`;
}

function mapInfoJson() {
  return JSON.stringify({ x0: 1040384, y0: -139296, sqr: 128, skip: 0 });
}

function mockCurlForB42_20_0() {
  mockCurlRouter((url) => {
    if (url.endsWith("/api/builds/default")) {
      return curlResult(200, JSON.stringify({ directory: "42.20.0", default: true }));
    }
    if (url.includes("/base/layer0.dzi")) return curlResult(200, dziXml(GEOMETRY_42_20_0));
    if (url.includes("/base/map_info.json")) return curlResult(200, mapInfoJson());
    throw new Error(`unexpected curl URL in test: ${url}`);
  });
}

// Real upstream tile bytes for GET requests; HEAD requests (coverage
// probes / discoverRenderedMaxLevel's binary search) always report covered
// so build resolution completes without needing to model the search.
function mockFetchServingTiles() {
  return vi.fn(async (url, init) => {
    if ((init?.method || "GET") === "HEAD") return { ok: true };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("fake-jpeg-bytes").buffer,
    };
  });
}

function findRoute(router, routePath, method) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let sentBody = null;
  return {
    headers,
    get statusCode() {
      return statusCode;
    },
    get sentBody() {
      return sentBody;
    },
    set(name, value) {
      headers[name] = value;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    end() {
      return this;
    },
    send(body) {
      sentBody = body;
      return this;
    },
    json(body) {
      sentBody = body;
      return this;
    },
  };
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

describe("suspect 4 (REAL): tile Cache-Control must not outlive the build-resolution freshness window", () => {
  it("/tiles: a fresh upstream fetch (tier-3 miss) is capped at the /resolve freshness window, not 7 days", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");
      const res = makeRes();
      await handler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, res);

      expect(res.headers["X-Tile-Cache"]).toBe("miss");
      expect(res.headers["Cache-Control"]).not.toMatch(/604800/);
      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/tiles: an in-memory hit (tier-1) reports the SAME bounded Cache-Control as a miss, not the old long-lived value", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");

      const first = makeRes();
      await handler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, first);
      expect(first.headers["X-Tile-Cache"]).toBe("miss");

      const second = makeRes();
      await handler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, second);
      expect(second.headers["X-Tile-Cache"]).toBe("hit-mem");
      expect(second.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/tiles: a disk hit (tier-2, fresh module instance so tier-1 is cold) ALSO reports the bounded Cache-Control -- proving the fix covers all three tiers, not just the miss path", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");
      const warm = makeRes();
      await handler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, warm);
      expect(warm.headers["X-Tile-Cache"]).toBe("miss");
      // writeDiskCacheAsync is fire-and-forget; give its promise chain a turn.
      await new Promise((r) => setTimeout(r, 50));

      mockCurlForB42_20_0();
      const { default: freshRouter } = await freshModule();
      const freshHandler = findRoute(freshRouter, "/tiles/:level/:tile", "get");
      const cold = makeRes();
      await freshHandler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, cold);

      expect(cold.headers["X-Tile-Cache"]).toBe("hit-disk");
      expect(cold.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/toptiles: a fresh fetch is also capped, not 7 days (proves the fix isn't scoped to only the /tiles call site)", async () => {
    mockCurlRouter((url) => {
      if (url.endsWith("/api/builds/default")) {
        return curlResult(200, JSON.stringify({ directory: "42.20.0", default: true }));
      }
      if (url.includes("/base/layer0.dzi")) return curlResult(200, dziXml(GEOMETRY_42_20_0));
      if (url.includes("/base/map_info.json")) return curlResult(200, mapInfoJson());
      if (url.endsWith("/base_top/layer0.dzi")) {
        return curlResult(200, '<?xml version="1.0"?><Image Format="webp"/>');
      }
      throw new Error(`unexpected curl URL in test: ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/toptiles/:level/:tile", "get");
      const res = makeRes();
      await handler({ params: { level: "5", tile: "2_3.webp" }, query: {} }, res);

      expect(res.headers["X-Tile-Cache"]).toBe("miss");
      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/b41tiles: also capped, even though B41's directory is a fixed constant -- the freshness bound is uniform across all three tile routes since they share serveTile()", async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/b41tiles/:level/:tile", "get");
      const res = makeRes();
      await handler({ params: { level: "5", tile: "2_3.jpg" }, query: {} }, res);

      expect(res.headers["X-Tile-Cache"]).toBe("miss");
      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// hunt-wave12-2026-08-30 (version-the-tile-url-by-resolved-b42-build): the
// 1h cap above bounds staleness, it doesn't eliminate it. The complete fix
// is to put the resolved B42 build into the browser-facing tile URL
// (WorldMap.tsx / ChunkCleaner.tsx append `?v=<b42Dir>` once they know it --
// see worldMapTileUrl.ts) so two different builds are two different URLs,
// making the URL itself an accurate cache key. Once true, correctness no
// longer trades against cache lifetime, so a request carrying that marker
// can safely be cached indefinitely -- these tests cover the SERVER half:
// presence of `?v=` (any non-empty value; the server never inspects it
// past that, see requestIsVersioned's own comment) switches the response
// to the long/immutable Cache-Control, while its absence keeps the
// original bounded value as the safe fallback for anything that hasn't
// opted in (an old cached JS bundle from before this change, a manual
// request). /b41tiles never switches regardless of `v` -- its directory is
// a hardcoded literal, never dynamically resolved, so there's nothing to
// version there.
describe("suspect 4 follow-up (REAL): a versioned request (?v=<build>) gets a long-lived Cache-Control, matching the accurate cache key", () => {
  it("/tiles: a request WITH ?v= gets the long/immutable Cache-Control instead of the bounded fallback", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");
      const res = makeRes();
      await handler(
        { params: { level: "6", tile: "3_4.jpg" }, query: { v: "42.20.0" } },
        res,
      );

      expect(res.headers["X-Tile-Cache"]).toBe("miss");
      expect(res.headers["Cache-Control"]).toBe("public, max-age=604800, immutable");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/tiles: an in-memory hit for a versioned request ALSO reports the long-lived Cache-Control -- the upgrade applies uniformly across cache tiers, same discipline as the original bounded fix", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");

      const first = makeRes();
      await handler(
        { params: { level: "6", tile: "3_5.jpg" }, query: { v: "42.20.0" } },
        first,
      );
      expect(first.headers["X-Tile-Cache"]).toBe("miss");

      const second = makeRes();
      await handler(
        { params: { level: "6", tile: "3_5.jpg" }, query: { v: "42.20.0" } },
        second,
      );
      expect(second.headers["X-Tile-Cache"]).toBe("hit-mem");
      expect(second.headers["Cache-Control"]).toBe("public, max-age=604800, immutable");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/tiles: a request WITHOUT ?v= still gets the original bounded Cache-Control -- the safe fallback for anything that hasn't opted in", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");
      const res = makeRes();
      await handler({ params: { level: "6", tile: "3_6.jpg" }, query: {} }, res);

      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/tiles: an empty-string ?v= is treated the same as absent -- not a signal of anything", async () => {
    mockCurlForB42_20_0();
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/tiles/:level/:tile", "get");
      const res = makeRes();
      await handler({ params: { level: "6", tile: "3_7.jpg" }, query: { v: "" } }, res);

      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/toptiles: a request WITH ?v= also gets the long-lived Cache-Control", async () => {
    mockCurlRouter((url) => {
      if (url.endsWith("/api/builds/default")) {
        return curlResult(200, JSON.stringify({ directory: "42.20.0", default: true }));
      }
      if (url.includes("/base/layer0.dzi")) return curlResult(200, dziXml(GEOMETRY_42_20_0));
      if (url.includes("/base/map_info.json")) return curlResult(200, mapInfoJson());
      if (url.endsWith("/base_top/layer0.dzi")) {
        return curlResult(200, '<?xml version="1.0"?><Image Format="webp"/>');
      }
      throw new Error(`unexpected curl URL in test: ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/toptiles/:level/:tile", "get");
      const res = makeRes();
      await handler(
        { params: { level: "6", tile: "3_8.webp" }, query: { v: "42.20.0" } },
        res,
      );

      expect(res.headers["Cache-Control"]).toBe("public, max-age=604800, immutable");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("/b41tiles: NEVER switches to the long-lived value, even with ?v= supplied -- its directory is a hardcoded literal, not dynamically resolved, so there's nothing to accurately version against", async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchServingTiles();
    try {
      const { default: router } = await freshModule();
      const handler = findRoute(router, "/b41tiles/:level/:tile", "get");
      const res = makeRes();
      await handler(
        { params: { level: "6", tile: "3_9.jpg" }, query: { v: "41.78.16" } },
        res,
      );

      expect(res.headers["Cache-Control"]).toBe("public, max-age=3600");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
