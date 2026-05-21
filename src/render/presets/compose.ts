import type {
  ModelConfig,
  ComposeSection,
  PresetResult,
  ViewportRect,
} from "../../domain/models";
import type { PresetHandler } from "./base";

/**
 * Compose: combine multiple presets into one code block.
 *
 * Each section runs its own preset independently. Results are remapped
 * into the section's viewport bounds based on weights.
 *
 * params (from GridBlockConfig, not params):
 *   direction — "horizontal" (default) or "vertical"
 *   gap       — gap between sections in normalized units (default: 0.02)
 */
export const ComposePreset: PresetHandler = {
  name: "compose",
  description: "Combine multiple presets into one layout",
  minModels: 1,
  maxModels: 32,

  compute(_models: ModelConfig[], _params, _extra?: Record<string, unknown>): PresetResult | null {
    // Compose is handled specially in code-block.ts — this handler exists
    // only for registry listing. Actual computation happens in composeSections().
    return null;
  },
};

/**
 * Compute a composed layout from multiple sections.
 * Called directly from code-block.ts, not through the preset registry.
 *
 * @param resolvePreset - injected to avoid circular dependency with index.ts
 */
export function composeSections(
  sections: ComposeSection[],
  direction: "horizontal" | "vertical",
  gap: number,
  resolvePath: (raw: string | ModelConfig) => ModelConfig | null,
  resolvePreset: (name: string) => PresetHandler | undefined,
): PresetResult | null {
  if (!sections || sections.length === 0) return null;

  // Compute total weight
  const totalWeight = sections.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  if (totalWeight <= 0) return null;

  // Build section bounds
  const sectionBounds: ViewportRect[] = [];
  let offset = 0;

  for (const section of sections) {
    const w = (section.weight ?? 1) / totalWeight;
    const effectiveSize = w * (1 - gap * (sections.length + 1));

    if (direction === "horizontal") {
      sectionBounds.push({
        x: gap + offset,
        y: gap,
        w: effectiveSize,
        h: 1 - 2 * gap,
      });
    } else {
      // Vertical: y=0 is bottom in Babylon viewport
      sectionBounds.push({
        x: gap,
        y: gap + offset,
        w: 1 - 2 * gap,
        h: effectiveSize,
      });
    }

    offset += effectiveSize + gap;
  }

  // Compute each section's preset
  const allPlacements: PresetResult["placements"] = [];
  const allCells: PresetResult["cells"] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const preset = resolvePreset(section.preset);
    if (!preset) {
      console.warn(`[AI3D Compose] Unknown preset: "${section.preset}"`);
      continue;
    }

    // Resolve models for this section
    const sectionModels: ModelConfig[] = [];
    for (const entry of section.models) {
      const resolved = resolvePath(entry);
      if (!resolved) {
        console.warn(`[AI3D Compose] Model not found: ${typeof entry === "string" ? entry : entry.path}`);
        continue;
      }
      sectionModels.push(resolved);
    }

    if (sectionModels.length < preset.minModels) continue;

    const result = preset.compute(sectionModels, section.params ?? {});
    if (!result) continue;

    // Remap placements (offset by current placement count)
    const placementOffset = allPlacements.length;
    for (const p of result.placements) {
      allPlacements.push(p);
    }

    // Remap cells: adjust modelIndex and remap viewports into section bounds
    const bounds = sectionBounds[i];
    for (const cell of result.cells) {
      allCells.push({
        modelIndex: cell.modelIndex + placementOffset,
        camera: cell.camera,
        viewport: remapViewport(cell.viewport, bounds),
      });
    }
  }

  if (allCells.length === 0) return null;
  return { placements: allPlacements, cells: allCells };
}

/**
 * Remap a viewport from local (0-1) coordinates into a target bounds rectangle.
 */
function remapViewport(local: ViewportRect, bounds: ViewportRect): ViewportRect {
  return {
    x: bounds.x + local.x * bounds.w,
    y: bounds.y + local.y * bounds.h,
    w: local.w * bounds.w,
    h: local.h * bounds.h,
  };
}
