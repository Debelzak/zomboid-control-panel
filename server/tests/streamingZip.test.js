import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import unzipper, { Open } from "unzipper";
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

  // hunt-2026-08-30 (wire-streamingzipwriter-into-backupservice-write-path):
  // pins down a real, previously-undiscovered reason backupService.js still
  // uses archiver instead of this writer. Every prior check of this
  // migration (streamingZip.test.js's own coverage above, and the
  // hive-floor audit that first proved this an unfinished migration) only
  // exercised unzipper's Open.file() -- the CENTRAL-DIRECTORY reader, used
  // by _verifyExtractedIntegrity() and getBackupSnapshot(). That path works
  // fine against this writer's output, because the central directory always
  // carries real, final crc32/size values.
  //
  // backupService.restoreBackup()'s actual extraction goes through a
  // DIFFERENT unzipper API -- unzip.Parse(), a streaming LOCAL-header
  // reader -- and that path cannot read this writer's output at all, for
  // every single file entry, not just an edge case:
  //
  //   1. This writer always sets DATA_DESCRIPTOR_FLAG (bit 3) AND writes
  //      0xFFFFFFFF placeholders into the local header's compressed/
  //      uncompressed size fields (localFileHeader(), streamingZip.js)
  //      REGARDLESS of the entry's real size -- not only for entries that
  //      actually need zip64. Per PKZIP APPNOTE 4.3.9.1, when bit 3 is set
  //      those local-header size fields "MUST be set to zero" -- 0xFFFFFFFF
  //      is reserved to mean "the real value is in the zip64 extra field,"
  //      a different signal this writer is not actually using at the local
  //      header for these entries (it only becomes accurate later, in the
  //      central directory). Writing the zip64 sentinel while ALSO using a
  //      data descriptor conflates two different escape hatches.
  //   2. unzipper's parse.js computes `fileSizeKnown = !(flags & 0x08) ||
  //      compressedSize > 0` (Parse.prototype._readFile). Since this
  //      writer's local header always reads compressedSize as 0xFFFFFFFF
  //      (a huge positive number), that evaluates true -- unzipper
  //      concludes the size IS known, as ~4GiB, and tries to stream that
  //      many bytes as this entry's compressed data instead of watching for
  //      the data descriptor. It reads straight through the real entry,
  //      the central directory, and the end-of-central-directory record,
  //      then desyncs completely and throws "invalid signature" trying to
  //      parse whatever garbage bytes it lands on next as a new record.
  //
  // Confirmed by elimination: the identical Parse() call against a real
  // archiver-written zip (this project's actual production writer today)
  // succeeds without incident, and a StreamingZipWriter zip containing only
  // directory entries (no data descriptor involved) also parses fine -- the
  // failure is specific to file entries, i.e. exactly the data-descriptor
  // path this migration would need.
  //
  // PRACTICAL EFFECT: if backupService.js's write path were switched to
  // this writer today, every future backup would create "successfully"
  // (no error, checksums self-consistent via Open.file()) but be
  // completely unrestorable -- restoreBackup would reject on the very
  // first file it tries to extract. That is precisely the failure mode
  // god's dispatch asked to rule out before wiring anything in: "if any
  // part of this cannot be verified end to end -- write, read back,
  // extract, checksum -- leave that part on archiver and say why." This
  // is that "why," pinned as a real, currently-passing (because it proves
  // the CURRENT, broken behavior) regression test rather than left as a
  // one-off finding in a chat log. Flip this test's expectation (and add a
  // byte-for-byte content assertion) the day someone fixes
  // localFileHeader()'s size fields to be spec-correct -- that fix, proven
  // by THIS test going from "throws" to "extracts correctly," is the real
  // remaining blocker on the migration, not anything in backupService.js
  // itself.
  it("its output cannot be read by unzipper's streaming Parse() -- the API backupService.restoreBackup() actually uses", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zcp-streaming-zip-parse-"));
    const zipPath = path.join(tempDir, "single-file.zip");
    const srcFile = path.join(tempDir, "source.txt");
    fs.writeFileSync(srcFile, "some real backup content, nothing exotic\n".repeat(100));

    const writer = new StreamingZipWriter(zipPath, { level: 6 });
    await writer.addFile(srcFile, "world/source.txt");
    await writer.finalize();

    const parseAttempt = new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry) => entry.autodrain())
        .on("close", resolve)
        .on("error", reject);
    });

    await expect(parseAttempt).rejects.toThrow(/invalid signature/);
  });
});