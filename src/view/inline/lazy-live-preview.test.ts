import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { createLivePreviewPathResolverCache } from "./live-preview-path-cache";

describe("createLivePreviewPathResolverCache", () => {
  const app = {} as App;

  it("caches resolved and missing live preview embed paths", () => {
    let calls = 0;
    const cache = createLivePreviewPathResolverCache(app, (_app, rawPath) => {
      calls += 1;
      return rawPath === "missing.glb" ? null : `models/${rawPath}`;
    });

    expect(cache.resolve("cube.glb")).toBe("models/cube.glb");
    expect(cache.resolve("cube.glb")).toBe("models/cube.glb");
    expect(cache.resolve("missing.glb")).toBeNull();
    expect(cache.resolve("missing.glb")).toBeNull();
    expect(calls).toBe(2);
  });

  it("clears cached live preview embed paths when the vault changes", () => {
    let calls = 0;
    const cache = createLivePreviewPathResolverCache(app, (_app, rawPath) => {
      calls += 1;
      return `models/${rawPath}`;
    });

    expect(cache.resolve("cube.glb")).toBe("models/cube.glb");
    cache.clear();
    expect(cache.resolve("cube.glb")).toBe("models/cube.glb");
    expect(calls).toBe(2);
  });

  it("bounds cached live preview embed paths", () => {
    let calls = 0;
    const cache = createLivePreviewPathResolverCache(app, (_app, rawPath) => {
      calls += 1;
      return `models/${rawPath}`;
    }, 2);

    expect(cache.resolve("one.glb")).toBe("models/one.glb");
    expect(cache.resolve("two.glb")).toBe("models/two.glb");
    expect(cache.resolve("three.glb")).toBe("models/three.glb");
    expect(cache.resolve("one.glb")).toBe("models/one.glb");
    expect(calls).toBe(4);
  });
});
