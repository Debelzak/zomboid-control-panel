// A map tile that decodes successfully never reaches this code -- these
// checks only run when loadViaProxy's <img> element already failed to
// decode bytes that were otherwise received as a complete, valid HTTP
// response (see WorldMap.tsx's loadViaProxy). Two cheap facts already in
// hand at that point turn "coverage" from a hedge into either a specific
// diagnosis or a size proof, with no extra request and no operator devtools
// relay -- the exact lesson from waiting on VastayanWings' X-Tile-Cache
// header: the panel reads the header, the panel does the arithmetic, the
// human reads a sentence.
//
// GZIP magic number (0x1F 0x8B): a response whose bytes start with this is
// still gzip-compressed. If the server never set Content-Encoding: gzip (or
// the browser had already transparently decompressed it, which is the
// normal path), this can't happen -- so its presence means Content-Encoding
// was set on the way out and lost somewhere before the browser decoded the
// body, which is exactly what a reverse proxy stripping or mishandling that
// header produces. This is the strongest possible signal: a positive
// identification, not a guess.
//
// Content-Length vs received size: if fewer bytes arrived than the response
// declared, the body was cut short in transit -- a different failure mode
// (truncation) than a still-compressed body, and one the magic-number check
// alone wouldn't catch (a genuinely truncated gzip stream may not even keep
// its own two leading bytes intact if the truncation is severe, and a
// truncated NON-gzip response wouldn't show the magic number at all).
export interface TileFailureDiagnosis {
  looksLikeStillGzipped: boolean
  looksLikeTruncated: boolean
  receivedBytes: number
  expectedBytes: number | null
}

const GZIP_MAGIC_BYTE_0 = 0x1f
const GZIP_MAGIC_BYTE_1 = 0x8b

export function parseContentLength(contentLengthHeader: string | null): number | null {
  if (contentLengthHeader == null) return null
  // Content-Length is defined as a single decimal integer; anything else
  // (missing, malformed, a list from a misbehaving intermediary) is treated
  // as "we don't actually know the expected size" rather than guessed at.
  if (!/^\d+$/.test(contentLengthHeader)) return null
  return Number(contentLengthHeader)
}

export function diagnoseTileFailure(
  firstTwoBytes: readonly [number, number] | null,
  receivedBytes: number,
  contentLengthHeader: string | null,
): TileFailureDiagnosis {
  const expectedBytes = parseContentLength(contentLengthHeader)
  return {
    looksLikeStillGzipped:
      firstTwoBytes !== null &&
      firstTwoBytes[0] === GZIP_MAGIC_BYTE_0 &&
      firstTwoBytes[1] === GZIP_MAGIC_BYTE_1,
    looksLikeTruncated: expectedBytes !== null && receivedBytes < expectedBytes,
    receivedBytes,
    expectedBytes,
  }
}
