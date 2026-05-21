import type { ModelConfig, PresetResult, CellLayout } from "../../domain/models";
import type { PresetHandler, CameraPresetName } from "./base";
import { cam, viewportGrid, ringPositions } from "./base";

/**
 * Explode: parts arranged spatially, each from the same viewing angle.
 *
 * Models are placed in a ring around the origin. Each gets its own viewport
 * with the same camera angle for consistent comparison.
 *
 * params:
 *   radius — world-space radius of the ring (default: 8)
 *   angle  — camera angle name (default: "iso")
 */
export const ExplodePreset: PresetHandler = {
  name: "explode",
  description: "Spatial arrangement of parts (3-8 models in a ring)",
  minModels: 3,
  maxModels: 8,

  compute(models: ModelConfig[], params): PresetResult | null {
    if (models.length < 3 || models.length > 8) return null;

    const radius = Number(params.radius) || 8;
    const angleName = (params.angle as string) || "iso";

    const placements = ringPositions(models, radius);

    // Layout: up to 4 columns
    const cols = Math.min(models.length, 4);
    const rows = Math.ceil(models.length / cols);
    const viewports = viewportGrid(cols, rows);

    const cells: CellLayout[] = models.map((_m, i) => ({
      modelIndex: i,
      camera: cam(angleName as CameraPresetName),
      viewport: viewports[i],
    }));

    return { placements, cells };
  },
};
