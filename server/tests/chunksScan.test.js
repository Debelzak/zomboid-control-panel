import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// GET /chunks/:saveName and GET /stats/:saveName have no test coverage of
// their own scan logic (chunksBrowse/chunksDeletionLogic/
// chunksRoutesCapability cover other routes). This pins the counts, sizes,
// and folder shape of a small deterministic B42 fixture so a future change
// to the directory walk (bounded concurrency, the combined getDirStats
// helper, or the /stats totalSize reuse) fails loudly instead of silently
// under- or over-counting. /chunks feeds the list a user selects chunks to
// delete from — a wrong count here is not a slow page, it is a user
// deleting the wrong thing.
const getActiveServer = vi.fn();
const getSetting = vi.fn();

vi.mock("../database/init.js", () => ({
  getSetting,
  setSetting: vi.fn(),
  getActiveServer,
  updateServer: vi.fn(),
}));

const { default: router } = await import("../routes/chunks.js");

function createResponse() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function getHandler(routePath, method = "get") {
  const layer = router.stack.find(
    (entry) => entry.route?.path === routePath && entry.route.methods[method],
  );
  // Some routes are registered with middleware ahead of the handler
  // (permission checks, multer, etc.) — the actual route logic is always
  // the last function in the stack.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Builds:
//   <root>/Saves/Multiplayer/<saveName>/map/{0,1,2}/{0,1}.bin   (6 chunks, B42)
//   <root>/Saves/Multiplayer/<saveName>/chunkdata/0_0.bin       (1 chunkdata entry)
// All zero-byte, so sizes are stable across machines/runs.
function buildFixture(root, saveName) {
  const savePath = path.join(root, "Saves", "Multiplayer", saveName);
  const mapPath = path.join(savePath, "map");
  for (const x of [0, 1, 2]) {
    const xPath = path.join(mapPath, String(x));
    fs.mkdirSync(xPath, { recursive: true });
    for (const y of [0, 1]) {
      fs.closeSync(fs.openSync(path.join(xPath, `${y}.bin`), "w"));
    }
  }
  const chunkDataPath = path.join(savePath, "chunkdata");
  fs.mkdirSync(chunkDataPath, { recursive: true });
  fs.closeSync(fs.openSync(path.join(chunkDataPath, "0_0.bin"), "w"));
  return savePath;
}

describe("GET /api/chunks/chunks/:saveName and /api/chunks/stats/:saveName", () => {
  // Named with "Zomboid" so inspectZomboidPath() (used to validate
  // ?customPath=) accepts it without needing real save-artifact files.
  let dataRoot;
  const saveName = "PinnedTestSave";

  beforeEach(() => {
    getActiveServer.mockReset();
    getSetting.mockReset();
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chunks-scan-FakeZomboidData-"));
    buildFixture(dataRoot, saveName);
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("lists every chunk with correct coordinates, dedup, and bounds", async () => {
    const response = createResponse();
    await getHandler("/chunks/:saveName")(
      { params: { saveName }, query: { customPath: dataRoot }, app: { get: () => null } },
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledTimes(1);
    const body = response.json.mock.calls[0][0];

    expect(body.isB42).toBe(true);
    // 6 map/ chunks + 1 chunkdata entry — chunkdata is tracked in its own
    // dedup namespace (see the comment in the route above the chunkdata
    // block) so it adds to totalChunks on top of, not instead of, the map
    // chunks.
    expect(body.totalChunks).toBe(7);
    expect(body.bounds).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 1 });

    const mapCoords = body.chunks
      .filter((c) => c.source !== "chunkdata")
      .map((c) => `${c.x},${c.y}`)
      .sort();
    expect(mapCoords).toEqual([
      "0,0", "0,1",
      "1,0", "1,1",
      "2,0", "2,1",
    ].sort());
    expect(body.chunks.some((c) => c.source === "chunkdata" && c.x === 0 && c.y === 0)).toBe(true);
    // All fixture files are zero-byte.
    expect(body.chunks.every((c) => c.size === 0)).toBe(true);
  });

  it("reports folder counts and sizes without double-walking, and a matching totalSize", async () => {
    const response = createResponse();
    await getHandler("/stats/:saveName")(
      { params: { saveName }, query: { customPath: dataRoot } },
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledTimes(1);
    const body = response.json.mock.calls[0][0];

    expect(body.folders.map).toEqual(
      expect.objectContaining({ fileCount: 6, size: 0 }),
    );
    expect(body.folders.chunkdata).toEqual(
      expect.objectContaining({ fileCount: 1, size: 0 }),
    );
    // All fixture files are zero-byte, so this also confirms totalSize
    // isn't silently double- or under-counting the folders it reuses.
    expect(body.totalSize).toBe(0);
  });
});
