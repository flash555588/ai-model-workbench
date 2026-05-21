import type { ModelConfig, PresetResult, CellLayout } from "../../domain/models";
import type { PresetHandler, CameraPresetName } from "./base";
import { cam, viewportStrip, linearPositions } from "./base";

/**
 * Timeline: models in a horizontal row, each from the same angle.
 *
 * Useful for showing assembly steps, version progression, or variant comparison.
 * Models are placed side-by-side; a single camera angle is used for all.
 *
 * params:
 *   spacing — world-space distance between models (default: 6)
 *   angle   — camera angle name (default: "3/4")
 */
export const TimelinePreset: PresetHandler = {
  name: "timeline",
  description: "Horizontal progression of models (2-6 models in a strip)",
  minModels: 2,
  maxModels: 6,

  compute(models: ModelConfig[], params): PresetResult | null {
    if (models.length < 2 || models.length > 6) return null;

    const spacing = Number(params.spacing) || 6;
    const angleName = (params.angle as string) || "3/4";

    const placements = linearPositions(models, spacing);
    const viewports = viewportStrip(models.length);

    const cells: CellLayout[] = models.map((_m, i) => ({
      modelIndex: i,
      camera: cam(angleName as CameraPresetName),
      viewport: viewports[i],
    }));

    return { placements, cells };
  },
};
