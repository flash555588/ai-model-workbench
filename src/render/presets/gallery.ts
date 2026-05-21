import type { ModelConfig, PresetResult, CellLayout } from "../../domain/models";
import type { PresetHandler, CameraPresetName } from "./base";
import { cam, viewportGrid } from "./base";

/**
 * Gallery: all models in one scene, one camera, world-space grid arrangement.
 *
 * Models are placed in a 2D grid on the XZ plane. A single camera
 * orbits the center of the whole arrangement. No layerMask limit —
 * supports any number of models.
 *
 * params:
 *   spacing — distance between model centers (default: 6)
 *   cols    — columns in world-space grid (default: auto → ceil(sqrt(n)))
 *   angle   — camera angle name (default: "iso")
 */
export const GalleryPreset: PresetHandler = {
  name: "gallery",
  description: "All models in one scene, single camera (no cell limit)",
  minModels: 1,
  maxModels: 32,

  compute(models: ModelConfig[], params): PresetResult | null {
    if (models.length === 0) return null;

    const spacing = Number(params.spacing) || 6;
    const angleName = (params.angle as string) || "iso";
    const colsParam = Number(params.cols) || 0;
    const cols = colsParam > 0 ? colsParam : Math.ceil(Math.sqrt(models.length));
    const rows = Math.ceil(models.length / cols);

    // Place models on XZ plane, centered at origin
    const placements = models.map((m, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * spacing;
      const z = (row - (rows - 1) / 2) * spacing;
      return {
        path: m.path,
        position: [x, 0, z] as [number, number, number],
        color: m.color,
        wireframe: m.wireframe,
      };
    });

    // Single viewport, single camera seeing everything
    const viewports = viewportGrid(1, 1, 0);
    const cells: CellLayout[] = [{
      modelIndex: 0, // camera targets scene center, not a specific model
      camera: cam(angleName as CameraPresetName, undefined, 3 + Math.max(cols, rows) * 0.5),
      viewport: viewports[0],
    }];

    return { placements, cells };
  },
};
