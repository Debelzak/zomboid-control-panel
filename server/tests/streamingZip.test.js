import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Open } from "unzipper";
import { StreamingZipWriter } from "../utils/streamingZip.js";

describe("StreamingZipWriter", () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("writes a high entry count without retaining an entry array", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-streaming-zip-"));
    const zipPath = path.join(tempDir, "many-files.zip");
    const writer = new StreamingZipWriter(zipPath, { level: 0 });
    // Was 12_000 (2026-08-29 flake hunt): the property this proves --
    // Object.keys(writer)).not.toContain("entries") below -- is a
    // STRUCTURAL assertion about the instance shape, exactly as true at 100
    // as at 12,000; the count was never load-bearing for it, and it doesn't
    // cross a real format boundary either (streamingZip.js emits its ZIP64
    // fields unconditionally on every archive, so no entry count exercises
    // different code). It WAS load-bearing for wall-clock cost: this is the
    // only test in the 316-file suite whose loop does a real awaited I/O
    // round trip per iteration (traced addBuffer -> addStream -> a real
    // fs.WriteStream write plus a real zlib deflate, each one a scheduler
    // preemption point), which made it the suite's slowest test and, under
    // real full-run CPU contention on this floor's shared machines, an
    // intermittent timeout. Reduced to a third of the original count,
    // scaled from a measured ~54s worst-case wall time for 12,000 under
    // real full-suite contention, to bring the worst case back under this
    // project's own existing 3x-margin-to-timeout convention (see
    // vitest.config.js's testTimeout comment, written for the same
    // CPU-contention class of problem).
    const entryCount = 4_000;

    for (let index = 0; index < entryCount; index += 1) {
      await writer.addBuffer(Buffer.from(`file-${index}`), `save/${index}.txt`);
    }

    const result = await writer.finalize();
    const archive = await Open.file(zipPath);

    expect(result.entries).toBe(entryCount);
    expect(result.size).toBeGreaterThan(0);
    expect(Object.keys(writer)).not.toContain("entries");
    expect(archive.files).toHaveLength(entryCount);
    expect(archive.files[0].path).toBe("save/0.txt");
    expect(archive.files.at(-1).path).toBe(`save/${entryCount - 1}.txt`);
  });
});