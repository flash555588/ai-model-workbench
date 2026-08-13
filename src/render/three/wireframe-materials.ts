import { Material, MeshBasicMaterial, MeshStandardMaterial } from "three";

function materialList(material: Material | Material[] | undefined | null): Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/**
 * Build the wireframe stand-in for one material.
 *
 * Standard materials are replaced with an unlit basic material so wireframe view
 * stays readable regardless of lighting. Materials without a `wireframe` property
 * are returned as-is, which means the caller must not dispose them later.
 */
export function createThreeWireframeMaterial(material: Material): Material {
  if (material instanceof MeshStandardMaterial) {
    const basic = new MeshBasicMaterial({
      color: material.color,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      visible: material.visible,
    });
    basic.wireframe = true;
    return basic;
  }
  if ("wireframe" in material) {
    const clone = material.clone();
    (clone as Material & { wireframe: boolean }).wireframe = true;
    return clone;
  }
  return material;
}

export function createThreeWireframeMaterialValue(
  material: Material | Material[],
): Material | Material[] {
  return Array.isArray(material)
    ? material.map(createThreeWireframeMaterial)
    : createThreeWireframeMaterial(material);
}

/**
 * Dispose wireframe stand-ins while leaving the originals intact.
 *
 * `createThreeWireframeMaterial` passes some materials through unchanged, so any
 * entry also present in `original` is shared and must survive.
 */
export function disposeThreeWireframeOverrides(
  current: Material | Material[] | undefined | null,
  original: Material | Material[] | undefined | null,
): number {
  const keep = new Set(materialList(original).map((material) => material.uuid));
  let disposed = 0;
  for (const material of materialList(current)) {
    if (keep.has(material.uuid)) continue;
    material.dispose();
    disposed++;
  }
  return disposed;
}
