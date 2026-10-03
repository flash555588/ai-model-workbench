import type { PreviewRouteDecision } from "./routing";
import { listThreeDirectFormats } from "../../io/formats/renderer-support";
import {
  supportsAnnotationPreview,
  supportsAnimationPreview,
  supportsBoundingBoxPreview,
  supportsDisassemblyPreview,
  supportsFocusSelectionPreview,
  supportsCameraZoomPreview,
  supportsMeasurementPreview,
  supportsOrientationGizmoPreview,
  supportsRenderScalePreview,
  supportsSlicePreview,
  supportsWireframePreview,
  supportsWorkbenchPreview,
  type PreviewCapabilityId,
  type PreviewCapabilityProfile,
} from "./types";

// SPLAT/SPZ/SOG are disabled in packaged builds (see io/formats/registry.ts),
// so they are not listed as a supported capability format.
const BABYLON_CAPABILITY_FORMATS = ["glb", "gltf", "stl", "ply", "obj", "converted-glb"] as const;

export function collectPreviewCapabilities(preview: unknown): PreviewCapabilityId[] {
  const capabilities: PreviewCapabilityId[] = [];
  if (supportsAnnotationPreview(preview)) capabilities.push("annotation");
  if (supportsAnimationPreview(preview)) capabilities.push("animation");
  if (supportsMeasurementPreview(preview)) capabilities.push("measurement");
  if (supportsDisassemblyPreview(preview)) capabilities.push("disassembly");
  if (supportsFocusSelectionPreview(preview)) capabilities.push("focus-selection");
  if (supportsWireframePreview(preview)) capabilities.push("wireframe");
  if (supportsOrientationGizmoPreview(preview)) capabilities.push("orientation-gizmo");
  if (supportsBoundingBoxPreview(preview)) capabilities.push("bounding-box");
  if (supportsSlicePreview(preview)) capabilities.push("slice");
  if (supportsRenderScalePreview(preview)) capabilities.push("render-scale");
  if (supportsCameraZoomPreview(preview)) capabilities.push("camera-zoom");
  if (supportsWorkbenchPreview(preview)) capabilities.push("workbench");
  return capabilities;
}

export function createPreviewCapabilityProfile(
  backend: "three" | "babylon",
  capabilities: readonly PreviewCapabilityId[],
): PreviewCapabilityProfile {
  if (backend === "three") {
    return {
      backend,
      supportedFormats: listThreeDirectFormats(),
      fallbackRole: "Opt-in single-model preview and converted GLB fast path",
      capabilities: [...capabilities],
      colorPipeline: "sRGB output, no tone mapping, PBR material preservation",
      fidelityNotes: [
        "Direct GLB/GLTF/STL/PLY/OBJ are expected to preserve geometry scale and material color intent.",
        "Babylon fallback covers GLB/GLTF/STL/PLY/OBJ; Three-only formats retain their original load errors.",
      ],
    };
  }

  return {
    backend,
    supportedFormats: BABYLON_CAPABILITY_FORMATS,
    fallbackRole: "Capability and compatibility backend",
    capabilities: [...capabilities],
    colorPipeline: "sRGB output, no tone mapping, PBR material preservation with local IBL",
    fidelityNotes: [
      "3dgrid, conservative workbench, and converted workbench inputs remain on Babylon.",
      "Babylon remains the rollback path when Three direct rendering is disabled.",
    ],
  };
}

export function collectPreviewCapabilityProfile(
  preview: unknown,
  backend: "three" | "babylon",
): PreviewCapabilityProfile {
  return createPreviewCapabilityProfile(backend, collectPreviewCapabilities(preview));
}

export function describePreviewRouteCapabilities(route: PreviewRouteDecision): PreviewCapabilityProfile {
  if (route.backend === "three") {
    const capabilities: PreviewCapabilityId[] = [
      "annotation",
      "animation",
      "measurement",
      "disassembly",
      "focus-selection",
      "wireframe",
      "orientation-gizmo",
      "bounding-box",
      "slice",
      "render-scale",
      "camera-zoom",
      "workbench",
    ];
    return createPreviewCapabilityProfile("three", capabilities);
  }

  return createPreviewCapabilityProfile("babylon", [
    "annotation",
    "animation",
    "measurement",
    "disassembly",
    "focus-selection",
    "wireframe",
    "orientation-gizmo",
    "bounding-box",
    "slice",
    "render-scale",
    "camera-zoom",
    "workbench",
  ]);
}

export function formatPreviewCapabilityProfile(profile: PreviewCapabilityProfile): string {
  return [
    `${profile.backend}`,
    `formats=${profile.supportedFormats.join("/")}`,
    `capabilities=${profile.capabilities.join("/") || "none"}`,
    `role=${profile.fallbackRole}`,
  ].join("; ");
}
