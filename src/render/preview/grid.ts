import type { GridBlockConfig, ModelConfig, PresetResult } from "../../domain/models";

export interface PreviewGridRenderer {
  loadModels(
    models: ModelConfig[],
    config: GridBlockConfig,
    readFile: (path: string) => Promise<ArrayBuffer>,
  ): Promise<void>;
  loadWithPreset(
    result: PresetResult,
    readFile: (path: string) => Promise<ArrayBuffer>,
  ): Promise<void>;
  captureSnapshot(): string | null;
  setRenderScale(scale: number): number;
  resetView(): void;
  toggleWireframe(): boolean;
  exportModelInfo(): string;
  destroy(): void;
}

export async function createGridRenderer(canvas: HTMLCanvasElement): Promise<PreviewGridRenderer> {
  const { createBabylonGridRenderer } = await import("../babylon/grid");
  return createBabylonGridRenderer(canvas);
}
