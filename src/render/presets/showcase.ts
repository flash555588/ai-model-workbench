import type { ModelConfig, PresetResult, CellLayout } from "../../domain/models";
import type { PresetHandler, CameraPresetName } from "./base";
import { cam, viewportGrid } from "./base";

/**
 * Showcase: one model from multiple camera angles.
 *
 * Uses models[0] only. Each viewport shows a different angle.
 * If more than one model is provided, extra models are ignored.
 *
 * params:
 *   angles — number of viewing angles: 4 | 6 (default: 4)
 *   radius — camera distance multiplier (default: 2.5)
 */
export const ShowcasePreset: PresetHandler = {
  name: "showcase",
  description: "Single model viewed from multiple angles",
  minModels: 1,
  maxModels: 1,

  compute(models: ModelConfig[], params): PresetResult | null {
    if (models.length < 1) return null;

    const angleCount = Number(params.angles) || 4;
    const radius = Number(params.radius) || 2.5;

    // Model at origin (single model, no offset)
    const placements = [{
      path: models[0].path,
      position: [0, 0, 0] as [number, number, number],
      color: models[0].color,
      wireframe: models[0].wireframe,
    }];

    // Select viewing angles
    const angleNames: CameraPresetName[] = angleCount >= 6
      ? ["front", "side", "top", "back", "iso", "3/4"]
      : ["iso", "front", "side", "top"];

    const cols = angleNames.length <= 4 ? 2 : 3;
    const rows = Math.ceil(angleNames.length / cols);
    const viewports = viewportGrid(cols, rows);

    const cells: CellLayout[] = angleNames.map((name, i) => ({
      modelIndex: 0,
      camera: cam(name, undefined, radius),
      viewport: viewports[i],
    }));

    return { placements, cells };
  },
};
