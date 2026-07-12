export type PreviewInteractionMode =
  | "idle"
  | "annotation"
  | "focus"
  | "disassembly"
  | "measurement"
  | "slice";

export interface PreviewInteractionFlags {
  annotation: boolean;
  focus: boolean;
  disassembly: boolean;
  measurement: boolean;
  slice: boolean;
}

export interface PreviewInteractionRule {
  exclusive: boolean;
  allowsCameraOrbit: boolean;
  allowsObjectPicking: boolean;
  preservesViewOverlays: boolean;
}

export const PREVIEW_INTERACTION_RULES: Record<PreviewInteractionMode, PreviewInteractionRule> = {
  idle: {
    exclusive: false,
    allowsCameraOrbit: true,
    allowsObjectPicking: true,
    preservesViewOverlays: true,
  },
  annotation: {
    exclusive: true,
    allowsCameraOrbit: true,
    allowsObjectPicking: true,
    preservesViewOverlays: true,
  },
  focus: {
    exclusive: true,
    allowsCameraOrbit: true,
    allowsObjectPicking: true,
    preservesViewOverlays: true,
  },
  disassembly: {
    exclusive: true,
    allowsCameraOrbit: true,
    allowsObjectPicking: false,
    preservesViewOverlays: true,
  },
  measurement: {
    exclusive: true,
    allowsCameraOrbit: true,
    allowsObjectPicking: false,
    preservesViewOverlays: true,
  },
  slice: {
    exclusive: true,
    allowsCameraOrbit: true,
    allowsObjectPicking: false,
    preservesViewOverlays: true,
  },
};

const INTERACTION_PRIORITY: readonly Exclude<PreviewInteractionMode, "idle">[] = [
  "annotation",
  "slice",
  "measurement",
  "disassembly",
  "focus",
];

export function resolvePreviewInteractionMode(flags: PreviewInteractionFlags): PreviewInteractionMode {
  for (const mode of INTERACTION_PRIORITY) {
    if (flags[mode]) return mode;
  }
  return "idle";
}

export function isPreviewInteractionModeActive(mode: PreviewInteractionMode): boolean {
  return mode !== "idle";
}
