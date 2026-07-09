import type {
  ModelPartSummary,
  ModelEvidence,
  ModelPreviewSummary,
  PreviewRendererRollout,
  ThreeDBlockConfig,
} from "../../domain/models";
import type { PreviewLoadOptions } from "./load-control";

export interface PreviewWorldPoint {
  x: number;
  y: number;
  z: number;
}

export type PreviewAxis = "x" | "y" | "z";

export interface PreviewPickModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface PreviewPickResult {
  mesh: object | null;
  pickedPoint: object | null;
  screenX: number;
  screenY: number;
  modifiers?: PreviewPickModifiers;
}

export interface PreviewProjectionResult {
  screenX: number;
  screenY: number;
  depth: number;
}

export interface AnnotationViewportProvider {
  readonly canvas: HTMLCanvasElement;
  observeRender(callback: () => void): { remove: () => void };
  getCameraStateKey(): string;
  projectWorldPoint(point: PreviewWorldPoint, result: PreviewProjectionResult): boolean;
  isWorldPointOccluded(point: PreviewWorldPoint): boolean;
}

export interface ModelPreview {
  loadModel(
    data: ArrayBuffer,
    ext: string,
    readFile?: (path: string) => Promise<ArrayBuffer>,
    modelPath?: string,
    options?: PreviewLoadOptions,
  ): Promise<ModelPreviewSummary>;
  applyConfig(config: ThreeDBlockConfig): void;
  destroy(): void;
  getCanvas(): HTMLCanvasElement | null;
  captureSnapshot(): string | null;
  getModelEvidence?(): ModelEvidence | null;
  exportModelInfo(modelPath?: string): string;
  getSelectedPartInfo(): ModelPartSummary | null;
  exportSelectedPartInfo(): string;
  onPick(callback: (result: PreviewPickResult) => void): () => void;
  getPickWorldPoint(result: PreviewPickResult): PreviewWorldPoint | null;
  resetView(): void;
  toggleFocusSelection(): boolean;
  toggleWireframe?(): boolean;
  toggleOrientationGizmo?(): boolean;
  toggleBoundingBox?(): boolean;
  hasAnimations?(): boolean;
  toggleAnimation?(): boolean;
  setSTLColor?(hex: string): void;
  setWireframe?(enabled: boolean): void;
  setRenderQuality?(quality: "low" | "medium" | "high", renderScale?: number): void;
  setRenderScale?(scale: number): number;
  getCameraZoomState?(): CameraZoomState | null;
  setCameraZoom?(value: number): CameraZoomState | null;
  observeCameraZoom?(callback: (state: CameraZoomState | null) => void): () => void;
  getPerformanceSnapshot?(): ModelPreviewPerformanceSnapshot;
  getQualitySnapshot?(): PreviewQualitySnapshot;
}

export type PreviewCapabilityId =
  | "annotation"
  | "animation"
  | "measurement"
  | "disassembly"
  | "focus-selection"
  | "wireframe"
  | "orientation-gizmo"
  | "bounding-box"
  | "slice"
  | "render-scale"
  | "camera-zoom"
  | "workbench";

export interface PreviewCapabilityProfile {
  backend: "three" | "babylon";
  supportedFormats: readonly string[];
  fallbackRole: string;
  capabilities: readonly PreviewCapabilityId[];
  colorPipeline: string;
  fidelityNotes: readonly string[];
}

export interface PreviewQualitySnapshot {
  backend: "three" | "babylon";
  supportedFormats: readonly string[];
  colorPipeline: {
    outputColorSpace: string;
    toneMapping: string;
    textureCount: number;
    colorTextureCount: number;
    srgbColorTextureCount: number;
  };
  geometry: {
    meshCount: number;
    pointCloudCount: number;
    smallPartCount: number;
    smallestPartSpan: number | null;
    modelSpan: number | null;
  };
  camera: {
    near: number;
    far: number;
    nearFarRatio: number;
  };
  performance: {
    renderScale: number;
    pixelRatio?: number;
    frameBudgetPixelRatioScale?: number;
    frameBudgetObserverStride?: number;
    viewportVisible?: boolean;
    renderedFrameCount?: number;
    idleFrameSkipCount?: number;
    slowFrameCount?: number;
    averageRenderMs?: number;
    p95RenderMs?: number;
    maxRenderMs?: number;
    adaptiveScaleChangeCount?: number;
  };
}

export interface ModelPreviewPerformanceSnapshot {
  backend: "three" | "babylon";
  renderScale: number;
  quality: "low" | "medium" | "high";
  pixelRatio?: number;
  interactivePixelRatioActive?: boolean;
  frameBudgetPixelRatioScale?: number;
  frameBudgetObserverStride?: number;
  frameBudgetShadowDeferred?: boolean;
  lastFrameDurationMs?: number;
  averageRenderMs?: number;
  p95RenderMs?: number;
  maxRenderMs?: number;
  renderedFrameCount?: number;
  slowFrameCount?: number;
  idleFrameSkipCount?: number;
  adaptiveScaleChangeCount?: number;
  viewportVisible?: boolean;
  disposalAudit?: {
    reason: "initial" | "model-switch" | "destroy";
    meshCount: number;
    geometryCount: number;
    materialCount: number;
    textureCount: number;
    objectCount: number;
    timestamp: number;
  };
  renderDirty?: boolean;
  renderObserverCount?: number;
  renderObserverSettleFrames?: number;
  meshCount?: number;
  qualitySnapshot?: PreviewQualitySnapshot;
}

export interface AnnotationPreview extends ModelPreview {
  getAnnotationProvider(): AnnotationViewportProvider;
}

export interface AnimationPreview {
  hasAnimations(): boolean;
  toggleAnimation(): boolean;
}

export interface MeasurementScale {
  x: number;
  y: number;
  z: number;
}

export type MeasurementUnit = "um" | "mm" | "cm" | "m";

export interface MeasurementReading {
  distance: number;
  delta: PreviewWorldPoint;
  absDelta: PreviewWorldPoint;
  unit: MeasurementUnit;
}

export interface MeasurementRecord {
  index: number;
  start: PreviewWorldPoint;
  end: PreviewWorldPoint;
  reading: MeasurementReading;
}

export type MeasurementPhase = "inactive" | "select-target" | "ready" | "picking-end" | "reviewing";
export type MeasurementSnapKind = "vertex" | "edge" | "free";

export interface MeasurementState {
  active: boolean;
  phase: MeasurementPhase;
  records: MeasurementRecord[];
  unit: MeasurementUnit;
  scale: MeasurementScale;
  bounds: PreviewWorldPoint | null;
  targetLocked?: boolean;
  targetName?: string | null;
  snapKind?: MeasurementSnapKind | null;
}

export interface MeasurementPreview {
  toggleMeasurement(): boolean;
  isMeasurementActive(): boolean;
  cancelMeasurement(): void;
  clearMeasurements(): void;
  setMeasurementScale(scale: MeasurementScale): void;
  getMeasurementScale(): MeasurementScale;
  setMeasurementUnit(unit: MeasurementUnit): void;
  getMeasurementUnit(): MeasurementUnit;
  getMeasurementBounds(): { x: number; y: number; z: number } | null;
  getMeasurementRecords(): MeasurementRecord[];
  getMeasurementState(): MeasurementState;
  updateMeasurementLabels(): void;
  exportMeasurements(): string;
  observeMeasurements?(callback: () => void): () => void;
}

export interface SliceState {
  active: boolean;
  normal: PreviewWorldPoint;
  offset: number;
  point: PreviewWorldPoint | null;
  dragging?: boolean;
  axis: PreviewAxis;
  position: number;
  thickness: number;
  bounds: PreviewWorldPoint | null;
}

export interface SlicePreview {
  toggleSlice(): boolean;
  isSliceActive(): boolean;
  setSlicePlane(normal: PreviewWorldPoint, offset?: number): SliceState;
  setSliceOffset(offset: number): SliceState;
  resetSlicePlane(): SliceState;
  getSliceState(): SliceState;
  observeSlice?(callback: () => void): () => void;
}

export interface DisassemblyPreview {
  toggleDisassembly(): boolean;
  resetDisassembly(): void;
  isDisassemblyEnabled(): boolean;
}

export interface ExplodePreview {
  setExplode(factor: number, axis: PreviewAxis): void;
  resetExplode(): void;
}

export interface FocusPointPreview {
  focusWorldPoint(point: PreviewWorldPoint): void;
}

export interface FocusSelectionPreview {
  toggleFocusSelection(): boolean;
  isFocusSelectionEnabled(): boolean;
}

export interface WireframePreview {
  toggleWireframe(): boolean;
}

export interface OrientationGizmoPreview {
  toggleOrientationGizmo(): boolean;
  isOrientationGizmoEnabled?(): boolean;
}

export interface BoundingBoxPreview {
  toggleBoundingBox(): boolean;
}

export interface RenderScalePreview {
  setRenderScale(scale: number): number;
  getRenderScale?(): number;
}

export interface CameraZoomState {
  value: number;
  percentage: number;
}

export interface CameraZoomPreview {
  getCameraZoomState(): CameraZoomState | null;
  setCameraZoom(value: number): CameraZoomState | null;
  observeCameraZoom?(callback: (state: CameraZoomState | null) => void): () => void;
}

export interface RenderQualityPreview {
  setRenderQuality(quality: "low" | "medium" | "high", renderScale?: number): void;
}

export type WorkbenchPreview =
  & AnnotationPreview
  & ExplodePreview
  & FocusPointPreview
  & AnimationPreview
  & RenderQualityPreview;

export type PreviewAnnotationMode = "none" | "readonly" | "edit";

export interface PreviewFactoryOptions {
  ext: string;
  annotationMode?: PreviewAnnotationMode;
  allowEditModeOnThree?: boolean;
  allowWorkbenchFeaturesOnThree?: boolean;
  requireWorkbenchFeatures?: boolean;
  rendererRollout?: PreviewRendererRollout;
  useThreeRenderer?: boolean;
}

function hasMethod(value: unknown, name: string): boolean {
  return !!value
    && typeof value === "object"
    && typeof (value as Record<string, unknown>)[name] === "function";
}

export function supportsAnnotationPreview(preview: unknown): preview is AnnotationPreview {
  return hasMethod(preview, "getAnnotationProvider");
}

export function supportsAnimationPreview(preview: unknown): preview is AnimationPreview {
  return hasMethod(preview, "hasAnimations") && hasMethod(preview, "toggleAnimation");
}

export function supportsMeasurementPreview(preview: unknown): preview is MeasurementPreview {
  return hasMethod(preview, "toggleMeasurement")
    && hasMethod(preview, "isMeasurementActive")
    && hasMethod(preview, "cancelMeasurement")
    && hasMethod(preview, "clearMeasurements")
    && hasMethod(preview, "setMeasurementScale")
    && hasMethod(preview, "getMeasurementScale")
    && hasMethod(preview, "setMeasurementUnit")
    && hasMethod(preview, "getMeasurementUnit")
    && hasMethod(preview, "getMeasurementBounds")
    && hasMethod(preview, "getMeasurementRecords")
    && hasMethod(preview, "getMeasurementState")
    && hasMethod(preview, "updateMeasurementLabels")
    && hasMethod(preview, "exportMeasurements");
}

export function supportsSlicePreview(preview: unknown): preview is SlicePreview {
  return hasMethod(preview, "toggleSlice")
    && hasMethod(preview, "isSliceActive")
    && hasMethod(preview, "setSlicePlane")
    && hasMethod(preview, "setSliceOffset")
    && hasMethod(preview, "resetSlicePlane")
    && hasMethod(preview, "getSliceState");
}

export function supportsDisassemblyPreview(preview: unknown): preview is DisassemblyPreview {
  return hasMethod(preview, "toggleDisassembly")
    && hasMethod(preview, "resetDisassembly")
    && hasMethod(preview, "isDisassemblyEnabled");
}

export function supportsFocusSelectionPreview(preview: unknown): preview is FocusSelectionPreview {
  return hasMethod(preview, "toggleFocusSelection") && hasMethod(preview, "isFocusSelectionEnabled");
}

export function supportsWireframePreview(preview: unknown): preview is WireframePreview {
  return hasMethod(preview, "toggleWireframe");
}

export function supportsOrientationGizmoPreview(preview: unknown): preview is OrientationGizmoPreview {
  return hasMethod(preview, "toggleOrientationGizmo");
}

export function supportsBoundingBoxPreview(preview: unknown): preview is BoundingBoxPreview {
  return hasMethod(preview, "toggleBoundingBox");
}

export function supportsRenderScalePreview(preview: unknown): preview is RenderScalePreview {
  return hasMethod(preview, "setRenderScale");
}

export function supportsCameraZoomPreview(preview: unknown): preview is CameraZoomPreview {
  return hasMethod(preview, "getCameraZoomState") && hasMethod(preview, "setCameraZoom");
}

export function supportsWorkbenchPreview(preview: unknown): preview is WorkbenchPreview {
  return hasMethod(preview, "setExplode") && hasMethod(preview, "resetExplode") && hasMethod(preview, "focusWorldPoint");
}
