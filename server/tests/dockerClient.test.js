import { describe, expect, it } from "vitest";
import { isManagedContainer } from "../services/dockerClient.js";

describe("Docker managed-container boundary", () => {
  it("accepts only containers explicitly opted into panel management", () => {
    expect(isManagedContainer({ Labels: { "zomboid-panel.managed": "true" } })).toBe(true);
    expect(isManagedContainer({ Config: { Labels: { "zomboid-panel.managed": "true" } } })).toBe(true);
    expect(isManagedContainer({ Labels: { "zomboid-panel.role": "pz-server" } })).toBe(false);
    expect(isManagedContainer({ Image: "ich777/steamcmd:projectzomboid", Labels: {} })).toBe(false);
  });
});
