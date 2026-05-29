import type { PluginSettings, CameraConfig, LightConfig, SceneConfig } from "./models";
import { listSupportedModelExtensions } from "../io/formats/registry";

export const SUPPORTED_MODEL_EXTENSIONS = new Set(listSupportedModelExtensions());

export const MAX_TAGS_PER_FIELD = 12;

export const DEFAULT_SETTINGS: PluginSettings = {
  analysisMode: "local",
  serviceBaseUrl: "",
  copySourceModelToVault: false,
  sourceModelFolder: "Assets/3D",
  reportFolder: "Analysis/3D Reports",
  partFolder: "Parts/3D Components",
  previewFolder: "Media/3D Previews",
  maxFileSizeMb: 50,
  autoGenerateKnowledgeNotes: true,
  annotationPreviewMode: "plain-text",
  previewRendererRollout: "three-direct-glb",
  useThreeRenderer: true,
  experimentalThreeWorkbench: false,
  sendRawModelToRemote: false,
  sendPreviewImagesToRemote: false,
  sendGeometrySummaryToRemote: false,
  defaultKnowledgeTaxonomy: "default-v1",
  // Performance & display
  defaultCanvasHeight: 400,
  autoRotateDefault: false,
  autoRotateSpeed: 0.5,
  renderQuality: "high",
  renderScale: 1.0,
  // Snapshot export
  snapshotFolder: "Media/3D Previews",
  snapshotNaming: "model-name",
  // Conversion channel
  enabledConverterIds: [],
  freecadCommand: "",
  obj2gltfCommand: "",
  fbx2gltfCommand: "",
  assimpCommand: "",
  freecadcmdCommand: "",
  preferObj2gltfForObj: false,
  preferFbx2gltfForFbx: false,
  // Logging
  logLevel: "warn",
  // i18n
  locale: "en",
};

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  mode: "perspective",
  fov: 45,
};

export const DEFAULT_LIGHTS: LightConfig[] = [
  { type: "hemisphere", color: "#ffffff", intensity: 1, groundColor: "#444444" },
];

export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  background: "#1e1e22",
  transparent: false,
  autoRotate: false,
  autoRotateSpeed: 0.5,
  groundShadow: false,
  grid: false,
  axis: false,
};
