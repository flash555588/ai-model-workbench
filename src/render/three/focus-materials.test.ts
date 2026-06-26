import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { ThreeFocusDimMaterialCache } from "./focus-materials";

describe("Three focus dim material cache", () => {
  it("reuses one dim material for meshes sharing the same original material", () => {
    const original = new MeshStandardMaterial({ opacity: 0.5, transparent: true });
    const cache = new ThreeFocusDimMaterialCache();

    const first = cache.get(original);
    const second = cache.get(original);

    expect(first).toBe(second);
    expect(first).not.toBe(original);
    expect(Array.isArray(first)).toBe(false);
    expect(cache.size).toBe(1);
    if (!Array.isArray(first)) {
      expect(first.transparent).toBe(true);
      expect(first.depthWrite).toBe(false);
      expect(first.opacity).toBeLessThan(original.opacity);
    }
  });

  it("reuses dim material arrays for multi-material meshes", () => {
    const base = new MeshStandardMaterial({ name: "base" });
    const accent = new MeshBasicMaterial({ name: "accent" });
    const cache = new ThreeFocusDimMaterialCache();

    const first = cache.get([base, accent]);
    const second = cache.get([base, accent]);

    expect(first).toBe(second);
    expect(cache.size).toBe(1);
    expect(Array.isArray(first)).toBe(true);
    if (Array.isArray(first)) {
      expect(first).toHaveLength(2);
      expect(first[0]).not.toBe(base);
      expect(first[1]).not.toBe(accent);
    }
  });

  it("disposes cached dim materials once on clear", () => {
    const original = new MeshStandardMaterial();
    const cache = new ThreeFocusDimMaterialCache();
    const dim = cache.get(original);
    if (Array.isArray(dim)) {
      throw new Error("Expected a single material");
    }
    const disposeSpy = vi.spyOn(dim, "dispose");

    cache.clear();
    cache.clear();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});
