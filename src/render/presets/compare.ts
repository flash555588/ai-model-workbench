import type { ModelConfig, PresetResult } from "../../domain/models";
import type { PresetHandler, CameraPresetName } from "./base";
import { cam, viewportGrid, linearPositions } from "./base";

/**
 * Compare: side-by-side A/B (or A/B/C) comparison.
 *
 * Models are placed in a row in world space.
 * Each gets its own viewport and independently-rotatable camera.
 *
 * params:
 *   spacing — world-space distance between model centers (default: auto from model size)
 *   angle   — camera angle name: "iso" | "front" | "side" | "top" | "3/4" (default: "iso")
 */
export const ComparePreset: PresetHandler = {
  name: "compare",
  description: "Side-by-side model comparison (2-4 models)",
  minModels: 2,
  maxModels: 4,

  compute(models: ModelConfig[], params): PresetResult | null {
    if (models.length < 2 || models.length > 4) return null;

    const spacing = Number(params.spacing) || 6;
    const angleName = (params.angle as string) || "iso";

    const placements = linearPositions(models, spacing);
    const cols = models.length <= 3 ? models.length : 2;
    const rows = Math.ceil(models.length / cols);
    const viewports = viewportGrid(cols, rows);

    const cells = models.map((_m, i) => ({
      modelIndex: i,
      camera: cam(angleName as CameraPresetName),
      viewport: viewports[i],
    }));

    return { placements, cells };
  },
};
