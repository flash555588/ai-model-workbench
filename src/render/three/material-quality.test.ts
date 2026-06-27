import { BufferAttribute, BufferGeometry, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import {
  getAdaptivePointSize,
  getThreeTextureAnisotropyBudget,
  prepareThreeMaterialForColorAccuracy,
} from "./material-quality";

describe("Three material quality helpers", () => {
  it("sets sRGB only for color texture slots", () => {
    const colorMap = new Texture();
    const normalMap = new Texture();
    const roughnessMap = new Texture();
    const material = new MeshStandardMaterial({
      map: colorMap,
      normalMap,
      roughnessMap,
    });

    const audit = prepareThreeMaterialForColorAccuracy(material, 8);

    expect(audit.textureCount).toBe(3);
    expect(audit.colorTextureCount).toBe(1);
    expect(audit.srgbColorTextureCount).toBe(1);
    expect(colorMap.colorSpace).toBe("srgb");
    expect(normalMap.colorSpace).not.toBe("srgb");
    expect(roughnessMap.colorSpace).not.toBe("srgb");
    expect(colorMap.anisotropy).toBe(8);
    expect(normalMap.anisotropy).toBe(8);
  });

  it("scales texture anisotropy by render quality", () => {
    expect(getThreeTextureAnisotropyBudget(16, "low")).toBe(1);
    expect(getThreeTextureAnisotropyBudget(16, "medium")).toBe(4);
    expect(getThreeTextureAnisotropyBudget(16, "high")).toBe(16);
    expect(getThreeTextureAnisotropyBudget(2, "medium")).toBe(2);
    expect(getThreeTextureAnisotropyBudget(0, "high")).toBe(1);
  });

  it("scales PLY point size with model span", () => {
    const small = new BufferGeometry();
    small.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 0.01, 0, 0]), 3));

    const large = new BufferGeometry();
    large.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 20, 0, 0]), 3));

    expect(getAdaptivePointSize(small)).toBeLessThan(getAdaptivePointSize(large));
    expect(getAdaptivePointSize(small)).toBeGreaterThanOrEqual(0.0005);
    expect(getAdaptivePointSize(large)).toBeLessThanOrEqual(0.05);
  });
});
