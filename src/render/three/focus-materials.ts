import { Material } from "three";

const FOCUS_DIM_OPACITY = 0.242;

export function createFocusDimMaterial(material: Material): Material {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = Math.max(0, Math.min(1, material.opacity)) * FOCUS_DIM_OPACITY;
  clone.depthWrite = false;
  clone.needsUpdate = true;
  return clone;
}

function createFocusDimMaterialValue(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material)
    ? material.map(createFocusDimMaterial)
    : createFocusDimMaterial(material);
}

function focusDimMaterialKey(material: Material | Material[]): string {
  return Array.isArray(material)
    ? material.map((entry) => entry.uuid).join("|")
    : material.uuid;
}

function disposeMaterialValue(material: Material | Material[] | undefined): void {
  if (!material) return;
  for (const entry of Array.isArray(material) ? material : [material]) {
    entry.dispose();
  }
}

export class ThreeFocusDimMaterialCache {
  private readonly materials = new Map<string, Material | Material[]>();

  get(original: Material | Material[]): Material | Material[] {
    const key = focusDimMaterialKey(original);
    const existing = this.materials.get(key);
    if (existing) {
      return existing;
    }
    const next = createFocusDimMaterialValue(original);
    this.materials.set(key, next);
    return next;
  }

  clear(): void {
    for (const material of this.materials.values()) {
      disposeMaterialValue(material);
    }
    this.materials.clear();
  }

  get size(): number {
    return this.materials.size;
  }
}
