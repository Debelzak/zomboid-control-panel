import { describe, expect, it } from "vitest";
import { diagnoseTileFailure, parseContentLength } from "../worldMapTileFailureDiagnosis";

describe("diagnoseTileFailure", () => {
  it("identifies a still-gzipped body by its magic number", () => {
    const result = diagnoseTileFailure([0x1f, 0x8b], 5000, "5000");
    expect(result.looksLikeStillGzipped).toBe(true);
    expect(result.looksLikeTruncated).toBe(false);
  });

  it("does not flag an ordinary JPEG (0xFF 0xD8 SOI marker) as gzipped", () => {
    const result = diagnoseTileFailure([0xff, 0xd8], 5000, "5000");
    expect(result.looksLikeStillGzipped).toBe(false);
  });

  it("requires BOTH magic bytes -- a coincidental first byte alone is not proof", () => {
    expect(diagnoseTileFailure([0x1f, 0x00], 5000, "5000").looksLikeStillGzipped).toBe(false);
    expect(diagnoseTileFailure([0x00, 0x8b], 5000, "5000").looksLikeStillGzipped).toBe(false);
  });

  it("flags truncation when fewer bytes arrived than Content-Length declared", () => {
    const result = diagnoseTileFailure([0xff, 0xd8], 4192, "18340");
    expect(result.looksLikeTruncated).toBe(true);
    expect(result.receivedBytes).toBe(4192);
    expect(result.expectedBytes).toBe(18340);
  });

  it("does not flag truncation when the full declared size arrived", () => {
    const result = diagnoseTileFailure([0xff, 0xd8], 18340, "18340");
    expect(result.looksLikeTruncated).toBe(false);
  });

  it("does not flag truncation when MORE bytes arrived than declared -- not the failure this check is for", () => {
    const result = diagnoseTileFailure([0xff, 0xd8], 20000, "18340");
    expect(result.looksLikeTruncated).toBe(false);
  });

  it("cannot claim truncation when Content-Length is absent -- absence is not evidence of a specific size", () => {
    const result = diagnoseTileFailure([0xff, 0xd8], 4192, null);
    expect(result.looksLikeTruncated).toBe(false);
    expect(result.expectedBytes).toBeNull();
  });

  it("treats a malformed Content-Length the same as absent, never guesses a number from it", () => {
    expect(parseContentLength("not-a-number")).toBeNull();
    expect(parseContentLength("18340, 18340")).toBeNull(); // a list, from a misbehaving intermediary
    expect(parseContentLength("-5")).toBeNull();
    expect(parseContentLength("")).toBeNull();
  });

  it("parses a well-formed Content-Length as a plain integer", () => {
    expect(parseContentLength("18340")).toBe(18340);
    expect(parseContentLength("0")).toBe(0);
  });

  it("handles no bytes read at all (e.g. an empty blob) without crashing, and does not claim gzip", () => {
    const result = diagnoseTileFailure(null, 0, "18340");
    expect(result.looksLikeStillGzipped).toBe(false);
    expect(result.looksLikeTruncated).toBe(true);
  });
});
