/**
 * All shared interfaces for AI Model Workbench.
 * Source of truth for data structures — no runtime code.
 */

// ── Plugin Settings ──────────────────────────────────────────────

export type PreviewRendererRollout = "babylon-safe" | "three-readonly-glb" | "three-direct-glb";

export interface PluginSettings {
  analysisMode: "local" | "remote" | "hybrid";
  serviceBaseUrl: string;
  copySourceModelToVault: boolean;
  sourceModelFolder: string;
  reportFolder: string;
  partFolder: string;
  previewFolder: string;
  maxFileSizeMb: number;
  autoGenerateKnowledgeNotes: boolean;
  annotationPreviewMode: "plain-text" | "markdown";
  previewRendererRollout: PreviewRendererRollout;
  /** Simple toggle: true = Three.js, false = Babylon.js (compatibility). */
  useThreeRenderer: boolean;
  /**
   * Experimental workbench route: allow Three.js for direct GLB/GLTF workbench
   * surfaces with automatic Babylon fallback.
   */
  experimentalThreeWorkbench: boolean;
  sendRawModelToRemote: boolean;
  sendPreviewImagesToRemote: boolean;
  sendGeometrySummaryToRemote: boolean;
  defaultKnowledgeTaxonomy: string;
  // Performance & display
  defaultCanvasHeight: number;
  autoRotateDefault: boolean;
  autoRotateSpeed: number;
  renderQuality: "low" | "medium" | "high";
  /** Render resolution multiplier: 0.25 (quarter) to 2.0 (double). 1.0 = native. */
  renderScale: number;
  // Snapshot export
  snapshotFolder: string;
  snapshotNaming: "timestamp" | "model-name";
  // Conversion channel
  enabledConverterIds: string[];
  freecadCommand: string;
  obj2gltfCommand: string;
  fbx2gltfCommand: string;
  assimpCommand: string;
  freecadcmdCommand: string;
  preferObj2gltfForObj: boolean;
  preferFbx2gltfForFbx: boolean;
  // Logging
  logLevel: "debug" | "info" | "warn" | "error";
  // i18n
  locale: "en" | "zh-CN";
}

export interface ConvertedAssetRecord {
  cacheVersion: number;
  converterId: string;
  converterCacheKey: string;
  sourcePath: string;
  sourceExt: string;
  targetExt: "glb";
  outputPath: string;
  outputExt: "glb";
  warnings: string[];
  createdAt: number;
}

// ── Persisted Plugin State ───────────────────────────────────────

export interface PersistedPluginState {
  settings: PluginSettings;
  convertedAssetRecords: ConvertedAssetRecord[];
  modelAssetProfiles: Record<string, ModelAssetProfile>;
  agentDraft: string;
  agentPlan: AgentTaskPlan | null;
}

// ── Store State (extends persisted with transient fields) ────────

export interface PluginState {
  settings: PluginSettings;
  currentModelPath: string | null;
  convertedAssetRecords: ConvertedAssetRecord[];
  modelAssetProfiles: Record<string, ModelAssetProfile>;
  agentDraft: string;
  agentPlan: AgentTaskPlan | null;
  modelPreview: ModelPreviewSummary | null;
  selectedPart: ModelPartSummary | null;
}

// ── Per-Model Asset Profile ──────────────────────────────────────

export interface AnnotationPin {
  id: string;
  position: [number, number, number];
  normal?: [number, number, number];
  label: string;
  color: string;
  createdAt: string;
  notePath?: string;     // bound note vault path
  headingRef?: string;   // heading text (e.g. "外壳组件")
  headingLevel?: number; // heading level 1-6
}

export interface ModelAssetProfile {
  tags: string[];
  notes: string;
  annotations: AnnotationPin[];
  analysisVersion?: string;
  reportNotePath?: string;
  analysisSidecarPath?: string;
  knowledgeIndexPath?: string;
  previewImagePaths?: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Model Preview Summary ────────────────────────────────────────

export interface ModelPreviewSummary {
  meshCount: number;
  triangleCount: number;
  splatCount?: number;
  vertexCount: number;
  materialCount: number;
  performanceTier?: "light" | "medium" | "heavy" | "extreme";
  performanceHint?: string;
  resourceWarnings?: string[];
  boundingSize: { x: number; y: number; z: number };
  rootName: string;
}

export interface ModelPartSummary {
  name: string;
  triangleCount: number;
  vertexCount: number;
  materialName: string | null;
  boundingSize: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
}

export interface ModelEvidence {
  summary: ModelPreviewSummary;
  parts: ModelPartSummary[];
  materialNames: string[];
  resourceWarnings: string[];
  capturedAt: string;
}

// ── Asset Record ─────────────────────────────────────────────────

export interface AssetRecord {
  assetId: string;
  title: string;
  sourcePath: string;
  vaultPath?: string;
  format: "glb" | "gltf" | "stl" | "obj" | "splat" | "ply";
  importedAt: string;
  updatedAt: string;
  status: "idle" | "processing" | "ready" | "error";
  vertexCount?: number;
  triangleCount?: number;
  materialCount?: number;
  boundingBox?: [number, number, number];
  analysisVersion?: string;
  reportNotePath?: string;
  sidecarPath?: string;
}

// ── Part Record ──────────────────────────────────────────────────

export interface PartRecord {
  partId: string;
  assetId: string;
  parentPartId?: string;
  name: string;
  category?: string;
  meshRefs: string[];
  materialRefs: string[];
  bbox?: [number, number, number];
  center?: [number, number, number];
  triangleCount?: number;
  vertexCount?: number;
  materialName?: string | null;
  confidence: number;
  observations: string[];
  inferredFunctions: string[];
  knowledgeTags: string[];
  notePath?: string;
  reviewed: boolean;
}

// ── Knowledge Node ───────────────────────────────────────────────

export type KnowledgeDomain =
  | "geometry"
  | "topology"
  | "material"
  | "rigging"
  | "rendering"
  | "manufacturing"
  | "assembly";

export interface KnowledgeNode {
  id: string;
  title: string;
  domain: KnowledgeDomain;
  summary: string;
  relatedPartIds: string[];
  relatedAssetIds: string[];
  confidence: number;
  source: "rule" | "ai" | "user";
}

export interface AnnotationPartLink {
  annotationId: string;
  label: string;
  position: [number, number, number];
  notePath?: string;
  headingRef?: string;
  nearestPartId?: string;
  nearestPartName?: string;
  distance?: number;
  confidence: number;
}

export interface AnalysisDraftingInput {
  task: string;
  model: {
    path: string;
    title: string;
    format: AssetRecord["format"];
    summary?: ModelPreviewSummary;
    tags: string[];
    notes: string;
  };
  evidence: {
    rawModelIncluded: boolean;
    previewImages: string[];
    warnings: string[];
    generatedAt: string;
  };
  partCandidates: Array<{
    partId: string;
    name: string;
    notePath?: string;
    category?: string;
    triangleCount?: number;
    materialName?: string | null;
    observations: string[];
  }>;
  annotationLinks: AnnotationPartLink[];
  knowledgeNodes: KnowledgeNode[];
}

export interface RemoteDraftResult {
  title?: string;
  summary: string;
  sections?: Array<{
    heading: string;
    body: string;
  }>;
  suggestedTags?: string[];
  warnings?: string[];
  model?: string;
}

export interface LocalDraftResult {
  title: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
  suggestedTags: string[];
  nextActions: string[];
  generatedAt: string;
}

// ── Analysis Result ──────────────────────────────────────────────

export interface AnalysisPipelineStage {
  stage: "normalize" | "stats" | "render" | "split" | "reason" | "map" | "draft" | "partNotes" | "index" | "remoteDraft";
  durationMs: number;
  status: "success" | "failed" | "skipped";
}

export interface AnalysisResult {
  asset: AssetRecord;
  parts: PartRecord[];
  knowledgeNodes: KnowledgeNode[];
  previewImages: string[];
  partNotePaths?: string[];
  knowledgeIndexPath?: string;
  annotationLinks?: AnnotationPartLink[];
  draftingInput?: AnalysisDraftingInput;
  localDraft?: LocalDraftResult;
  remoteDraft?: RemoteDraftResult;
  evidence?: ModelEvidence;
  warnings: string[];
  pipeline: AnalysisPipelineStage[];
}

// ── 3D Code Block Config ───────────────────────────────────────

export type LightType =
  | "directional"
  | "ambient"
  | "point"
  | "spot"
  | "hemisphere"
  | "attachToCam";

export interface ModelConfig {
  path: string;
  color?: string;
  wireframe?: boolean;
}

export interface CameraConfig {
  position?: [number, number, number];
  lookAt?: [number, number, number];
  fov?: number;
  mode?: "perspective" | "orthographic";
  zoom?: number;
  near?: number;
  far?: number;
}

export interface LightConfig {
  type: LightType;
  color?: string;
  intensity?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  castShadow?: boolean;
  angle?: number;
  penumbra?: number;
  decay?: number;
  groundColor?: string;
}

export interface SceneConfig {
  background?: string;
  transparent?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  groundShadow?: boolean;
  grid?: boolean;
  axis?: boolean;
}

export interface STLConfig {
  color?: string;
  wireframe?: boolean;
}

export interface ThreeDBlockConfig {
  models: ModelConfig[];
  camera?: CameraConfig;
  lights?: LightConfig[];
  scene?: SceneConfig;
  stl?: STLConfig;
  width?: number | string;
  height?: number | string;
}

export interface GridBlockConfig {
  models: ModelConfig[];
  /** Preset template name: "compare" | "showcase" | "explode" | "timeline" | "compose" */
  preset?: string;
  /** Preset-specific parameters (spacing, camera distance, etc.) */
  params?: Record<string, number | string | boolean>;
  /** Sections for the "compose" preset. */
  sections?: ComposeSection[];
  /** Compose layout direction: "horizontal" (default) or "vertical". */
  direction?: "horizontal" | "vertical";
  columns?: number;
  rowHeight?: number | "auto";
  gapX?: number;
  gapY?: number;
  camera?: CameraConfig;
  lights?: LightConfig[];
  scene?: SceneConfig;
}

/** One model's placement in world space. */
export interface ModelPlacement {
  path: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  color?: string;
  wireframe?: boolean;
}

/** Camera definition for one viewport cell. */
export interface PresetCameraDef {
  alpha: number;
  beta: number;
  radiusMultiplier?: number;
  target?: [number, number, number];
  fov?: number;
  ortho?: boolean;
}

/** Viewport rectangle in normalized 0-1 coordinates. */
export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cell layout: which model index + which camera config + viewport. */
export interface CellLayout {
  modelIndex: number;
  camera: PresetCameraDef;
  viewport: ViewportRect;
}

/** Result of a preset calculation. */
export interface PresetResult {
  placements: ModelPlacement[];
  cells: CellLayout[];
  /** If set, all cell viewports are remapped into this rectangle. */
  bounds?: ViewportRect;
}

/** Section definition for the "compose" preset. */
export interface ComposeSection {
  preset: string;
  models: (string | ModelConfig)[];
  params?: Record<string, number | string | boolean>;
  /** Relative weight for horizontal/vertical space分配 (default: 1). */
  weight?: number;
}

// ── Agent Task Plan ──────────────────────────────────────────────

export interface AgentTaskPlan {
  targetApp: string;
  taskType: string;
  userIntent: string;
  constraints: string[];
  deliverable: string;
  primaryBackend: string;
  fallbackBackend: string;
  status: "draft" | "confirmed" | "running" | "completed" | "failed";
  steps: AgentTaskStep[];
  logs: string[];
  artifacts: string[];
}

export interface AgentTaskStep {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  durationMs?: number;
  output?: string;
}
