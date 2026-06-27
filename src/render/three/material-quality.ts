import {
  BufferGeometry,
  Material,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three";

const COLOR_TEXTURE_SLOTS = new Set([
  "map",
  "emissiveMap",
  "specularMap",
  "specularColorMap",
  "sheenColorMap",
  "clearcoatColorMap",
]);

export interface ThreeTextureAudit {
  textureCount: number;
  colorTextureCount: number;
  srgbColorTextureCount: number;
}

export type ThreeRenderQuality = "low" | "medium" | "high";

export function isThreeColorTextureSlot(name: string): boolean {
  return COLOR_TEXTURE_SLOTS.has(name);
}

export function getThreeTextureAnisotropyBudget(maxAnisotropy: number, quality: ThreeRenderQuality): number {
  const safeMax = Number.isFinite(maxAnisotropy) && maxAnisotropy > 0 ? Math.floor(maxAnisotropy) : 1;
  if (quality === "low") {
    return 1;
  }
  if (quality === "medium") {
    return Math.min(safeMax, 4);
  }
  return safeMax;
}

export function prepareThreeMaterialForColorAccuracy(material: Material, anisotropy: number): ThreeTextureAudit {
  const record = material as unknown as Record<string, unknown>;
  const audit: ThreeTextureAudit = {
    textureCount: 0,
    colorTextureCount: 0,
    srgbColorTextureCount: 0,
  };

  for (const [name, value] of Object.entries(record)) {
    if (!(value instanceof Texture)) continue;
    audit.textureCount++;
    value.anisotropy = Math.max(value.anisotropy, anisotropy);
    if (isThreeColorTextureSlot(name)) {
      audit.colorTextureCount++;
      value.colorSpace = SRGBColorSpace;
      audit.srgbColorTextureCount++;
    }
    value.needsUpdate = true;
  }

  material.needsUpdate = true;
  return audit;
}

export function getAdaptivePointSize(geometry: BufferGeometry): number {
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  const box = geometry.boundingBox;
  if (!box) return 0.02;
  const size = box.getSize(new Vector3());
  const span = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(span) || span <= 0) return 0.02;
  return Math.min(Math.max(span / 180, 0.0005), 0.05);
}
