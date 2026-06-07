import type {
  ModelPartSummary,
  ModelEvidence,
  ModelPreviewSummary,
  PreviewRendererRollout,
  ThreeDBlockConfig,
} from "../../domain/models";

export interface PreviewWorldPoint {
  x: number;
  y: number;
  z: number;
}

export type PreviewAxis = "x" | "y" | "z";

export interface PreviewPickResult {
  mesh: object | null;
  pickedPoint: object | null;
  screenX: number;
  screenY: number;
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
  getPerformanceSnapshot?(): ModelPreviewPerformanceSnapshot;
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

export interface MeasurementPreview {
  toggleMeasurement(): boolean;
  isMeasurementActive(): boolean;
  clearMeasurements(): void;
  setMeasurementScale(scale: MeasurementScale): void;
  getMeasurementScale(): MeasurementScale;
  getMeasurementBounds(): { x: number; y: number; z: number } | null;
  updateMeasurementLabels(): void;
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
  return !!value && typeof value === "object" && name in value;
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
    && hasMethod(preview, "clearMeasurements")
    && hasMethod(preview, "setMeasurementScale")
    && hasMethod(preview, "getMeasurementScale")
    && hasMethod(preview, "getMeasurementBounds")
    && hasMethod(preview, "updateMeasurementLabels");
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

export function supportsWorkbenchPreview(preview: unknown): preview is WorkbenchPreview {
  return hasMethod(preview, "setExplode") && hasMethod(preview, "resetExplode") && hasMethod(preview, "focusWorldPoint");
}
