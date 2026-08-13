import { Material, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createThreeWireframeMaterial,
  createThreeWireframeMaterialValue,
  disposeThreeWireframeOverrides,
} from "./wireframe-materials";

describe("three wireframe materials", () => {
  it("replaces standard materials with an unlit wireframe stand-in", () => {
    const original = new MeshStandardMaterial({ color: 0x445566, opacity: 0.5, transparent: true });

    const wireframe = createThreeWireframeMaterial(original);

    expect(wireframe).toBeInstanceOf(MeshBasicMaterial);
    expect(wireframe).not.toBe(original);
    expect((wireframe as MeshBasicMaterial).wireframe).toBe(true);
    expect((wireframe as MeshBasicMaterial).color.getHex()).toBe(0x445566);
    expect(wireframe.opacity).toBe(0.5);
    expect(wireframe.transparent).toBe(true);
  });

  it("clones other wireframe-capable materials instead of mutating them", () => {
    // MeshPhongMaterial defines `wireframe` but is not a MeshStandardMaterial,
    // so it takes the clone branch rather than the basic-material swap.
    const original = new MeshPhongMaterial({ color: 0x112233 });

    const wireframe = createThreeWireframeMaterial(original);

    expect(wireframe).not.toBe(original);
    expect((wireframe as MeshPhongMaterial).wireframe).toBe(true);
    expect(original.wireframe).toBe(false);
  });

  it("maps material arrays element-wise", () => {
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];

    const wireframe = createThreeWireframeMaterialValue(materials) as Material[];

    expect(wireframe).toHaveLength(2);
    for (const entry of wireframe) {
      expect(entry).toBeInstanceOf(MeshBasicMaterial);
    }
  });

  it("disposes stand-ins without disposing the originals", () => {
    const original = new MeshStandardMaterial();
    const wireframe = createThreeWireframeMaterial(original);
    const originalSpy = vi.spyOn(original, "dispose");
    const wireframeSpy = vi.spyOn(wireframe, "dispose");

    const disposed = disposeThreeWireframeOverrides(wireframe, original);

    expect(disposed).toBe(1);
    expect(wireframeSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy).not.toHaveBeenCalled();
  });

  it("keeps materials that were passed through unchanged", () => {
    // A material with no `wireframe` property is reused verbatim, so it is the
    // original and must not be disposed as if it were a stand-in.
    const shared = new Material();
    const wireframe = createThreeWireframeMaterial(shared);
    const sharedSpy = vi.spyOn(shared, "dispose");

    expect(wireframe).toBe(shared);
    expect(disposeThreeWireframeOverrides(wireframe, shared)).toBe(0);
    expect(sharedSpy).not.toHaveBeenCalled();
  });

  it("disposes only the changed entries of a mixed array", () => {
    const shared = new Material();
    const standard = new MeshStandardMaterial();
    const originals: Material[] = [shared, standard];
    const wireframe = createThreeWireframeMaterialValue(originals) as Material[];
    const sharedSpy = vi.spyOn(shared, "dispose");
    const standardSpy = vi.spyOn(standard, "dispose");

    const disposed = disposeThreeWireframeOverrides(wireframe, originals);

    expect(disposed).toBe(1);
    expect(sharedSpy).not.toHaveBeenCalled();
    expect(standardSpy).not.toHaveBeenCalled();
  });
});
