import type { PresetHandler } from "./base";
import { ComparePreset } from "./compare";
import { ShowcasePreset } from "./showcase";
import { ExplodePreset } from "./explode";
import { TimelinePreset } from "./timeline";
import { ComposePreset } from "./compose";
import { GalleryPreset } from "./gallery";

export type { PresetHandler } from "./base";
export { cam, CAMERA_PRESETS, viewportGrid, viewportStrip, linearPositions, ringPositions } from "./base";
export type { CameraPresetName } from "./base";
export { composeSections } from "./compose";

const REGISTRY = new Map<string, PresetHandler>();

function register(handler: PresetHandler): void {
  REGISTRY.set(handler.name, handler);
}

register(ComparePreset);
register(ShowcasePreset);
register(ExplodePreset);
register(TimelinePreset);
register(ComposePreset);
register(GalleryPreset);

/** Look up a preset by name. Returns undefined if not found. */
export function getPreset(name: string): PresetHandler | undefined {
  return REGISTRY.get(name);
}

/** List all registered preset names and descriptions. */
export function listPresets(): { name: string; description: string }[] {
  return [...REGISTRY.values()].map((p) => ({ name: p.name, description: p.description }));
}
