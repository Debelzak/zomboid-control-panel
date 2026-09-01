import { describe, expect, it } from "vitest";
import {
  resolveApiContractVersion,
  resolveBuildSha,
} from "../../build.js";

describe("standalone build metadata", () => {
  it("uses the supplied build SHA so client and executable builds share provenance", () => {
    expect(resolveBuildSha({ PANEL_BUILD_SHA: "  release-sha  " })).toBe(
      "release-sha",
    );
  });

  it("uses the stable API contract default and rejects malformed overrides", () => {
    expect(resolveApiContractVersion({})).toBe(1);
    expect(resolveApiContractVersion({ PANEL_API_CONTRACT_VERSION: "2" })).toBe(2);
    expect(resolveApiContractVersion({ PANEL_API_CONTRACT_VERSION: "0" })).toBe(1);
    expect(resolveApiContractVersion({ PANEL_API_CONTRACT_VERSION: "nope" })).toBe(1);
  });
});