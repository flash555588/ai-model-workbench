import { describe, expect, it } from "vitest";

import { guardThreeUrl, isThreeRemoteUrl } from "./network-guard";

describe("Three network guard", () => {
  it("treats explicit remote schemes as remote", () => {
    expect(isThreeRemoteUrl("https://example.com/a.bin")).toBe(true);
    expect(isThreeRemoteUrl("http://example.com/a.bin")).toBe(true);
    expect(isThreeRemoteUrl("ws://example.com/a.bin")).toBe(true);
    expect(isThreeRemoteUrl("wss://example.com/a.bin")).toBe(true);
    expect(isThreeRemoteUrl("ftp://example.com/a.bin")).toBe(true);
    expect(isThreeRemoteUrl("//cdn.example.com/a.bin")).toBe(true);
  });

  it("allows locally produced and vault-relative URLs", () => {
    // The GLTF resolver hands blob URLs back to the loader, so they must pass.
    expect(isThreeRemoteUrl("blob:app://obsidian.md/1234")).toBe(false);
    expect(isThreeRemoteUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isThreeRemoteUrl("textures/color.png")).toBe(false);
    expect(isThreeRemoteUrl("../shared/geometry.bin")).toBe(false);
    expect(isThreeRemoteUrl("/absolute/vault/path.bin")).toBe(false);
    expect(isThreeRemoteUrl("")).toBe(false);
  });

  it("ignores surrounding whitespace when classifying", () => {
    expect(isThreeRemoteUrl("  https://example.com/a.bin  ")).toBe(true);
  });

  it("throws for remote URLs and passes local URLs through", () => {
    expect(() => guardThreeUrl("https://example.com/a.bin", "test channel"))
      .toThrow(/Refused remote URL/);
    expect(guardThreeUrl("textures/color.png", "test channel")).toBe("textures/color.png");
  });
});
