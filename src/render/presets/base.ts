import type {
  ModelConfig,
  ModelPlacement,
  PresetCameraDef,
  ViewportRect,
  PresetResult,
} from "../../domain/models";

// ── Camera presets (ArcRotateCamera α/β in radians) ─────────────────

export const CAMERA_PRESETS = {
  iso:       { alpha: Math.PI / 4,  beta: Math.PI / 3  },
  front:     { alpha: 0,            beta: Math.PI / 2  },
  side:      { alpha: Math.PI / 2,  beta: Math.PI / 2  },
  top:       { alpha: 0,            beta: 0.01          },
  back:      { alpha: Math.PI,      beta: Math.PI / 2  },
  "3/4":     { alpha: Math.PI / 6,  beta: Math.PI / 3.5 },
} as const;

export type CameraPresetName = keyof typeof CAMERA_PRESETS;

/**
 * Create a PresetCameraDef from a named preset or explicit angles.
 */
export function cam(
  presetOrAlpha: CameraPresetName | number,
  beta?: number,
  radiusMultiplier = 2.5,
): PresetCameraDef {
  if (typeof presetOrAlpha === "string") {
    const p = CAMERA_PRESETS[presetOrAlpha] ?? CAMERA_PRESETS.iso;
    return { alpha: p.alpha, beta: p.beta, radiusMultiplier };
  }
  return { alpha: presetOrAlpha, beta: beta ?? Math.PI / 3, radiusMultiplier };
}

// ── Viewport grid helpers ───────────────────────────────────────────

/**
 * Generate a uniform grid of viewport rectangles.
 * Babylon viewport: (0,0) = bottom-left, (1,1) = top-right.
 */
export function viewportGrid(cols: number, rows: number, gap = 0.02): ViewportRect[] {
  const cellW = (1 - gap * (cols + 1)) / cols;
  const cellH = (1 - gap * (rows + 1)) / rows;
  const rects: ViewportRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: gap + c * (cellW + gap),
        y: gap + (rows - 1 - r) * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return rects;
}

/** Horizontal strip of equal-width viewports. */
export function viewportStrip(count: number, gap = 0.02): ViewportRect[] {
  return viewportGrid(count, 1, gap);
}

// ── Model position helpers ─────────────────────────────────────────

/**
 * Place models in a horizontal row centered at origin.
 * `spacing` = distance between model centers (world units).
 */
export function linearPositions(
  models: ModelConfig[],
  spacing: number,
): ModelPlacement[] {
  const totalWidth = (models.length - 1) * spacing;
  return models.map((m, i) => ({
    path: m.path,
    position: [-totalWidth / 2 + i * spacing, 0, 0] as [number, number, number],
    color: m.color,
    wireframe: m.wireframe,
  }));
}

/**
 * Place models on a ring (circle) centered at origin.
 * Useful for surround views.
 */
export function ringPositions(
  models: ModelConfig[],
  radius: number,
): ModelPlacement[] {
  return models.map((m, i) => {
    const angle = (2 * Math.PI * i) / models.length;
    return {
      path: m.path,
      position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [number, number, number],
      color: m.color,
      wireframe: m.wireframe,
    };
  });
}

// ── Preset handler type ────────────────────────────────────────────

export interface PresetHandler {
  name: string;
  description: string;
  minModels: number;
  maxModels: number;
  /** Return null if model count is out of range. */
  compute(models: ModelConfig[], params: Record<string, number | string | boolean>): PresetResult | null;
}
