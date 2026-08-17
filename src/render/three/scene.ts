import {
  AmbientLight,
  AnimationMixer,
  BoxHelper,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  GridHelper,
  HemisphereLight,
  Light,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  type Object3DEventMap,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane as ThreePlane,
  PlaneGeometry,
  PointLight,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SpotLight,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  AxesHelper,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  loadThree3MF,
  loadThreeDAE,
  loadThreeFBX,
  loadThreeGLTF,
  loadThreeOBJ,
  loadThreeOFF,
  loadThreePCD,
  loadThreePLY,
  loadThreeSTL,
  loadThreeXYZ,
} from "./loaders";
import type {
  CameraConfig,
  LightConfig,
  ModelEvidence,
  ModelPartSummary,
  ModelPreviewSummary,
  SceneConfig,
  STLConfig,
  ThreeDBlockConfig,
} from "../../domain/models";
import { isMobile } from "../../utils/device";
import { getDirectLoaderKind } from "../../io/formats/registry";
import { createStagedEl } from "../../utils/dom";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsRadius,
  getPreviewBoundsSize,
  type PreviewBounds,
} from "../preview/bounds";
import { createPreviewPerspectiveCameraFit } from "../preview/camera-fit";
import {
  computeOrthographicHalfExtents,
  DEFAULT_VIEWPORT_FIT_MARGIN,
  shouldRefitForAspect,
} from "../preview/viewport-fit";
import {
  createPreviewModelInfoMarkdown,
  createPreviewPartInfoMarkdown,
} from "../preview/report";
import type {
  PreviewAxis,
  WorkbenchPreview,
  AnnotationViewportProvider,
  PreviewPickResult,
  PreviewProjectionResult,
  PreviewWorldPoint,
  PreviewEulerDegrees,
  MeasurementScale,
  MeasurementSnapKind,
  MeasurementUnit,
  MeasurementState,
  CameraZoomState,
  PreviewQualitySnapshot,
  SliceInteractionMode,
  SliceState,
} from "../preview/types";
import {
  throwIfPreviewLoadInterrupted,
  type PreviewLoadOptions,
} from "../preview/load-control";
import {
  createAnnotationViewportProvider,
  formatAnnotationCameraStateKey,
  projectNormalizedDevicePointToCanvas,
} from "../preview/annotation-projection";
import {
  createPreviewLineOfSight,
  isPreviewHitOccluded,
  normalizePreviewWorldPoint,
  toPreviewWorldPoint,
} from "../preview/geometry";
import type { PreviewDisassemblyController } from "../preview/disassembly";
import { createPreviewEvidence } from "../preview/evidence";
import {
  MeasurementOverlayController,
  type MeasurementMarkerVisualState,
} from "../preview/measurement-overlay";
import { MeasurementSessionController } from "../preview/measurement-session";
import {
  buildMeasurementGeometrySnapInput,
  createMeasurementLabel,
  createMeasurementDraftingLayout,
  createMeasurementGeometryEdgesFromTriangles,
  createMeasurementMarkdown,
  createMeasurementReading as buildMeasurementReading,
  createMeasurementTrianglesFromIndices,
  drawMeasurementLabelCanvas,
  MEASUREMENT_LABEL_CANVAS,
  normalizeMeasurementUnit,
  sanitizeMeasurementScale,
  scaleMeasurementPointFromBase,
  setMeasurementCanvasActive,
  snapMeasurementPointToGeometry,
  unscaleMeasurementPointToBase,
  type MeasurementGeometrySnapInput,
  MeasurementGeometrySnapInputCache,
  type MeasurementSnapEdgeCandidate,
  type MeasurementSnapVertexCandidate,
  type MeasurementReading,
  type MeasurementRecord,
} from "../preview/measurement";
import {
  createSlicePlaneGeometry,
  createSliceGizmoGeometry,
  createSliceOffsetForPoint,
  createSliceRange,
  createSliceClipPlanes,
  createSlicePlaneAxesFromEulerDegrees,
  createSliceState,
  DEFAULT_SLICE_INTERACTION_MODE,
  DEFAULT_SLICE_NORMAL,
  DEFAULT_SLICE_OFFSET,
  DEFAULT_SLICE_THICKNESS,
  normalizeSliceInteractionMode,
  normalizeSliceAxis,
  normalizeSliceNormal,
  normalizeSliceOffset,
  normalizeSliceThickness,
  normalizeSliceRotationRadians,
  getSliceEulerDegreesFromPlaneAxes,
  resolveSliceRotationSnapMode,
  rotateSliceNormalAroundAxis,
  shouldUseSliceScreenRotation,
  snapSliceRotationRadiansForMode,
  type SliceRotationSnapMode,
  type SlicePlaneGeometry,
  type SliceRange,
} from "../preview/slice";
import { createThreeDisassemblyController } from "./disassembly";
import { resolveAxisVisibility } from "../preview/axis-visibility";
import { ENVIRONMENT_INTENSITY, FOCUS_ANIMATION_MS as CAMERA_ANIMATION_MS, FRAME_BUDGET_SLOW_MS } from "../preview/tuning";
import { ThreeFocusDimMaterialCache } from "./focus-materials";
import {
  createThreeWireframeMaterialValue,
  disposeThreeWireframeOverrides,
} from "./wireframe-materials";
import { setThreeExplode, resetThreeExplode } from "./explode";
import { getPortableBasename } from "../../utils/resolve-path";
import {
  getThreeTextureAnisotropyBudget,
  prepareThreeMaterialForColorAccuracy,
  type ThreeTextureAudit,
} from "./material-quality";
import { shouldContinueThreeRenderLoop, ThreeSmoothnessTracker } from "./smoothness";
import {
  createThreeGeometryQualityStats,
  createThreeGroupedPartCandidates,
  createThreeChildRenderableMeshMap,
  createThreeRenderableBoundsMap,
  createThreeModelPreviewSummary,
  createThreeObjectPartPreviewSummary,
  createThreeRenderableInfoBreakdown,
  createThreeRenderablePartPreviewSummary,
  findThreeSelectablePartObject,
  getThreeObjectDisplayName,
  getThreeMaterialList as materialList,
  getThreeRenderableMaterialNames,
  getThreeObjectPreviewBounds as getObjectPreviewBounds,
  isThreeRenderableObject,
  isThreeMesh as isMesh,
  type ThreeChildRenderableMeshMap,
  type ThreeRenderableBoundsMap,
  type ThreeRenderableObject,
} from "./mesh-preview";

const DEFAULT_BACKGROUND = new Color("#20242e");
const DEFAULT_CAMERA_FOV = 45;
const DEFAULT_SHADOW_OPACITY = 0.28;
const MAX_RENDER_PIXEL_RATIO = 2.5;
const DESKTOP_INTERACTIVE_PIXEL_RATIO_CAP = 1.5;
const MOBILE_INTERACTIVE_PIXEL_RATIO_CAP = 1.15;
const INTERACTIVE_PIXEL_RATIO_HOLD_MS = 260;
const RENDER_OBSERVER_SETTLE_FRAMES = 30;
const RENDER_OBSERVER_SETTLE_MIN_FRAMES = 8;
const FRAME_BUDGET_FAST_MS = 18;
const FRAME_BUDGET_SLOW_STREAK = 2;
const FRAME_BUDGET_FAST_STREAK = 28;
const FRAME_BUDGET_PIXEL_RATIO_STEP = 0.86;
const FRAME_BUDGET_PIXEL_RATIO_RECOVERY_STEP = 1.08;
const FRAME_BUDGET_MIN_PIXEL_RATIO_SCALE = 0.62;
const FRAME_BUDGET_SHADOW_SCALE = 0.86;
const FRAME_BUDGET_MAX_OBSERVER_STRIDE = 4;
const ENVIRONMENT_INSTALL_DELAY_MS = 120;
/** Upper bound on the delta handed to OrbitControls, in seconds (~4 frames at 60fps). */
const MAX_CONTROLS_DELTA_SECONDS = 1 / 15;
const MEASUREMENT_LINE_COLOR = 0xf8fafc;
const MEASUREMENT_MARKER_COLOR = 0xf8fafc;
const MEASUREMENT_PENDING_COLOR = 0xf59e0b;
const MEASUREMENT_HOVER_COLOR = 0xffffff;
const MEASUREMENT_PREVIEW_COLOR = 0xe5e7eb;
const SLICE_PLANE_COLOR = 0x38bdf8;
const SLICE_FRAME_COLOR = 0x93c5fd;
const SLICE_CENTER_FRAME_COLOR = 0xe0f2fe;
const SLICE_ROTATE_PLANE_COLOR = 0xf59e0b;
const SLICE_ROTATE_FRAME_COLOR = 0xfcd34d;
const SLICE_GIZMO_X_COLOR = 0xef4444;
const SLICE_GIZMO_Y_COLOR = 0x22c55e;
const SLICE_GIZMO_Z_COLOR = 0x3b82f6;
const SLICE_GIZMO_ACTIVE_COLOR = 0xf8fafc;
const SLICE_MOVE_COLOR = 0xfacc15;
const SLICE_PLANE_OPACITY = 0.32;
const SLICE_FRAME_OPACITY = 0.84;

type ThreeMeasurementSegment = { start: Vector3; end: Vector3; line: LineSegments; label: Sprite };
type ThreeSliceDragStateBase = {
  pointerId: number;
  startX: number;
  startY: number;
  mode: SliceInteractionMode;
  moved: boolean;
};
type ThreeSliceDragState = ThreeSliceDragStateBase & ({
  mode: "move";
  startOffset: number;
  screenAxis: Vector2;
  pixelsToOffset: number;
} | {
  mode: "rotate";
  axis: PreviewAxis;
  startNormal: PreviewWorldPoint;
  anchorPoint: PreviewWorldPoint;
  rotationAxis: PreviewWorldPoint;
  startPlaneX: PreviewWorldPoint;
  startPlaneY: PreviewWorldPoint;
  screenTangent: Vector2;
  radiansPerPixel: number;
  rotationRadians: number;
  startPointerAngle: number;
  currentPointerAngle: number;
  snapMode: SliceRotationSnapMode;
  useScreenRotation: boolean;
  labelPoint: PreviewWorldPoint;
});
type ThreeSlicePointerTarget = {
  mode: "move";
} | {
  mode: "rotate";
  axis: PreviewAxis;
  screenTangent: Vector2;
  radiansPerPixel: number;
  labelPoint: PreviewWorldPoint;
};

function distanceToScreenSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}
type ThreeMaterialClippingSnapshot = {
  material: Material;
  clippingPlanes: Material["clippingPlanes"];
  clipIntersection: Material["clipIntersection"];
  clipShadows: Material["clipShadows"];
};

type DisposalReason = "initial" | "model-switch" | "destroy";

interface ThreeDisposalAudit {
  reason: DisposalReason;
  meshCount: number;
  geometryCount: number;
  materialCount: number;
  textureCount: number;
  objectCount: number;
  timestamp: number;
}

function createEmptyTextureAudit(): ThreeTextureAudit {
  return {
    textureCount: 0,
    colorTextureCount: 0,
    srgbColorTextureCount: 0,
  };
}

function addTextureAudit(target: ThreeTextureAudit, next: ThreeTextureAudit): void {
  target.textureCount += next.textureCount;
  target.colorTextureCount += next.colorTextureCount;
  target.srgbColorTextureCount += next.srgbColorTextureCount;
}

type ShadowCastingLight = DirectionalLight | PointLight | SpotLight;

function isShadowCastingLight(light: Light): light is ShadowCastingLight {
  return light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight;
}

function isThreeObject3D(value: unknown): value is Object3D<Object3DEventMap> {
  return value instanceof Object3D;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

// TODO(P2): decompose this class into loader/camera/light/annotation modules.
// Scene class is >2,000 lines and mixes rendering, interaction, and knowledge capture (debt: renderer-three).
export class ThreeModelPreview implements WorkbenchPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private camera: PerspectiveCamera | OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObs: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly occlusionRaycaster = new Raycaster();
  private readonly renderObservers = new Set<() => void>();
  private readonly cameraZoomObservers = new Set<(state: CameraZoomState | null) => void>();
  private readonly pointer = new Vector2();
  private readonly annotationProjection = new Vector3();
  private readonly annotationDirection = new Vector3();
  private readonly sliceDragScratch = [new Vector3(), new Vector3(), new Vector3()];
  private readonly clock = { last: performance.now() };
  private readonly defaultLights: Light[] = [];
  private readonly configLights: Light[] = [];
  private environmentTarget: WebGLRenderTarget | null = null;
  private environmentInstallHandle = 0;
  private rootObject: Object3D | null = null;
  private loadedExt = "";
  private resourceWarnings: string[] = [];
  private textureAudit = createEmptyTextureAudit();
  private renderHandle = 0;
  private contextLost = false;
  private quality: "low" | "medium" | "high" = "high";
  private renderScale = 1;
  private interactivePixelRatioActive = false;
  private interactionPixelRatioDeadline = 0;
  private renderObserverSettleFrames = 0;
  private frameBudgetPixelRatioScale = 1;
  private frameBudgetSlowStreak = 0;
  private frameBudgetFastStreak = 0;
  private frameBudgetObserverStride = 1;
  private frameBudgetObserverCursor = 0;
  private frameBudgetShadowDeferred = false;
  private lastFrameDurationMs = 0;
  private readonly smoothness = new ThreeSmoothnessTracker();
  private viewportVisible = true;
  private viewportObserver: IntersectionObserver | null = null;
  private lastDisposalAudit: ThreeDisposalAudit = {
    reason: "initial",
    meshCount: 0,
    geometryCount: 0,
    materialCount: 0,
    textureCount: 0,
    objectCount: 0,
    timestamp: performance.now(),
  };
  private axesHelper: AxesHelper | null = null;
  /** Orientation-gizmo request, kept apart from the scene `axis` config flag. */
  private orientationGizmoEnabled = false;
  private bboxHelper: BoxHelper | null = null;
  private groundShadowMesh: Mesh | null = null;
  private meshShadowFlagsPrepared = false;
  private gridHelper: GridHelper | null = null;
  private bboxEnabled = false;
  private wireframeEnabled = false;
  private wireframeOriginalMaterials = new Map<number, Material | Material[]>();
  private sliceActive = false;
  private sliceNormal = new Vector3(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
  private slicePlaneX = new Vector3(1, 0, 0);
  private slicePlaneY = new Vector3(0, 0, -1);
  private sliceCenter: Vector3 | null = null;
  private sliceReferenceNormal = new Vector3(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
  private sliceOffset = DEFAULT_SLICE_OFFSET;
  private sliceInteractionMode: SliceInteractionMode = DEFAULT_SLICE_INTERACTION_MODE;
  private sliceThickness = DEFAULT_SLICE_THICKNESS;
  private slicePlanes: ThreePlane[] = [];
  private sliceOverlayPlanes: Mesh[] = [];
  private sliceOverlayLines: LineSegments[] = [];
  private sliceOverlayLabels: Sprite[] = [];
  private sliceDragState: ThreeSliceDragState | null = null;
  private readonly sliceObservers = new Set<() => void>();
  private readonly sliceOriginalMaterialClipping = new Map<string, ThreeMaterialClippingSnapshot>();
  private sliceOriginalLocalClippingEnabled: boolean | null = null;
  private sceneConfig: SceneConfig = {};
  private focusSelectionEnabled = false;
  private explodeStateActive = false;
  private focusedObject: Object3D | null = null;
  private highlightedObject: Object3D | null = null;
  private selectionHelper: BoxHelper | null = null;
  private focusHelper: BoxHelper | null = null;
  private mixer: AnimationMixer | null = null;
  private animationPlaying = false;
  private initialTarget = new Vector3();
  private initialPosition = new Vector3(3, 2, 3);
  private initialFov = DEFAULT_CAMERA_FOV;
  private initialZoom = 1;
  private initialNear = 0.01;
  private initialFar = 2000;
  /** Bounds the camera was last fitted against; refit on aspect change uses these. */
  private fittedBounds: PreviewBounds | null = null;
  /** Viewport aspect at the last camera fit, to detect meaningful aspect changes. */
  private fittedAspect = 0;
  /** Set when a `camera:` block config pins the pose, which suppresses aspect refits. */
  private cameraPoseFromConfig = false;
  /** Keep authored clip planes stable while aspect-aware fits update the reset pose. */
  private cameraClipFromConfig = false;
  private initialCameraMode: "perspective" | "orthographic" = "perspective";
  private cameraMode: "perspective" | "orthographic" = "perspective";
  private lastPointerDown: { x: number; y: number } | null = null;
  private readonly measurementSession = new MeasurementSessionController<Object3D, Vector3>();
  private measurementScale: MeasurementScale = { x: 1, y: 1, z: 1 };
  private measurementBaseRootScale = new Vector3(1, 1, 1);
  private measurementBaseBounds: PreviewBounds | null = null;
  private measurementUnit: MeasurementUnit = "mm";
  private readonly measurementOverlay = new MeasurementOverlayController<
    Object3D,
    Vector3,
    Mesh,
    ThreeMeasurementSegment
  >(this.measurementSession, {
    clonePoint: (point) => point.clone(),
    isSamePoint: (left, right) => left.distanceTo(right) < 0.0001,
    measureMarkerDistance: (left, right) =>
      this.toMeasurementDisplayPoint(left).distanceTo(this.toMeasurementDisplayPoint(right)),
    createMarker: (point) => this.createMeasurementMarker(point),
    disposeMarker: (marker) => this.disposeMeasurementMarker(marker),
    setMarkerState: (marker, state) => this.setMeasurementMarkerState(marker, state),
    updateMarkerPosition: (marker, point) => marker.position.copy(this.toMeasurementDisplayPoint(point)),
    createSegment: (start, end) => this.createMeasurementSegment(start, end),
    disposeSegment: (segment) => this.disposeMeasurementSegment(segment),
    updateSegmentLine: (segment) => this.updateMeasurementLineGeometry(segment),
    updateSegmentLabel: (segment) => this.updateMeasurementSegmentLabel(segment),
    ensurePreviewLine: () => this.ensurePreviewLine(),
    removePreviewLine: () => this.removePreviewLine(),
  });
  private measurementTargetHelper: BoxHelper | null = null;
  private readonly measurementSnapInputCache = new MeasurementGeometrySnapInputCache<Object3D>();
  private lastPointerClient = { x: 0, y: 0, altKey: false };

  private get measurementActive(): boolean {
    return this.measurementSession.active;
  }

  private set measurementActive(active: boolean) {
    this.measurementSession.setActive(active);
  }

  private get measurementTargetObject(): Object3D | null {
    return this.measurementSession.target;
  }

  private set measurementTargetObject(target: Object3D | null) {
    this.measurementSession.setTarget(target);
  }

  private get pendingPoint(): Vector3 | null {
    return this.measurementSession.pendingPoint;
  }
  private previewLine: LineSegments | null = null;
  private previewLineUpdateHandle = 0;
  private readonly originalMaterials = new Map<number, Material | Material[]>();
  private readonly focusedSelectedMeshes = new Map<number, Mesh>();
  private readonly focusDimMaterialCache = new ThreeFocusDimMaterialCache();
  private _lastPickResult: PreviewPickResult = { mesh: null, pickedPoint: null, screenX: 0, screenY: 0 };
  private _onPickCallbacks: Array<(result: PreviewPickResult) => void> = [];
  private disassembly: PreviewDisassemblyController | null = null;
  private disassemblySetup = false;
  private renderDirty = true;
  private stlMaterial: MeshStandardMaterial | null = null;
  private cachedMeshes: Mesh[] | null = null;
  private cachedMeshRoot: Object3D | null = null;
  private cachedRenderables: ThreeRenderableObject[] | null = null;
  private cachedRenderableRoot: Object3D | null = null;
  private cachedRenderableObjectCount: number | null = null;
  private cachedChildMeshMap: ThreeChildRenderableMeshMap | null = null;
  private cachedChildMeshMapRoot: Object3D | null = null;
  private cachedRenderableBoundsMap: ThreeRenderableBoundsMap | null = null;
  private cachedRenderableBoundsMapRoot: Object3D | null = null;
  private cachedRootPreviewBounds: PreviewBounds | null = null;
  private cachedRootPreviewBoundsObject: Object3D | null = null;
  private cachedGeometryQualityStats: PreviewQualitySnapshot["geometry"] | null = null;
  private cameraAnimHandle = 0;
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    this.prepareInteractiveFrameBudget();
    event.preventDefault();
    event.stopPropagation();
    this.markDirty();
  };
  private readonly handleControlsChange = () => {
    this.prepareInteractiveFrameBudget();
    if (this.measurementOverlay.segmentCount > 0) {
      this.updateMeasurementOverlayPositions();
    }
    this.markDirty();
    this.notifyCameraZoomChanged();
  };
  private readonly handleViewportIntersection: IntersectionObserverCallback = (entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const visible = entry.isIntersecting && entry.intersectionRatio > 0;
    if (visible === this.viewportVisible) return;
    this.viewportVisible = visible;
    if (visible) {
      this.clock.last = performance.now();
      this.markDirty();
      this.markShadowDirty();
      this.startRenderLoop();
    } else {
      cancelAnimationFrame(this.renderHandle);
      this.renderHandle = 0;
    }
  };
  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (this.sliceActive && this.beginSliceDrag(event)) return;
    this.lastPointerDown = { x: event.clientX, y: event.clientY };
    this.prepareInteractiveFrameBudget();
  };
  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (this.endSliceDrag(event)) return;
    this.lastPointerClient = { x: event.clientX, y: event.clientY, altKey: event.altKey };
    const down = this.lastPointerDown;
    this.lastPointerDown = null;
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    if (this.disassembly?.isEnabled()) return;
    if (this.sliceActive) return;
    this.dispatchPick(event);
  };
  private readonly handlePointerMove = (event: PointerEvent) => {
    this.lastPointerClient = { x: event.clientX, y: event.clientY, altKey: event.altKey };
    if (this.updateSliceDrag(event)) return;
    if (event.buttons & 1) {
      this.prepareInteractiveFrameBudget();
    }
    if (!this.measurementActive) return;
    if (this.pendingPoint) {
      this.schedulePreviewLineUpdate();
    }
    if (this.measurementOverlay.markerCount === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.measurementOverlay.getMarkers(), false);
    const hoveredMarker = hits.length > 0 ? hits[0].object as Mesh : null;
    if (this.measurementOverlay.setHoveredMarker(hoveredMarker)) {
      this.markDirty();
    }
  };
  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.endSliceDrag(event, true);
  };
  private readonly handleMeasurementModifierKey = (event: KeyboardEvent) => {
    if (event.key !== "Alt") return;
    this.updateMeasurementModifierAltKey(event.type === "keydown");
  };
  private readonly handleMeasurementModifierBlur = () => {
    this.updateMeasurementModifierAltKey(false);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = false;
    this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.initialFov, 1, 0.01, 2000);
    this.camera.position.copy(this.initialPosition);
    this.camera.lookAt(this.initialTarget);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 0.65;
    this.controls.screenSpacePanning = true;
    this.controls.target.copy(this.initialTarget);
    this.controls.addEventListener("change", this.handleControlsChange);

    this.installDefaultLighting();

    this.resizeObs = new ResizeObserver(() => this.resizeRenderer());
    this.resizeObs.observe(canvas);
    if (typeof IntersectionObserver !== "undefined") {
      this.viewportObserver = new IntersectionObserver(this.handleViewportIntersection, {
        root: null,
        threshold: [0, 0.01],
      });
      this.viewportObserver.observe(canvas);
    }
    canvas.addEventListener("wheel", this.preventCanvasWheelScroll, { passive: false });
    canvas.addEventListener("pointerdown", this.handlePointerDown, true);
    canvas.addEventListener("pointerup", this.handlePointerUp, true);
    canvas.addEventListener("pointermove", this.handlePointerMove, true);
    canvas.addEventListener("pointercancel", this.handlePointerCancel, true);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    window.addEventListener("keydown", this.handleMeasurementModifierKey);
    window.addEventListener("keyup", this.handleMeasurementModifierKey);
    window.addEventListener("blur", this.handleMeasurementModifierBlur);

    this.resizeRenderer();
    this.startRenderLoop();
  }

  async loadModel(
    data: ArrayBuffer,
    ext: string,
    readFile?: (path: string) => Promise<ArrayBuffer>,
    modelPath?: string,
    options?: PreviewLoadOptions,
  ): Promise<ModelPreviewSummary> {
    throwIfPreviewLoadInterrupted(options);
    this.clearLoadedModel("model-switch");
    throwIfPreviewLoadInterrupted(options);
    this.loadedExt = ext.toLowerCase();
    this.resourceWarnings = [];
    this.textureAudit = createEmptyTextureAudit();

    let root: Object3D | null = null;
    let animations: import("three").AnimationClip[] = [];

    try {
      const loaderKind = getDirectLoaderKind(this.loadedExt);
      if (loaderKind === "gltf") {
        const gltfResult = await loadThreeGLTF(data, this.loadedExt, readFile, modelPath, options);
        root = gltfResult.scene;
        animations = gltfResult.animations;
        this.resourceWarnings = gltfResult.warnings;
      } else if (loaderKind === "stl") {
        root = await loadThreeSTL(data);
        this.stlMaterial = isMesh(root) ? (root.material as MeshStandardMaterial) : null;
      } else if (loaderKind === "ply") {
        root = await loadThreePLY(data);
      } else if (loaderKind === "obj") {
        const objResult = await loadThreeOBJ(data, readFile, modelPath);
        root = objResult.object;
        this.resourceWarnings = objResult.warnings;
      } else if (loaderKind === "three-3mf") {
        root = await loadThree3MF(data);
      } else if (loaderKind === "three-dae") {
        const daeResult = await loadThreeDAE(data, modelPath);
        root = daeResult.object;
        animations = daeResult.animations;
      } else if (loaderKind === "three-off") {
        root = await loadThreeOFF(new TextDecoder().decode(new Uint8Array(data)));
      } else if (loaderKind === "three-pcd") {
        root = await loadThreePCD(data);
      } else if (loaderKind === "three-xyz") {
        root = await loadThreeXYZ(new TextDecoder().decode(new Uint8Array(data)));
      } else if (loaderKind === "three-fbx") {
        const fbxResult = await loadThreeFBX(data, modelPath);
        root = fbxResult.object;
        animations = fbxResult.animations;
      } else {
        throw new Error(`Three preview does not support .${this.loadedExt} format`);
      }

      throwIfPreviewLoadInterrupted(options);
      this.rootObject = root;
      this.scene.add(root);
      this.invalidateMeshCache();
      const renderableObjects = this.getRenderableObjects(root);
      this.prepareModelForQuality(renderableObjects);
      throwIfPreviewLoadInterrupted(options);
      this.syncShadowFeatures();
      const rootBounds = this.getRootPreviewBounds(root);
      this.captureMeasurementBaseState(root, rootBounds);
      this.updateShadowFraming(rootBounds);
      this.syncSceneHelpers();
      this.syncSliceClipping();
      this.notifySliceChanged();
      this.markDirty();

      if (animations.length > 0) {
        this.mixer = new AnimationMixer(root);
        for (const clip of animations) {
          this.mixer.clipAction(clip).play();
        }
        this.animationPlaying = true;
      }

      const summary = createThreeModelPreviewSummary(root, renderableObjects, this.resourceWarnings, rootBounds ?? undefined);
      // Geometry quality stats require per-object bounds and are only needed for diagnostics/performance snapshots.
      this.cachedGeometryQualityStats = null;
      this.fitCameraToObject(root, rootBounds ?? undefined);
      if (this.bboxEnabled) {
        this.ensureBoundingBoxHelper();
      }
      this.scheduleGlobalEnvironmentInstall();
      this.disassemblySetup = false;
      this.disassembly?.dispose();
      this.disassembly = null;
      return summary;
    } catch (error) {
      if (root) {
        root.removeFromParent();
        if (this.rootObject === root) {
          this.rootObject = null;
        }
        this.lastDisposalAudit = this.disposeObjectGraph(root, "model-switch");
        this.invalidateMeshCache();
      }
      throw error;
    }
  }

  applyConfig(config: ThreeDBlockConfig): void {
    if (config.camera) this.applyCameraConfig(config.camera);
    if (config.lights) this.applyLightConfig(config.lights);
    if (config.scene) this.applySceneConfig(config.scene);
    // Matches the Babylon path: `stl:` options are format-scoped, so they must not
    // wireframe or recolor a GLB that happens to share the block config.
    if (config.stl && this.loadedExt === "stl") this.applySTLConfig(config.stl);
  }

  private applySTLConfig(config: STLConfig): void {
    if (config.color !== undefined) {
      this.setSTLColor(config.color);
    }
    if (config.wireframe !== undefined) {
      // Route through setWireframe so `wireframeEnabled` tracks the config. Setting
      // `stlMaterial.wireframe` directly left the toolbar toggle reading "off" while
      // the model rendered as wireframe, and the next toggle then layered override
      // materials on top of the already-wireframed original.
      this.setWireframe(config.wireframe);
    }
  }

  setSTLColor(hex: string): void {
    const material = this.stlMaterial;
    if (!material) return;
    material.color.set(hex);
    material.needsUpdate = true;
    if (this.wireframeEnabled) {
      // Stand-ins copied the previous color when wireframe was enabled, so rebuild
      // them; otherwise the new color only appears after wireframe is turned off.
      this.applyWireframe(false);
      this.applyWireframe(true);
    }
    this.markDirty();
  }

  destroy(): void {
    cancelAnimationFrame(this.renderHandle);
    cancelAnimationFrame(this.cameraAnimHandle);
    this._onPickCallbacks = [];
    this.renderObservers.clear();
    this.cameraZoomObservers.clear();
    this.measurementSession.clearObservers();
    this.sliceObservers.clear();
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.clearFocusedMesh();
    this.clearSelectionHighlight();
    this.clearLoadedModel("destroy");
    for (const light of this.configLights) {
      this.disposeConfiguredLight(light);
    }
    this.configLights.length = 0;
    for (const light of this.defaultLights) {
      this.disposeConfiguredLight(light);
    }
    this.defaultLights.length = 0;
    this.disposeGlobalEnvironment();
    this.disposeAxisHelper();
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.classList.remove("ai3d-slice-active", "ai3d-slice-dragging", "ai3d-slice-rotate");
    canvas.removeEventListener("wheel", this.preventCanvasWheelScroll);
    canvas.removeEventListener("pointerdown", this.handlePointerDown, true);
    canvas.removeEventListener("pointerup", this.handlePointerUp, true);
    canvas.removeEventListener("pointermove", this.handlePointerMove, true);
    canvas.removeEventListener("pointercancel", this.handlePointerCancel, true);
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    window.removeEventListener("keydown", this.handleMeasurementModifierKey);
    window.removeEventListener("keyup", this.handleMeasurementModifierKey);
    window.removeEventListener("blur", this.handleMeasurementModifierBlur);
    this.resizeObs.disconnect();
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    this.renderer.dispose();
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.renderer.domElement;
  }

  captureSnapshot(): string | null {
    this.renderNow(0);
    return this.renderer.domElement.toDataURL("image/png");
  }

  getAnnotationProvider(): AnnotationViewportProvider {
    const canvas = this.renderer.domElement;
    return createAnnotationViewportProvider({
      canvas,
      observeRender: (callback) => {
        this.renderObservers.add(callback);
        this.setRenderObserverSettleFrames();
        this.markDirty();
        return {
          remove: () => {
            this.renderObservers.delete(callback);
            if (this.renderObservers.size === 0) {
              this.setRenderObserverSettleFrames(0);
            }
          },
        };
      },
      getCameraStateKey: () => this.getAnnotationCameraStateKey(),
      projectWorldPoint: (point, result) => this.projectAnnotationWorldPoint(point, result),
      isWorldPointOccluded: (point) => this.isAnnotationWorldPointOccluded(point),
    });
  }

  exportModelInfo(modelPath?: string): string {
    if (!this.rootObject) return "";
    const renderableObjects = this.getRenderableObjects(this.rootObject);
    const summary = createThreeModelPreviewSummary(
      this.rootObject,
      renderableObjects,
      this.resourceWarnings,
      this.getRootPreviewBounds() ?? undefined,
    );
    const name = modelPath ? getPortableBasename(modelPath) || summary.rootName : summary.rootName;
    return createPreviewModelInfoMarkdown({
      title: name,
      format: this.loadedExt.toUpperCase(),
      summary,
      meshBreakdown: renderableObjects.map(createThreeRenderableInfoBreakdown),
    });
  }

  getModelEvidence(): ModelEvidence | null {
    if (!this.rootObject) return null;
    const renderableObjects = this.getRenderableObjects(this.rootObject);
    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    const childMeshMap = this.getChildRenderableMeshMap(this.rootObject);
    const boundsMap = this.getRenderableBoundsMap(this.rootObject);
    const groupedPartCandidates = createThreeGroupedPartCandidates(this.rootObject, renderableMeshes, childMeshMap, boundsMap);
    const groupedRenderableCandidates = {
      parts: groupedPartCandidates.parts,
      groupedMeshes: new Set<ThreeRenderableObject>(groupedPartCandidates.groupedMeshes),
    };
    return createPreviewEvidence({
      summary: createThreeModelPreviewSummary(
        this.rootObject,
        renderableObjects,
        this.resourceWarnings,
        this.getRootPreviewBounds() ?? undefined,
      ),
      renderableMeshes: renderableObjects,
      groupedPartCandidates: groupedRenderableCandidates,
      createMeshPart: (object) => createThreeRenderablePartPreviewSummary(object, this.rootObject, boundsMap),
      getMeshMaterialNames: getThreeRenderableMaterialNames,
      resourceWarnings: this.resourceWarnings,
    });
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    const object = this.focusedObject
      ?? (isThreeObject3D(this._lastPickResult.mesh) ? this._lastPickResult.mesh : null);
    if (!object) return null;
    const renderableMeshes = this.rootObject ? this.getRenderableMeshes(this.rootObject) : [];
    const childMeshMap = this.rootObject ? this.getChildRenderableMeshMap(this.rootObject) : undefined;
    return createThreeObjectPartPreviewSummary(object, this.rootObject, renderableMeshes, childMeshMap);
  }

  exportSelectedPartInfo(): string {
    const part = this.getSelectedPartInfo();
    return part ? createPreviewPartInfoMarkdown(part) : "";
  }

  getPickWorldPoint(result: PreviewPickResult): PreviewWorldPoint | null {
    if (result.pickedPoint && typeof result.pickedPoint === "object") {
      return toPreviewWorldPoint(result.pickedPoint as { x: number; y: number; z: number });
    }

    if (isThreeObject3D(result.mesh)) {
      return getPreviewBoundsCenter(getObjectPreviewBounds(result.mesh));
    }

    return null;
  }

  onPick(callback: (result: PreviewPickResult) => void): () => void {
    this._onPickCallbacks.push(callback);
    return () => {
      this._onPickCallbacks = this._onPickCallbacks.filter((entry) => entry !== callback);
    };
  }

  resetView(): void {
    if (this.rootObject && this.explodeStateActive) {
      resetThreeExplode(this.rootObject);
      this.explodeStateActive = false;
      this.invalidateRootBoundsCache();
      this.markShadowDirty();
    }
    this.resetDisassembly();
    this.clearFocusedMesh();
    this.clearSelectionHighlight();

    this.switchCameraMode(this.initialCameraMode);
    this.camera.position.copy(this.initialPosition);
    this.controls.target.copy(this.initialTarget);
    this.camera.lookAt(this.controls.target);
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = this.initialFov;
    }
    this.camera.zoom = this.initialZoom;
    this.camera.near = this.initialNear;
    this.camera.far = this.initialFar;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.markDirty();
    this.renderNow(performance.now());
    this.notifyCameraZoomChanged();
  }

  toggleFocusSelection(): boolean {
    const nextEnabled = !this.focusSelectionEnabled;
    if (nextEnabled && this.disassembly?.isEnabled()) {
      this.disableDisassemblyAndReset();
    }
    if (nextEnabled) {
      this.deactivateMeasurementMode();
      this.deactivateSliceMode();
    }
    this.focusSelectionEnabled = nextEnabled;
    if (!this.focusSelectionEnabled) {
      this.clearFocusedMesh();
    } else {
      this.clearSelectionHighlight();
      if (this._lastPickResult.mesh instanceof Object3D) {
        this.setFocusedObject(this._lastPickResult.mesh);
      }
    }
    this.markDirty();
    return this.focusSelectionEnabled;
  }

  isFocusSelectionEnabled(): boolean {
    return this.focusSelectionEnabled;
  }

  setWireframe(enabled: boolean): void {
    if (enabled === this.wireframeEnabled) return;
    this.wireframeEnabled = enabled;
    this.applyWireframe(enabled);
    this.syncSliceClipping();
    this.markDirty();
  }

  toggleWireframe(): boolean {
    this.setWireframe(!this.wireframeEnabled);
    return this.wireframeEnabled;
  }

  private applyWireframe(enabled: boolean): void {
    if (!this.rootObject) return;

    for (const mesh of this.getRenderableMeshes(this.rootObject)) {
      if (enabled) {
        this.wireframeOriginalMaterials.set(mesh.id, mesh.material);
        mesh.material = createThreeWireframeMaterialValue(mesh.material);
      } else {
        const original = this.wireframeOriginalMaterials.get(mesh.id);
        if (original) {
          // Drop the stand-ins created on enable; only originals stay alive.
          disposeThreeWireframeOverrides(mesh.material, original);
          mesh.material = original;
        }
        this.wireframeOriginalMaterials.delete(mesh.id);
      }
    }
  }

  /** Restore pre-wireframe materials so model disposal can reach the originals. */
  private restoreWireframeMaterials(): void {
    if (this.wireframeOriginalMaterials.size === 0) return;
    if (this.rootObject) {
      for (const mesh of this.getRenderableMeshes(this.rootObject)) {
        const original = this.wireframeOriginalMaterials.get(mesh.id);
        if (!original) continue;
        disposeThreeWireframeOverrides(mesh.material, original);
        mesh.material = original;
      }
    }
    this.wireframeOriginalMaterials.clear();
  }

  toggleOrientationGizmo(): boolean {
    this.orientationGizmoEnabled = !this.orientationGizmoEnabled;
    this.syncAxisHelper();
    this.markDirty();
    return this.orientationGizmoEnabled;
  }

  isOrientationGizmoEnabled(): boolean {
    return this.orientationGizmoEnabled;
  }

  toggleBoundingBox(): boolean {
    this.bboxEnabled = !this.bboxEnabled;
    if (!this.bboxEnabled) {
      this.disposeBoxHelper(this.bboxHelper);
      this.bboxHelper = null;
      this.markDirty();
      return false;
    }

    this.ensureBoundingBoxHelper();
    this.markDirty();
    return !!this.bboxHelper;
  }

  toggleSlice(): boolean {
    if (this.sliceActive) {
      this.deactivateSliceMode();
      return false;
    }
    if (this.disassembly?.isEnabled()) {
      this.disableDisassemblyAndReset();
    }
    this.deactivateMeasurementMode();
    if (this.focusSelectionEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
      this.clearSelectionHighlight();
    }
    this.alignSlicePlaneToWorld();
    this.sliceInteractionMode = DEFAULT_SLICE_INTERACTION_MODE;
    this.sliceActive = true;
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.sliceActive;
  }

  isSliceActive(): boolean {
    return this.sliceActive;
  }

  setSlicePlane(normal: PreviewWorldPoint, offset = this.sliceOffset): SliceState {
    const normalized = normalizeSliceNormal(normal);
    this.sliceNormal.set(normalized.x, normalized.y, normalized.z);
    this.rebuildSlicePlaneAxes();
    this.sliceOffset = normalizeSliceOffset(offset);
    this.setSliceCenterFromOffset(this.sliceOffset);
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.getSliceState();
  }

  setSliceOffset(offset: number): SliceState {
    this.sliceOffset = normalizeSliceOffset(offset);
    this.setSliceCenterFromOffset(this.sliceOffset);
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.getSliceState();
  }

  setSliceRotation(rotation: PreviewEulerDegrees): SliceState {
    const bounds = this.getRootPreviewBounds();
    const range = this.getSliceRange();
    const anchor = this.sliceCenter?.clone()
      ?? (range ? new Vector3(range.point.x, range.point.y, range.point.z) : null);
    const axes = createSlicePlaneAxesFromEulerDegrees(rotation);
    this.slicePlaneX.set(axes.x.x, axes.x.y, axes.x.z);
    this.slicePlaneY.set(axes.y.x, axes.y.y, axes.y.z);
    this.sliceNormal.set(axes.z.x, axes.z.y, axes.z.z);
    if (anchor) {
      this.sliceCenter = anchor;
      this.sliceOffset = createSliceOffsetForPoint(bounds, axes.z, toPreviewWorldPoint(anchor));
    } else {
      this.setSliceCenterFromOffset(this.sliceOffset);
    }
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.getSliceState();
  }

  setSliceInteractionMode(mode: SliceInteractionMode): SliceState {
    const nextMode = normalizeSliceInteractionMode(mode);
    if (nextMode === this.sliceInteractionMode) return this.getSliceState();
    this.endSliceDrag(null, true);
    this.sliceInteractionMode = nextMode;
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.getSliceState();
  }

  resetSlicePlane(): SliceState {
    this.alignSlicePlaneToWorld();
    this.sliceOffset = DEFAULT_SLICE_OFFSET;
    this.setSliceCenterFromOffset(this.sliceOffset);
    this.syncSliceClipping();
    this.notifySliceChanged();
    return this.getSliceState();
  }

  setSliceAxis(axis: PreviewAxis): SliceState {
    const normalizedAxis = normalizeSliceAxis(axis);
    return this.setSlicePlane({
      x: normalizedAxis === "x" ? 1 : 0,
      y: normalizedAxis === "y" ? 1 : 0,
      z: normalizedAxis === "z" ? 1 : 0,
    });
  }

  setSlicePosition(position: number): SliceState {
    return this.setSliceOffset(position);
  }

  setSliceThickness(thickness: number): SliceState {
    this.sliceThickness = normalizeSliceThickness(thickness);
    this.notifySliceChanged();
    return this.getSliceState();
  }

  getSliceState(): SliceState {
    const state = createSliceState(
      this.sliceActive,
      toPreviewWorldPoint(this.sliceNormal),
      this.sliceOffset,
      this.getRootPreviewBounds(),
      !!this.sliceDragState,
      this.sliceThickness,
      this.sliceInteractionMode,
      toPreviewWorldPoint(this.sliceReferenceNormal),
    );
    const range = this.getSliceRange();
    const rotationDegrees = getSliceEulerDegreesFromPlaneAxes({
      x: toPreviewWorldPoint(this.slicePlaneX),
      y: toPreviewWorldPoint(this.slicePlaneY),
      z: toPreviewWorldPoint(this.sliceNormal),
    });
    return range
      ? { ...state, rotationDegrees, offset: range.offset, position: range.offset, point: { ...range.point } }
      : { ...state, rotationDegrees };
  }

  observeSlice(callback: () => void): () => void {
    this.sliceObservers.add(callback);
    callback();
    return () => {
      this.sliceObservers.delete(callback);
    };
  }

  hasAnimations(): boolean {
    return this.mixer !== null;
  }

  toggleAnimation(): boolean {
    if (!this.mixer) return false;
    this.animationPlaying = !this.animationPlaying;
    this.mixer.timeScale = this.animationPlaying ? 1 : 0;
    this.markDirty();
    return this.animationPlaying;
  }

  toggleMeasurement(): boolean {
    if (this.measurementActive) {
      this.deactivateMeasurementMode();
      return false;
    }
    if (this.disassembly?.isEnabled()) {
      this.disableDisassemblyAndReset();
    }
    this.deactivateSliceMode();
    const measurementTarget = this.getCurrentMeasurementTargetObject();
    this.clearSelectionHighlight();
    if (this.focusSelectionEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
    }
    this.measurementActive = true;
    this.setMeasurementTargetObject(measurementTarget, false);
    setMeasurementCanvasActive(this.renderer.domElement, this.measurementActive);
    this.notifyMeasurementsChanged();
    return this.measurementActive;
  }

  isMeasurementActive(): boolean {
    return this.measurementActive;
  }

  clearMeasurements(): void {
    this.disposeMeasurementOverlays(false);
  }

  cancelMeasurement(): void {
    const hadPendingPoint = this.measurementSession.hasPendingPoint;
    this.cancelPendingMeasurement();
    if (hadPendingPoint) {
      this.notifyMeasurementsChanged();
    }
  }

  private deactivateMeasurementMode(): boolean {
    if (!this.measurementActive) return false;
    this.measurementActive = false;
    setMeasurementCanvasActive(this.renderer.domElement, false);
    this.setMeasurementTargetObject(null, false);
    this.cancelPendingMeasurement();
    this.notifyMeasurementsChanged();
    return true;
  }

  private disposeMeasurementOverlays(deactivate: boolean): void {
    if (deactivate) {
      this.measurementActive = false;
      setMeasurementCanvasActive(this.renderer.domElement, false);
      this.setMeasurementTargetObject(null, false);
    }
    this.measurementOverlay.clear();
    this.setMeasurementSnapKind(null, false);
    this.markDirty();
    this.notifyMeasurementsChanged();
  }


  setMeasurementScale(scale: MeasurementScale): void {
    this.measurementScale = sanitizeMeasurementScale(scale);
    this.measurementSnapInputCache.invalidate();
    this.applyMeasurementModelScale();
    if (this.sliceActive) {
      this.setSliceCenterFromOffset(this.sliceOffset);
      this.syncSliceClipping();
    }
    this.selectionHelper?.update();
    this.focusHelper?.update();
    this.updateMeasurementOverlayPositions();
    this.updateMeasurementLabels();
    this.notifyMeasurementsChanged();
  }

  getMeasurementScale(): MeasurementScale {
    return { ...this.measurementScale };
  }

  setMeasurementUnit(unit: MeasurementUnit): void {
    this.measurementUnit = normalizeMeasurementUnit(unit);
    this.updateMeasurementLabels();
    this.notifyMeasurementsChanged();
  }

  getMeasurementUnit(): MeasurementUnit {
    return this.measurementUnit;
  }

  getMeasurementBounds(): { x: number; y: number; z: number } | null {
    if (!this.rootObject) return null;
    const bounds = this.measurementBaseBounds ?? getObjectPreviewBounds(this.rootObject);
    const size = getPreviewBoundsSize(bounds);
    return size;
  }

  getMeasurementRecords(): MeasurementRecord[] {
    return this.createMeasurementRecords();
  }

  getMeasurementState(): MeasurementState {
    return this.measurementSession.createState({
      records: this.createMeasurementRecords(),
      unit: this.measurementUnit,
      scale: this.getMeasurementScale(),
      bounds: this.getMeasurementBounds(),
      targetName: this.getMeasurementTargetName(),
      targetScope: this.measurementTargetObject === this.rootObject ? "model" : "part",
    });
  }

  exportMeasurements(): string {
    return createMeasurementMarkdown(this.createMeasurementRecords());
  }

  observeMeasurements(callback: () => void): () => void {
    return this.measurementSession.observe(callback);
  }

  updateMeasurementLabels(): void {
    if (this.measurementOverlay.segmentCount === 0) return;
    this.measurementOverlay.updateSegmentLabels();
    this.markDirty();
  }

  private captureMeasurementBaseState(root: Object3D, rootBounds: PreviewBounds | null): void {
    this.measurementBaseRootScale.copy(root.scale);
    this.measurementBaseBounds = rootBounds ? createPreviewBounds(rootBounds.min, rootBounds.max) : null;
    this.measurementScale = { x: 1, y: 1, z: 1 };
  }

  private resetMeasurementCalibrationState(): void {
    this.measurementScale = { x: 1, y: 1, z: 1 };
    this.measurementBaseRootScale.set(1, 1, 1);
    this.measurementBaseBounds = null;
    this.measurementSnapInputCache.invalidate();
  }

  private applyMeasurementModelScale(): void {
    if (!this.rootObject) return;
    this.applyRootMeasurementScale();
    this.invalidateRootBoundsCache();
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    this.updateShadowFraming(bounds);
    if (this.bboxEnabled) {
      this.ensureBoundingBoxHelper();
    }
    this.removeGroundShadow();
    this.removeGrid();
    this.syncSceneHelpers();
    this.fitCameraToObject(this.rootObject, bounds);
    this.applyRootMeasurementScale();
    this.invalidateRootBoundsCache();
  }

  private applyRootMeasurementScale(): void {
    if (!this.rootObject) return;
    const scale = sanitizeMeasurementScale(this.measurementScale);
    this.rootObject.scale.set(
      this.measurementBaseRootScale.x * scale.x,
      this.measurementBaseRootScale.y * scale.y,
      this.measurementBaseRootScale.z * scale.z,
    );
    this.rootObject.updateMatrixWorld(true);
  }

  private getMeasurementPivot(): Vector3 {
    if (!this.rootObject) return new Vector3();
    return this.rootObject.getWorldPosition(new Vector3());
  }

  private toMeasurementDisplayPoint(point: Vector3): Vector3 {
    const next = scaleMeasurementPointFromBase(point, this.getMeasurementPivot(), this.measurementScale);
    return new Vector3(next.x, next.y, next.z);
  }

  private toMeasurementBasePoint(point: Vector3): Vector3 {
    const next = unscaleMeasurementPointToBase(point, this.getMeasurementPivot(), this.measurementScale);
    return new Vector3(next.x, next.y, next.z);
  }

  private updateMeasurementOverlayPositions(): void {
    this.updateMeasurementTargetHelper();
    this.measurementOverlay.updateMarkerPositions();
    this.measurementOverlay.updateSegmentLines();
    if (this.pendingPoint && this.previewLine) {
      this.schedulePreviewLineUpdate();
    }
  }

  private updateMeasurementLineGeometry(segment: ThreeMeasurementSegment): void {
    const layout = this.createThreeMeasurementDraftingLayout(segment.start, segment.end);
    const linePoints = layout?.linePoints ?? [
      this.toMeasurementDisplayPoint(segment.start),
      this.toMeasurementDisplayPoint(segment.end),
    ];
    const position = segment.line.geometry.getAttribute("position");
    if (position.count !== linePoints.length) {
      segment.line.geometry.dispose();
      segment.line.geometry = new BufferGeometry().setFromPoints(linePoints);
    } else {
      for (let i = 0; i < linePoints.length; i++) {
        const point = linePoints[i];
        position.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
    }
    if (layout) {
      segment.label.position.copy(layout.labelPosition);
    }
    segment.line.geometry.computeBoundingSphere();
  }
  setRenderQuality(quality: "low" | "medium" | "high", renderScale = this.renderScale): void {
    this.quality = quality;
    this.renderScale = renderScale;
    this.syncGlobalEnvironmentForQuality();
    this.applyShadowQuality();
    this.resizeRenderer();
  }

  setRenderScale(scale: number): number {
    this.renderScale = Math.min(2, Math.max(0.25, scale));
    this.resizeRenderer();
    return Number(this.renderScale.toFixed(2));
  }

  getRenderScale(): number {
    return Number(this.renderScale.toFixed(2));
  }

  getCameraZoomState(): CameraZoomState | null {
    const range = this.getCameraZoomRange();
    if (!range) return null;
    const value = range.mode === "distance"
      ? (range.max - range.current) / (range.max - range.min)
      : (range.current - range.min) / (range.max - range.min);
    const clamped = clampUnit(value);
    return {
      value: clamped,
      percentage: Math.round(clamped * 100),
    };
  }

  setCameraZoom(value: number): CameraZoomState | null {
    const range = this.getCameraZoomRange();
    if (!range) return null;
    const clamped = clampUnit(value);
    if (range.mode === "distance") {
      const distance = range.max - clamped * (range.max - range.min);
      const direction = this.camera.position.clone().sub(this.controls.target);
      if (direction.lengthSq() < Number.EPSILON) {
        direction.copy(this.initialPosition).sub(this.initialTarget);
      }
      direction.normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.camera.lookAt(this.controls.target);
    } else {
      this.camera.zoom = range.min + clamped * (range.max - range.min);
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.prepareInteractiveFrameBudget();
    this.markDirty();
    this.notifyCameraZoomChanged();
    return this.getCameraZoomState();
  }

  observeCameraZoom(callback: (state: CameraZoomState | null) => void): () => void {
    this.cameraZoomObservers.add(callback);
    callback(this.getCameraZoomState());
    return () => {
      this.cameraZoomObservers.delete(callback);
    };
  }

  getPerformanceSnapshot() {
    const smoothness = this.smoothness.snapshot();
    const qualitySnapshot = this.getQualitySnapshot();
    return {
      backend: "three" as const,
      renderScale: Number(this.renderScale.toFixed(2)),
      quality: this.quality,
      pixelRatio: Number(this.renderer.getPixelRatio().toFixed(2)),
      interactivePixelRatioActive: this.interactivePixelRatioActive,
      renderDirty: this.renderDirty,
      renderObserverCount: this.renderObservers.size,
      renderObserverSettleFrames: this.renderObserverSettleFrames,
      frameBudgetPixelRatioScale: Number(this.frameBudgetPixelRatioScale.toFixed(2)),
      frameBudgetObserverStride: this.frameBudgetObserverStride,
      frameBudgetShadowDeferred: this.frameBudgetShadowDeferred,
      lastFrameDurationMs: Number(this.lastFrameDurationMs.toFixed(2)),
      averageRenderMs: smoothness.averageRenderMs,
      p95RenderMs: smoothness.p95RenderMs,
      maxRenderMs: smoothness.maxRenderMs,
      renderedFrameCount: smoothness.renderedFrameCount,
      slowFrameCount: smoothness.slowFrameCount,
      idleFrameSkipCount: smoothness.idleFrameSkipCount,
      adaptiveScaleChangeCount: smoothness.adaptiveScaleChangeCount,
      viewportVisible: this.viewportVisible,
      disposalAudit: { ...this.lastDisposalAudit },
      meshCount: qualitySnapshot.geometry.meshCount,
      qualitySnapshot,
    };
  }

  getQualitySnapshot(): PreviewQualitySnapshot {
    const geometry = this.getGeometryQualityStats();
    const smoothness = this.smoothness.snapshot();
    return {
      backend: "three",
      supportedFormats: ["glb", "gltf", "stl", "ply", "obj"],
      colorPipeline: {
        outputColorSpace: String(this.renderer.outputColorSpace),
        toneMapping: this.renderer.toneMapping === NoToneMapping ? "NoToneMapping" : String(this.renderer.toneMapping),
        textureCount: this.textureAudit.textureCount,
        colorTextureCount: this.textureAudit.colorTextureCount,
        srgbColorTextureCount: this.textureAudit.srgbColorTextureCount,
      },
      geometry,
      camera: {
        near: Number(this.camera.near.toPrecision(6)),
        far: Number(this.camera.far.toPrecision(6)),
        nearFarRatio: Number((this.camera.far / Math.max(this.camera.near, Number.EPSILON)).toPrecision(6)),
      },
      performance: {
        renderScale: Number(this.renderScale.toFixed(2)),
        pixelRatio: Number(this.renderer.getPixelRatio().toFixed(2)),
        frameBudgetPixelRatioScale: Number(this.frameBudgetPixelRatioScale.toFixed(2)),
        frameBudgetObserverStride: this.frameBudgetObserverStride,
        viewportVisible: this.viewportVisible,
        renderedFrameCount: smoothness.renderedFrameCount,
        idleFrameSkipCount: smoothness.idleFrameSkipCount,
        slowFrameCount: smoothness.slowFrameCount,
        averageRenderMs: smoothness.averageRenderMs,
        p95RenderMs: smoothness.p95RenderMs,
        maxRenderMs: smoothness.maxRenderMs,
        adaptiveScaleChangeCount: smoothness.adaptiveScaleChangeCount,
      },
    };
  }

  setExplode(factor: number, axis: PreviewAxis): void {
    if (!this.rootObject) return;
    const nextActive = Math.abs(factor) > Number.EPSILON;
    if (!nextActive && !this.explodeStateActive) return;
    setThreeExplode(this.rootObject, factor, axis);
    this.explodeStateActive = nextActive;
    this.invalidateRootBoundsCache();
    this.markShadowDirty();
    this.markDirty();
  }

  resetExplode(): void {
    if (!this.rootObject) return;
    if (!this.explodeStateActive) return;
    resetThreeExplode(this.rootObject);
    this.explodeStateActive = false;
    this.invalidateRootBoundsCache();
    this.markShadowDirty();
    this.markDirty();
  }

  focusWorldPoint(point: PreviewWorldPoint): void {
    const target = new Vector3(point.x, point.y, point.z);
    const distance = this.camera.position.distanceTo(this.controls.target);
    const direction = target.clone().sub(this.camera.position).normalize();
    const newCamPos = target.clone().sub(direction.multiplyScalar(distance));

    this.animateCamera(newCamPos, target);
  }

  toggleDisassembly(): boolean {
    this.ensureDisassembly();
    if (!this.disassembly) return false;
    const nextEnabled = !this.disassembly.isEnabled();
    if (nextEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
      this.clearSelectionHighlight();
      this.deactivateMeasurementMode();
      this.deactivateSliceMode();
    }
    const enabled = this.disassembly.setEnabled(nextEnabled);
    if (!enabled) {
      this.disassembly.reset();
    }
    return enabled;
  }

  resetDisassembly(): void {
    if (!this.disassembly) return;
    this.disassembly.reset();
    this.invalidateRootBoundsCache();
  }

  private disableDisassemblyAndReset(): void {
    if (!this.disassembly?.isEnabled()) return;
    this.disassembly.setEnabled(false);
    this.resetDisassembly();
  }

  isDisassemblyEnabled(): boolean {
    return this.disassembly?.isEnabled() ?? false;
  }

  private ensureDisassembly(): void {
    if (this.disassemblySetup) return;
    this.disassemblySetup = true;
    if (!this.rootObject) return;
    const meshes = this.getRenderableMeshes(this.rootObject);
    if (meshes.length === 0) return;
    this.disassembly = createThreeDisassemblyController(
      this.scene,
      this.camera,
      this.renderer.domElement,
      this.rootObject,
      meshes,
      this.controls,
      () => {
        this.invalidateRootBoundsCache();
        this.markShadowDirty();
        this.markDirty();
      },
      this.getChildRenderableMeshMap(this.rootObject),
    );
  }

  private animateCamera(targetPos: Vector3, targetLookAt: Vector3): void {
    cancelAnimationFrame(this.cameraAnimHandle);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = CAMERA_ANIMATION_MS;
    const startTime = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
      this.controls.update();
      this.markDirty();

      if (t < 1) {
        this.cameraAnimHandle = window.requestAnimationFrame(tick);
      }
    };
    this.cameraAnimHandle = window.requestAnimationFrame(tick);
  }

  private startRenderLoop(): void {
    if (this.renderHandle || !this.viewportVisible || this.contextLost) return;
    const tick = () => {
      if (!this.viewportVisible || this.contextLost) {
        this.renderHandle = 0;
        return;
      }
      const keepRunning = this.renderNow(performance.now());
      this.renderHandle = keepRunning ? window.requestAnimationFrame(tick) : 0;
    };
    this.renderHandle = window.requestAnimationFrame(tick);
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    if (this.renderHandle) {
      cancelAnimationFrame(this.renderHandle);
      this.renderHandle = 0;
    }
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    this.markDirty();
    this.startRenderLoop();
  };

  private renderNow(now: number): boolean {
    const canvas = this.renderer.domElement;
    if (!this.viewportVisible || !canvas.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
      return false;
    }

    const deltaSeconds = Math.max(0, (now - this.clock.last) / 1000);
    this.clock.last = now;

    // Pass the real frame delta so auto-rotation runs at a wall-clock speed instead
    // of OrbitControls' 60fps assumption, which drifts on high-refresh displays and
    // stalls on heavy scenes. Clamped so a backgrounded tab cannot jump the model.
    const cameraMoved = this.controls.update(Math.min(deltaSeconds, MAX_CONTROLS_DELTA_SECONDS));
    const animating = !!this.mixer && this.animationPlaying;
    if (animating && this.mixer) {
      this.mixer.update(deltaSeconds);
      this.markShadowDirty();
    }
    this.restoreInteractivePixelRatioIfIdle(now, cameraMoved);

    if (!cameraMoved && !animating && !this.renderDirty) {
      this.smoothness.recordIdleFrameSkip();
      if (this.renderObserverSettleFrames > 0) {
        this.renderObserverSettleFrames--;
        this.notifyRenderObservers();
      }
      return this.shouldContinueRenderLoop(cameraMoved, animating);
    }
    this.renderDirty = false;
    this.setRenderObserverSettleFrames();

    this.bboxHelper?.update();
    this.selectionHelper?.update();
    this.focusHelper?.update();
    if (this.axesHelper && this.axesHelper.visible) {
      this.axesHelper.position.copy(this.controls.target);
    }
    const renderStartedAt = performance.now();
    this.renderer.render(this.scene, this.camera);
    const frameDurationMs = performance.now() - renderStartedAt;
    this.smoothness.recordRenderedFrame(frameDurationMs, FRAME_BUDGET_SLOW_MS);
    this.updateFrameBudget(frameDurationMs);
    this.notifyRenderObservers();
    return this.shouldContinueRenderLoop(cameraMoved, animating);
  }

  private shouldContinueRenderLoop(cameraMoved: boolean, animating: boolean): boolean {
    return shouldContinueThreeRenderLoop({
      cameraMoved,
      animating,
      renderDirty: this.renderDirty,
      renderObserverCount: this.renderObservers.size,
      renderObserverSettleFrames: this.renderObserverSettleFrames,
    });
  }

  private notifyRenderObservers(): void {
    if (this.frameBudgetObserverStride > 1) {
      this.frameBudgetObserverCursor = (this.frameBudgetObserverCursor + 1) % this.frameBudgetObserverStride;
      if (this.frameBudgetObserverCursor !== 0) return;
    }
    for (const callback of this.renderObservers) {
      callback();
    }
  }

  private markDirty(): void {
    this.renderDirty = true;
    this.startRenderLoop();
  }

  private markShadowDirty(): void {
    if (!this.renderer.shadowMap.enabled) {
      this.frameBudgetShadowDeferred = false;
      this.renderer.shadowMap.needsUpdate = false;
      return;
    }
    if (this.shouldDeferShadowRefresh()) {
      this.frameBudgetShadowDeferred = true;
      return;
    }
    this.frameBudgetShadowDeferred = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private prepareInteractiveFrameBudget(): void {
    const now = performance.now();
    this.interactionPixelRatioDeadline = now + INTERACTIVE_PIXEL_RATIO_HOLD_MS;
    if (this.activateInteractivePixelRatio()) {
      this.resizeRenderer();
    }
  }

  private activateInteractivePixelRatio(): boolean {
    if (this.interactivePixelRatioActive) return false;
    const normalPixelRatio = this.computePixelRatio(false);
    const interactivePixelRatio = this.computePixelRatio(true);
    if (interactivePixelRatio >= normalPixelRatio) return false;
    this.interactivePixelRatioActive = true;
    return true;
  }

  private restoreInteractivePixelRatioIfIdle(now: number, cameraMoved: boolean): void {
    if (!this.interactivePixelRatioActive || cameraMoved || now < this.interactionPixelRatioDeadline) return;
    this.interactivePixelRatioActive = false;
    this.resetFrameBudget();
    if (this.renderer.shadowMap.enabled && this.frameBudgetShadowDeferred) {
      this.frameBudgetShadowDeferred = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.resizeRenderer();
  }

  private computePixelRatio(interactive = this.interactivePixelRatioActive): number {
    const qualityScale = this.quality === "low" ? 0.5 : this.quality === "medium" ? 0.75 : 1;
    const mobile = isMobile();
    const mobileScale = mobile ? 0.85 : 1;
    const base = Math.min(MAX_RENDER_PIXEL_RATIO, window.devicePixelRatio * qualityScale * mobileScale * this.renderScale);
    if (!interactive) return base;
    const interactiveCap = mobile ? MOBILE_INTERACTIVE_PIXEL_RATIO_CAP : DESKTOP_INTERACTIVE_PIXEL_RATIO_CAP;
    return Math.min(base, interactiveCap) * this.frameBudgetPixelRatioScale;
  }

  private updateFrameBudget(frameDurationMs: number): void {
    this.lastFrameDurationMs = frameDurationMs;
    if (!this.interactivePixelRatioActive) return;

    if (frameDurationMs >= FRAME_BUDGET_SLOW_MS) {
      this.frameBudgetSlowStreak++;
      this.frameBudgetFastStreak = 0;
    } else if (frameDurationMs <= FRAME_BUDGET_FAST_MS) {
      this.frameBudgetFastStreak++;
      this.frameBudgetSlowStreak = 0;
    } else {
      this.frameBudgetSlowStreak = 0;
      this.frameBudgetFastStreak = 0;
    }

    if (this.frameBudgetSlowStreak >= FRAME_BUDGET_SLOW_STREAK) {
      this.frameBudgetSlowStreak = 0;
      const nextScale = Math.max(
        FRAME_BUDGET_MIN_PIXEL_RATIO_SCALE,
        this.frameBudgetPixelRatioScale * FRAME_BUDGET_PIXEL_RATIO_STEP,
      );
      if (nextScale < this.frameBudgetPixelRatioScale - 0.01) {
        this.frameBudgetPixelRatioScale = nextScale;
        this.frameBudgetObserverStride = Math.min(
          FRAME_BUDGET_MAX_OBSERVER_STRIDE,
          this.frameBudgetObserverStride + 1,
        );
        this.setRenderObserverSettleFrames(Math.max(
          RENDER_OBSERVER_SETTLE_MIN_FRAMES,
          Math.floor(RENDER_OBSERVER_SETTLE_FRAMES / this.frameBudgetObserverStride),
        ));
        this.smoothness.recordAdaptiveScaleChange();
        this.resizeRenderer();
      }
      return;
    }

    if (this.frameBudgetFastStreak >= FRAME_BUDGET_FAST_STREAK && this.frameBudgetPixelRatioScale < 1) {
      this.frameBudgetFastStreak = 0;
      this.frameBudgetPixelRatioScale = Math.min(
        1,
        this.frameBudgetPixelRatioScale * FRAME_BUDGET_PIXEL_RATIO_RECOVERY_STEP,
      );
      this.frameBudgetObserverStride = Math.max(1, this.frameBudgetObserverStride - 1);
      this.setRenderObserverSettleFrames();
      this.smoothness.recordAdaptiveScaleChange();
      this.resizeRenderer();
    }
  }

  private resetFrameBudget(): void {
    const changed = this.frameBudgetPixelRatioScale !== 1 || this.frameBudgetObserverStride !== 1;
    this.frameBudgetPixelRatioScale = 1;
    this.frameBudgetSlowStreak = 0;
    this.frameBudgetFastStreak = 0;
    this.frameBudgetObserverStride = 1;
    this.frameBudgetObserverCursor = 0;
    this.setRenderObserverSettleFrames();
    if (changed) {
      this.markDirty();
    }
  }

  private setRenderObserverSettleFrames(frames = RENDER_OBSERVER_SETTLE_FRAMES): void {
    this.renderObserverSettleFrames = this.renderObservers.size > 0 ? frames : 0;
  }

  private shouldDeferShadowRefresh(): boolean {
    return this.interactivePixelRatioActive
      && this.frameBudgetPixelRatioScale <= FRAME_BUDGET_SHADOW_SCALE;
  }

  private resizeRenderer(): void {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    this.renderer.setPixelRatio(this.computePixelRatio());
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    if (this.camera instanceof OrthographicCamera) {
      this.updateOrthographicFrustum(aspect);
    } else {
      this.camera.aspect = aspect;
    }
    this.camera.updateProjectionMatrix();
    this.refitCameraForAspect(aspect);
    this.markDirty();
  }

  /**
   * Re-derive the *default* framing when the viewport aspect changes materially.
   *
   * A model framed in a wide pane no longer fits after the pane is dragged narrow,
   * because the limiting field of view switches from vertical to horizontal. Only
   * the stored reset pose is recomputed — the live camera is left alone unless it
   * is still sitting on the previous default, so this never fights a user who has
   * orbited or zoomed.
   */
  private refitCameraForAspect(aspect: number, force = false): void {
    const bounds = this.fittedBounds;
    if (!bounds) return;
    // An explicit `camera:` block config is an author's decision, not a fit result.
    if (this.cameraPoseFromConfig) return;
    // Orthographic framing is fully handled by the frustum half-extents.
    if (this.camera instanceof OrthographicCamera) return;
    if (!force && !shouldRefitForAspect(this.fittedAspect, aspect)) return;

    // Tolerance scales with the model so tiny and huge scenes behave the same.
    const poseEpsilon = Math.max(this.initialPosition.distanceTo(this.initialTarget) * 1e-4, 1e-9);
    const cameraWasAtDefault = this.camera.position.distanceTo(this.initialPosition) <= poseEpsilon
      && this.controls.target.distanceTo(this.initialTarget) <= poseEpsilon;

    const fit = createPreviewPerspectiveCameraFit(bounds, {
      aspect,
      fovDegrees: this.getInitialPerspectiveEffectiveFov(),
    });
    this.initialTarget.set(fit.target.x, fit.target.y, fit.target.z);
    this.initialPosition.set(fit.position.x, fit.position.y, fit.position.z);
    this.fittedAspect = aspect;
    if (!this.cameraClipFromConfig) {
      this.initialNear = fit.near;
      this.initialFar = fit.far;
    }

    const fitDistance = this.initialPosition.distanceTo(this.initialTarget);
    this.controls.maxDistance = Math.max(fitDistance * 8, this.controls.minDistance * 10);

    if (cameraWasAtDefault) {
      this.camera.position.copy(this.initialPosition);
      this.controls.target.copy(this.initialTarget);
      this.camera.lookAt(this.controls.target);
      this.camera.near = this.initialNear;
      this.camera.far = this.initialFar;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.notifyCameraZoomChanged();
    }
  }

  private getInitialPerspectiveEffectiveFov(): number {
    const fovRadians = (this.initialFov * Math.PI) / 180;
    const zoom = Math.max(this.initialZoom, Number.EPSILON);
    return (2 * Math.atan(Math.tan(fovRadians / 2) / zoom) * 180) / Math.PI;
  }

  private getCameraZoomRange(): { mode: "distance" | "zoom"; current: number; min: number; max: number } | null {
    if (!this.rootObject) return null;
    if (this.camera instanceof OrthographicCamera) {
      const fallbackMin = Math.max(this.initialZoom * 0.25, 0.05);
      const fallbackMax = Math.max(this.initialZoom * 6, fallbackMin * 2);
      const min = Number.isFinite(this.controls.minZoom) && this.controls.minZoom > 0
        ? this.controls.minZoom
        : fallbackMin;
      const max = Number.isFinite(this.controls.maxZoom) && this.controls.maxZoom > min
        ? this.controls.maxZoom
        : fallbackMax;
      return {
        mode: "zoom",
        current: Math.max(min, Math.min(this.camera.zoom, max)),
        min,
        max,
      };
    }

    const current = this.camera.position.distanceTo(this.controls.target);
    const fallbackMin = Math.max(current * 0.08, 0.00001);
    const min = Number.isFinite(this.controls.minDistance) && this.controls.minDistance > 0
      ? this.controls.minDistance
      : fallbackMin;
    const max = Number.isFinite(this.controls.maxDistance) && this.controls.maxDistance > min
      ? this.controls.maxDistance
      : Math.max(current * 8, min * 10);
    return {
      mode: "distance",
      current: Math.max(min, Math.min(current, max)),
      min,
      max,
    };
  }

  private notifyCameraZoomChanged(): void {
    if (this.cameraZoomObservers.size === 0) return;
    const state = this.getCameraZoomState();
    for (const observer of this.cameraZoomObservers) {
      observer(state);
    }
  }

  private computeOrthographicViewSpan(): number {
    if (!this.rootObject) return 2;
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    // A max-axis span can still clip a box viewed diagonally. The bounding-sphere
    // diameter remains safe while the user orbits and shares the perspective fit's
    // margin, so projection switches preserve comparable breathing room.
    return Math.max(getPreviewBoundsRadius(bounds) * 2 * DEFAULT_VIEWPORT_FIT_MARGIN, 0.001);
  }

  /**
   * Half-extents of the orthographic frustum for a viewport aspect.
   *
   * The view span describes the model's largest dimension, so it maps directly to
   * whichever axis is *less* constrained. On a portrait viewport (aspect < 1) the
   * horizontal half-extent is the tighter one, and deriving width from height would
   * clip the model left and right — so the height is widened instead.
   */
  private updateOrthographicFrustum(aspect: number): void {
    if (!(this.camera instanceof OrthographicCamera)) return;
    this.updateOrthographicFrustumForCamera(this.camera, aspect, false);
  }

  private updateOrthographicFrustumForCamera(
    camera: OrthographicCamera,
    aspect: number,
    updateProjection = true,
  ): void {
    const { halfWidth, halfHeight } = computeOrthographicHalfExtents(
      this.computeOrthographicViewSpan(),
      aspect,
    );
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    if (updateProjection) {
      camera.updateProjectionMatrix();
    }
  }

  private switchCameraMode(mode: "perspective" | "orthographic"): void {
    if (this.cameraMode === mode && (
      (mode === "perspective" && this.camera instanceof PerspectiveCamera) ||
      (mode === "orthographic" && this.camera instanceof OrthographicCamera)
    )) return;

    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const aspect = width / height;

    const oldCamera = this.camera;
    const position = oldCamera.position.clone();
    const target = this.controls.target.clone();
    const zoom = oldCamera.zoom || 1;
    const near = oldCamera.near;
    const far = oldCamera.far;
    // `attachToCam` lights are children of the camera. Swapping the camera without
    // re-parenting them would leave them on the discarded object, silently going dark.
    const cameraChildren = [...oldCamera.children];

    this.scene.remove(oldCamera);

    if (mode === "orthographic") {
      const camera = new OrthographicCamera(-1, 1, 1, -1, near, far);
      camera.position.copy(position);
      camera.zoom = zoom;
      camera.lookAt(target);
      this.updateOrthographicFrustumForCamera(camera, aspect);
      this.camera = camera;
    } else {
      const camera = new PerspectiveCamera(this.initialFov, aspect, near, far);
      camera.position.copy(position);
      camera.zoom = zoom;
      camera.lookAt(target);
      this.camera = camera;
    }

    for (const child of cameraChildren) {
      this.camera.add(child);
    }

    this.scene.add(this.camera);
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
    this.cameraMode = mode;
  }

  private applyCameraConfig(config: CameraConfig): void {
    const requestedMode = config.mode ?? this.cameraMode;
    if (config.mode) {
      this.initialCameraMode = config.mode;
    }
    this.switchCameraMode(requestedMode);

    if (this.camera instanceof PerspectiveCamera && typeof config.fov === "number" && Number.isFinite(config.fov)) {
      this.camera.fov = config.fov;
      this.initialFov = config.fov;
    }
    if (config.position) {
      this.camera.position.set(...config.position);
      this.initialPosition.set(...config.position);
      this.cameraPoseFromConfig = true;
    }
    if (config.lookAt) {
      this.controls.target.set(...config.lookAt);
      this.camera.lookAt(this.controls.target);
      this.initialTarget.set(...config.lookAt);
      this.cameraPoseFromConfig = true;
    }
    if (typeof config.near === "number" && Number.isFinite(config.near)) {
      this.camera.near = config.near;
      this.initialNear = config.near;
      this.cameraClipFromConfig = true;
    }
    if (typeof config.far === "number" && Number.isFinite(config.far)) {
      this.camera.far = config.far;
      this.initialFar = config.far;
      this.cameraClipFromConfig = true;
    }
    if (typeof config.zoom === "number" && Number.isFinite(config.zoom)) {
      this.camera.zoom = config.zoom;
      this.initialZoom = config.zoom;
    }
    if (
      this.camera instanceof PerspectiveCamera
      && !this.cameraPoseFromConfig
      && (config.fov !== undefined || config.zoom !== undefined)
    ) {
      const canvas = this.renderer.domElement;
      const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
      const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
      this.refitCameraForAspect(width / height, true);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.markDirty();
    this.notifyCameraZoomChanged();
  }

  private applyLightConfig(lights: LightConfig[]): void {
    for (const light of this.configLights) {
      this.disposeConfiguredLight(light);
    }
    this.configLights.length = 0;

    const hasConfiguredLights = lights.length > 0;
    for (const light of this.defaultLights) {
      light.visible = !hasConfiguredLights;
    }

    for (const config of lights) {
      const light = this.createConfiguredLight(config);
      if (!light) continue;
      this.configLights.push(light);
      // `attachToCam` lights are already parented to the camera; re-adding them to
      // the scene would detach them and freeze them at the camera's current pose.
      if (!light.parent) {
        this.scene.add(light);
      }
    }
    this.syncShadowFeatures();
    this.updateShadowFraming();
    this.markShadowDirty();
    this.markDirty();
  }

  private applySceneConfig(config: SceneConfig): void {
    this.sceneConfig = { ...this.sceneConfig, ...config };

    if (config.transparent !== undefined || config.background !== undefined) {
      if (this.sceneConfig.transparent) {
        this.scene.background = null;
        this.renderer.setClearColor(DEFAULT_BACKGROUND, 0);
      } else if (this.sceneConfig.background) {
        const background = new Color(this.sceneConfig.background);
        this.scene.background = background;
        this.renderer.setClearColor(background, 1);
      } else {
        this.scene.background = DEFAULT_BACKGROUND;
        this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);
      }
    }

    if (typeof config.autoRotate === "boolean") {
      this.controls.autoRotate = config.autoRotate;
      // OrbitControls only advances auto-rotation from inside `controls.update()`,
      // which the idle branch of the render loop skips. Without this the model sits
      // still until the user interacts, and stops again the moment they let go.
      if (config.autoRotate) {
        this.markDirty();
      }
    }
    if (typeof config.autoRotateSpeed === "number") {
      this.controls.autoRotateSpeed = config.autoRotateSpeed;
    }
    this.syncSceneHelpers();
    this.syncShadowFeatures();
    this.markDirty();
  }

  private installDefaultLighting(): void {
    const ambient = new AmbientLight(0xffffff, 0.96);
    ambient.name = "default-global-ambient";

    const hemi = new HemisphereLight(0xffffff, 0x6d7280, 0.34);
    hemi.name = "default-hemi";

    this.defaultLights.push(ambient, hemi);
    for (const light of this.defaultLights) {
      this.scene.add(light);
    }
  }

  private installGlobalEnvironment(): void {
    this.disposeGlobalEnvironment();
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    room.dispose();
    pmrem.dispose();
  }

  private syncGlobalEnvironmentForQuality(): void {
    if (this.quality === "low") {
      this.cancelGlobalEnvironmentInstall();
      this.disposeGlobalEnvironment();
      this.markDirty();
      return;
    }
    if (this.rootObject && !this.environmentTarget) {
      this.scheduleGlobalEnvironmentInstall();
    }
  }

  private scheduleGlobalEnvironmentInstall(): void {
    if (this.quality === "low" || this.environmentTarget || this.environmentInstallHandle) {
      return;
    }
    this.environmentInstallHandle = window.setTimeout(() => {
      this.environmentInstallHandle = 0;
      if (this.quality === "low" || this.contextLost || !this.rootObject) {
        return;
      }
      this.installGlobalEnvironment();
      this.markDirty();
    }, ENVIRONMENT_INSTALL_DELAY_MS);
  }

  private cancelGlobalEnvironmentInstall(): void {
    if (!this.environmentInstallHandle) {
      return;
    }
    window.clearTimeout(this.environmentInstallHandle);
    this.environmentInstallHandle = 0;
  }

  private disposeGlobalEnvironment(): void {
    this.cancelGlobalEnvironmentInstall();
    this.scene.environment = null;
    this.environmentTarget?.dispose();
    this.environmentTarget = null;
  }

  private createConfiguredLight(config: LightConfig): Light | null {
    const color = config.color ? new Color(config.color) : new Color(0xffffff);
    const intensity = config.intensity ?? 1;

    switch (config.type) {
      case "ambient":
        return new AmbientLight(color, intensity);
      case "hemisphere": {
        const ground = config.groundColor ? new Color(config.groundColor) : new Color(0x444444);
        return new HemisphereLight(color, ground, intensity);
      }
      case "directional": {
        const light = new DirectionalLight(color, intensity);
        const position = config.position ?? [-1, 2, 1];
        const target = config.target ?? [0, 0, 0];
        light.position.set(...position);
        light.target.position.set(...target);
        this.scene.add(light.target);
        light.castShadow = !!config.castShadow;
        return light;
      }
      case "point": {
        const light = new PointLight(color, intensity);
        const position = config.position ?? [0, 5, 0];
        light.position.set(...position);
        light.castShadow = !!config.castShadow;
        if (typeof config.decay === "number") {
          light.decay = config.decay;
        }
        return light;
      }
      case "spot": {
        const light = new SpotLight(color, intensity);
        const position = config.position ?? [0, 5, 0];
        const target = config.target ?? [0, 0, 0];
        light.position.set(...position);
        light.target.position.set(...target);
        this.scene.add(light.target);
        light.angle = config.angle ? (config.angle * Math.PI) / 180 : Math.PI / 4;
        light.penumbra = config.penumbra ?? 0.5;
        if (typeof config.decay === "number") {
          light.decay = config.decay;
        }
        light.castShadow = !!config.castShadow;
        return light;
      }
      case "attachToCam": {
        const light = new PointLight(color, intensity);
        this.camera.add(light);
        return light;
      }
      default:
        return null;
    }
  }

  private disposeConfiguredLight(light: Light): void {
    if (light instanceof DirectionalLight || light instanceof SpotLight) {
      light.target.removeFromParent();
    }
    light.removeFromParent();
    light.dispose();
  }

  private prepareModelForQuality(renderables: ThreeRenderableObject[]): void {
    const anisotropy = getThreeTextureAnisotropyBudget(
      this.renderer.capabilities.getMaxAnisotropy(),
      this.quality,
    );
    const preparedMaterials = new Set<string>();
    for (const object of renderables) {
      for (const material of materialList(object.material)) {
        if (preparedMaterials.has(material.uuid)) {
          continue;
        }
        preparedMaterials.add(material.uuid);
        this.prepareMaterialForQuality(material, anisotropy);
      }
    }
  }

  private prepareMaterialForQuality(material: Material, anisotropy: number): void {
    addTextureAudit(this.textureAudit, prepareThreeMaterialForColorAccuracy(material, anisotropy));
  }

  private applyShadowQuality(): void {
    const size = this.shadowMapSize();
    let updated = false;
    for (const light of this.allLights()) {
      if (!isShadowCastingLight(light) || !light.castShadow) continue;
      light.shadow.mapSize.set(size, size);
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.018;
      light.shadow.needsUpdate = true;
      updated = true;
    }
    if (!updated) return;
    this.syncShadowFeatures();
    this.markShadowDirty();
    this.markDirty();
  }

  private updateShadowFraming(bounds = this.getRootPreviewBounds()): void {
    if (!this.rootObject || !bounds) return;
    const center = getPreviewBoundsCenter(bounds);
    const size = getPreviewBoundsSize(bounds);
    const span = Math.max(size.x, size.y, size.z, Number.EPSILON);
    const radius = Math.max(span * 1.8, 0.001);
    const centerVector = new Vector3(center.x, center.y, center.z);
    let updated = false;

    for (const light of this.allLights()) {
      if (!isShadowCastingLight(light) || !light.castShadow) continue;
      this.ensureMeshShadowFlags();
      light.shadow.mapSize.set(this.shadowMapSize(), this.shadowMapSize());
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.018;

      if (light instanceof DirectionalLight) {
        const direction = light.position.clone().sub(light.target.position);
        if (direction.lengthSq() < 0.001) {
          direction.set(4, 7, 5);
        }
        light.target.position.copy(centerVector);
        if (!light.target.parent) {
          this.scene.add(light.target);
        }
        light.position.copy(centerVector).add(direction.normalize().multiplyScalar(radius * 2.4));

        if (light.shadow.camera instanceof OrthographicCamera) {
          const camera = light.shadow.camera;
          camera.left = -radius;
          camera.right = radius;
          camera.top = radius;
          camera.bottom = -radius;
          camera.near = 0.1;
          camera.far = radius * 5;
          camera.updateProjectionMatrix();
        }
      }
      light.shadow.needsUpdate = true;
      updated = true;
    }
    if (!updated) return;
    this.markShadowDirty();
  }

  private shadowMapSize(): number {
    if (this.quality === "low") return 512;
    if (this.quality === "medium") return 1024;
    return 2048;
  }

  private allLights(): Light[] {
    return [...this.defaultLights, ...this.configLights];
  }

  private hasActiveShadowFeatures(): boolean {
    return !!this.sceneConfig.groundShadow
      || this.allLights().some((light) => isShadowCastingLight(light) && light.castShadow);
  }

  private syncShadowFeatures(): void {
    const enabled = this.hasActiveShadowFeatures();
    if (this.renderer.shadowMap.enabled !== enabled) {
      this.renderer.shadowMap.enabled = enabled;
    }
    if (!enabled) {
      this.frameBudgetShadowDeferred = false;
      this.renderer.shadowMap.needsUpdate = false;
      return;
    }
    this.ensureMeshShadowFlags();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private ensureMeshShadowFlags(): void {
    if (!this.rootObject || this.meshShadowFlagsPrepared) return;
    for (const object of this.getRenderableObjects(this.rootObject)) {
      if (!isMesh(object)) continue;
      object.castShadow = true;
      object.receiveShadow = true;
    }
    this.meshShadowFlagsPrepared = true;
  }

  private syncSceneHelpers(): void {
    if (this.sceneConfig.groundShadow) {
      this.createGroundShadow();
    } else {
      this.removeGroundShadow();
    }

    if (this.sceneConfig.grid) {
      this.createGrid();
    } else {
      this.removeGrid();
    }

    // Unconditional: syncAxisHelper resolves the config flag together with the
    // gizmo toggle, so an absent `axis` still needs the gizmo state applied.
    this.syncAxisHelper();
  }

  private syncAxisHelper(): void {
    // The scene `axis` config and the orientation-gizmo toggle are independent
    // inputs sharing one helper. Tracking them separately keeps either from
    // silently clearing the other's request.
    const visible = resolveAxisVisibility({
      gizmoEnabled: this.orientationGizmoEnabled,
      configAxis: this.sceneConfig.axis,
    });
    if (!visible && !this.axesHelper) return;
    const created = !this.axesHelper;
    if (!this.axesHelper) {
      this.axesHelper = new AxesHelper(1.2);
      const mat = this.axesHelper.material as LineBasicMaterial;
      mat.depthTest = false;
      mat.depthWrite = false;
      this.axesHelper.renderOrder = 999;
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = visible;
    this.axesHelper.position.copy(this.controls.target);
    if (created) {
      // The helper is built at a fixed 1.2 units, and only fitCameraToObject
      // rescales it. A helper first created after the camera fit — either from
      // `applyConfig` running after `loadModel`, or from the gizmo toggle — would
      // otherwise stay that size and be invisible or huge next to the model.
      this.scaleAxisHelperToModel();
    }
  }

  /** Size the axis helper relative to the loaded model, if there is one. */
  private scaleAxisHelperToModel(rootBounds?: PreviewBounds): void {
    if (!this.axesHelper) return;
    const bounds = rootBounds ?? this.getRootPreviewBounds();
    if (!bounds) return;
    const boundsSize = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(boundsSize.x, boundsSize.y, boundsSize.z, Number.EPSILON);
    this.axesHelper.scale.setScalar(Math.max(maxSpan * 0.25, 0.0005));
  }

  private disposeAxisHelper(): void {
    if (!this.axesHelper) return;
    this.axesHelper.removeFromParent();
    this.axesHelper.geometry.dispose();
    for (const material of materialList(this.axesHelper.material)) {
      material.dispose();
    }
    this.axesHelper = null;
  }

  private createGroundShadow(): void {
    if (!this.rootObject || this.groundShadowMesh) return;
    this.ensureMeshShadowFlags();
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    const center = getPreviewBoundsCenter(bounds);
    const boundsSize = getPreviewBoundsSize(bounds);
    const span = Math.max(boundsSize.x, boundsSize.z, Number.EPSILON);
    const size = Math.max(span * 3, 0.001);
    const y = bounds.min.y - Math.max(size * 0.002, 0.00001);

    const mesh = new Mesh(
      new PlaneGeometry(size, size),
      new ShadowMaterial({ color: 0x000000, opacity: DEFAULT_SHADOW_OPACITY, transparent: true }),
    );
    mesh.name = "ai3d-ground-shadow";
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, y, center.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this.groundShadowMesh = mesh;
  }

  private removeGroundShadow(): void {
    if (!this.groundShadowMesh) return;
    this.groundShadowMesh.removeFromParent();
    this.groundShadowMesh.geometry.dispose();
    for (const material of materialList(this.groundShadowMesh.material)) {
      material.dispose();
    }
    this.groundShadowMesh = null;
  }

  private createGrid(): void {
    if (!this.rootObject || this.gridHelper) return;
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    const center = getPreviewBoundsCenter(bounds);
    const boundsSize = getPreviewBoundsSize(bounds);
    const span = Math.max(boundsSize.x, boundsSize.z, Number.EPSILON);
    const size = Math.max(span * 2, 0.001);

    const grid = new GridHelper(size, 20, 0x6f7785, 0x343b46);
    grid.name = "ai3d-grid";
    grid.position.set(center.x, bounds.min.y - Math.max(size * 0.003, 0.00001), center.z);
    for (const material of materialList(grid.material)) {
      material.transparent = true;
      material.opacity = 0.42;
    }
    this.scene.add(grid);
    this.gridHelper = grid;
  }

  private removeGrid(): void {
    if (!this.gridHelper) return;
    this.gridHelper.removeFromParent();
    this.gridHelper.geometry.dispose();
    for (const material of materialList(this.gridHelper.material)) {
      material.dispose();
    }
    this.gridHelper = null;
  }

  private dispatchPick(event: PointerEvent): void {
    if (!this.rootObject) return;
    if (this.disassembly?.isEnabled()) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects(this.getRenderableObjects(this.rootObject), false)[0];
    const renderable = isThreeRenderableObject(hit?.object) ? hit.object : null;
    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    const childMeshMap = this.getChildRenderableMeshMap(this.rootObject);
    const selectable = renderable
      ? findThreeSelectablePartObject(this.rootObject, renderable, renderableMeshes, childMeshMap)
      : null;
    const result: PreviewPickResult = {
      mesh: selectable,
      pickedPoint: hit?.point?.clone() ?? null,
      screenX: event.clientX,
      screenY: event.clientY,
      modifiers: {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
    };
    this._lastPickResult = result;

    if (this.measurementActive) {
      if (event.altKey) {
        if (!hit?.point) return;
        this.setMeasurementSnapKind("free");
        this.addMeasurementPoint(hit.point.clone());
        return;
      }
      if (!this.measurementTargetObject) {
        if (selectable) {
          this.setMeasurementTargetObject(selectable);
        }
        return;
      }
      const targetPoint = this.getMeasurementTargetRaycastPoint(hit);
      if (!targetPoint) {
        this.setMeasurementSnapKind(null);
        return;
      }
      this.addMeasurementPoint(this.resolveMeasurementPickPoint(targetPoint, false));
      return;
    }

    if (this.focusSelectionEnabled && selectable) {
      this.clearSelectionHighlight();
      if (this.focusedObject !== selectable) {
        this.setFocusedObject(selectable);
      }
    } else if (this.focusSelectionEnabled) {
      this.clearSelectionHighlight();
    } else {
      this.updateSelectionHighlight(selectable);
    }
    this._onPickCallbacks.forEach((callback) => callback(result));
  }

  private clearLoadedModel(reason: DisposalReason = "model-switch"): void {
    this.cancelGlobalEnvironmentInstall();
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.explodeStateActive = false;
    this.meshShadowFlagsPrepared = false;
    this.fittedBounds = null;
    this.fittedAspect = 0;
    this.cameraPoseFromConfig = false;
    this.cameraClipFromConfig = false;
    this.invalidateMeshCache();
    this.markDirty();
    this.clearFocusedMesh();
    this.renderer.domElement.classList.remove("ai3d-slice-active", "ai3d-slice-dragging", "ai3d-slice-rotate");
    this.restoreSliceMaterialClipping();
    this.restoreSliceLocalClippingEnabled();
    this.disposeSliceOverlay(false);
    this.clearSelectionHighlight();
    this.disposeMeasurementOverlays(true);
    this.resetMeasurementCalibrationState();
    this.wireframeEnabled = false;
    // Must run before disposeObjectGraph: that walk only reaches materials still
    // attached to meshes, so wireframe clones would otherwise strand the originals.
    this.restoreWireframeMaterials();
    this.stlMaterial = null;
    this.notifyCameraZoomChanged();
    this.disposeBoxHelper(this.bboxHelper);
    this.bboxHelper = null;
    this.bboxEnabled = false;
    this.removeGroundShadow();
    this.removeGrid();
    this.mixer = null;
    this.animationPlaying = false;
    if (!this.rootObject) {
      this.lastDisposalAudit = {
        reason,
        meshCount: 0,
        geometryCount: 0,
        materialCount: 0,
        textureCount: 0,
        objectCount: 0,
        timestamp: performance.now(),
      };
      return;
    }

    this.scene.remove(this.rootObject);
    this.lastDisposalAudit = this.disposeObjectGraph(this.rootObject, reason);
    this.rootObject = null;
    this.invalidateMeshCache();
    this.markShadowDirty();
  }

  private disposeObjectGraph(root: Object3D, reason: DisposalReason): ThreeDisposalAudit {
    const geometryIds = new Set<string>();
    const materialIds = new Set<string>();
    const textureIds = new Set<string>();
    let meshCount = 0;
    let objectCount = 0;

    const disposeRenderable = (object: ThreeRenderableObject): void => {
      if (isMesh(object)) {
        meshCount++;
      }

      const geometry = object.geometry;
      if (geometry && !geometryIds.has(geometry.uuid)) {
        geometry.dispose();
        geometryIds.add(geometry.uuid);
      }

      for (const material of materialList(object.material)) {
        this.disposeMaterialWithTextures(material, materialIds, textureIds);
      }
    };

    if (this.cachedRenderables && this.cachedRenderableRoot === root) {
      objectCount = this.cachedRenderableObjectCount ?? this.cachedRenderables.length;
      for (const object of this.cachedRenderables) {
        disposeRenderable(object);
      }
    } else {
      root.traverse((object) => {
        objectCount++;
        if (!isThreeRenderableObject(object)) return;
        disposeRenderable(object);
      });
    }

    return {
      reason,
      meshCount,
      geometryCount: geometryIds.size,
      materialCount: materialIds.size,
      textureCount: textureIds.size,
      objectCount,
      timestamp: performance.now(),
    };
  }

  private disposeMaterialWithTextures(
    material: Material,
    materialIds: Set<string>,
    textureIds: Set<string>,
  ): void {
    if (materialIds.has(material.uuid)) {
      return;
    }
    const record = material as unknown as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value instanceof Texture && !textureIds.has(value.uuid)) {
        value.dispose();
        textureIds.add(value.uuid);
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry instanceof Texture && !textureIds.has(entry.uuid)) {
            entry.dispose();
            textureIds.add(entry.uuid);
          }
        }
      }
    }

    material.dispose();
    materialIds.add(material.uuid);
  }

  private fitCameraToObject(root: Object3D, rootBounds?: PreviewBounds): void {
    const bounds = rootBounds ?? this.getRootPreviewBounds(root) ?? getObjectPreviewBounds(root);
    // Fit against the live viewport aspect so a narrow or short pane pulls the
    // camera back instead of clipping the model against the limiting field of view.
    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const fit = createPreviewPerspectiveCameraFit(bounds, {
      aspect: width / height,
      fovDegrees: DEFAULT_CAMERA_FOV,
    });
    this.initialTarget.set(fit.target.x, fit.target.y, fit.target.z);
    this.initialPosition.set(fit.position.x, fit.position.y, fit.position.z);
    this.initialFov = DEFAULT_CAMERA_FOV;
    const boundsSize = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(boundsSize.x, boundsSize.y, boundsSize.z, Number.EPSILON);
    const fitDistance = this.initialPosition.distanceTo(this.initialTarget);
    this.controls.minDistance = Math.max(fit.near * 4, maxSpan * 0.02, 0.00001);
    this.controls.maxDistance = Math.max(fitDistance * 8, this.controls.minDistance * 10);
    this.controls.minZoom = 0.25;
    this.controls.maxZoom = 8;
    this.raycaster.params.Points = { threshold: Math.max(maxSpan * 0.01, 0.00001) };
    this.raycaster.params.Line = { threshold: Math.max(maxSpan * 0.002, 0.00001) };
    this.occlusionRaycaster.params.Points = { threshold: Math.max(maxSpan * 0.006, 0.00001) };
    this.occlusionRaycaster.params.Line = { threshold: Math.max(maxSpan * 0.001, 0.00001) };
    this.fittedBounds = bounds;
    this.fittedAspect = width / height;
    // Set the clip planes before resetView(): it renders a frame synchronously, and
    // with the previous model's near/far still in place that frame can come out
    // clipped. switchCameraMode() carries both across if it swaps the camera.
    this.initialNear = fit.near;
    this.initialFar = fit.far;
    this.camera.near = this.initialNear;
    this.camera.far = this.initialFar;
    this.camera.updateProjectionMatrix();
    this.resetView();
    if (this.axesHelper) {
      this.axesHelper.position.copy(this.controls.target);
      this.scaleAxisHelperToModel(bounds);
    }
    this.markDirty();
    this.notifyCameraZoomChanged();
  }

  private getAnnotationCameraStateKey(): string {
    return formatAnnotationCameraStateKey([
      { value: this.camera.position.x, digits: 3 },
      { value: this.camera.position.y, digits: 3 },
      { value: this.camera.position.z, digits: 3 },
      { value: this.controls.target.x, digits: 2 },
      { value: this.controls.target.y, digits: 2 },
      { value: this.controls.target.z, digits: 2 },
      {
        value: this.camera instanceof PerspectiveCamera ? this.camera.fov : this.camera.zoom,
        digits: this.camera instanceof PerspectiveCamera ? 2 : 3,
      },
    ]);
  }

  private projectAnnotationWorldPoint(point: PreviewWorldPoint, result: PreviewProjectionResult): boolean {
    const canvas = this.renderer.domElement;
    if (!canvas.isConnected || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return false;
    }

    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.annotationProjection.set(point.x, point.y, point.z).project(this.camera);
    return projectNormalizedDevicePointToCanvas(this.annotationProjection, canvas, result);
  }

  private isAnnotationWorldPointOccluded(point: PreviewWorldPoint): boolean {
    if (!this.rootObject) {
      return false;
    }

    const lineOfSight = createPreviewLineOfSight(
      toPreviewWorldPoint(this.camera.position),
      point,
    );
    if (!lineOfSight) {
      return false;
    }

    this.rootObject.updateWorldMatrix(true, true);
    this.annotationDirection.set(
      lineOfSight.direction.x,
      lineOfSight.direction.y,
      lineOfSight.direction.z,
    );
    this.occlusionRaycaster.set(this.camera.position, this.annotationDirection);
    this.occlusionRaycaster.far = lineOfSight.distance;

    const hit = this.occlusionRaycaster.intersectObjects(this.getRenderableObjects(this.rootObject), false)[0];
    return !!hit
      && isPreviewHitOccluded(hit.distance, lineOfSight.distance, lineOfSight.epsilon);
  }

  private getRenderableMeshes(root: Object3D): Mesh[] {
    if (this.cachedMeshes && this.cachedMeshRoot === root) return this.cachedMeshes;
    const meshes: Mesh[] = [];
    root.traverse((object) => {
      if (isMesh(object) && object.geometry) {
        meshes.push(object);
      }
    });
    this.cachedMeshes = meshes;
    this.cachedMeshRoot = root;
    return meshes;
  }

  private getRenderableObjects(root: Object3D): ThreeRenderableObject[] {
    if (this.cachedRenderables && this.cachedRenderableRoot === root) return this.cachedRenderables;
    const renderables: ThreeRenderableObject[] = [];
    let objectCount = 0;
    root.traverse((object) => {
      objectCount++;
      if (isThreeRenderableObject(object) && object.geometry) {
        renderables.push(object);
      }
    });
    this.cachedRenderables = renderables;
    this.cachedRenderableRoot = root;
    this.cachedRenderableObjectCount = objectCount;
    return renderables;
  }

  private getChildRenderableMeshMap(root: Object3D): ThreeChildRenderableMeshMap {
    if (this.cachedChildMeshMap && this.cachedChildMeshMapRoot === root) return this.cachedChildMeshMap;
    this.cachedChildMeshMap = createThreeChildRenderableMeshMap(root, this.getRenderableMeshes(root));
    this.cachedChildMeshMapRoot = root;
    return this.cachedChildMeshMap;
  }

  private getRenderableBoundsMap(root: Object3D): ThreeRenderableBoundsMap {
    if (this.cachedRenderableBoundsMap && this.cachedRenderableBoundsMapRoot === root) {
      return this.cachedRenderableBoundsMap;
    }
    this.cachedRenderableBoundsMap = createThreeRenderableBoundsMap(this.getRenderableObjects(root));
    this.cachedRenderableBoundsMapRoot = root;
    return this.cachedRenderableBoundsMap;
  }

  private getGeometryQualityStats(): PreviewQualitySnapshot["geometry"] {
    if (!this.rootObject) {
      return {
        meshCount: 0,
        pointCloudCount: 0,
        smallPartCount: 0,
        smallestPartSpan: null,
        modelSpan: null,
      };
    }

    if (!this.cachedGeometryQualityStats) {
      this.cachedGeometryQualityStats = createThreeGeometryQualityStats(
        this.rootObject,
        this.getRenderableObjects(this.rootObject),
        this.getRootPreviewBounds() ?? undefined,
        this.getRenderableBoundsMap(this.rootObject),
      );
    }
    return this.cachedGeometryQualityStats;
  }

  private invalidateMeshCache(): void {
    this.cachedMeshes = null;
    this.cachedMeshRoot = null;
    this.cachedRenderables = null;
    this.cachedRenderableRoot = null;
    this.cachedRenderableObjectCount = null;
    this.cachedChildMeshMap = null;
    this.cachedChildMeshMapRoot = null;
    this.cachedRenderableBoundsMap = null;
    this.cachedRenderableBoundsMapRoot = null;
    this.invalidateRootBoundsCache();
  }

  private invalidateRootBoundsCache(): void {
    this.cachedRootPreviewBounds = null;
    this.cachedRootPreviewBoundsObject = null;
    this.cachedRenderableBoundsMap = null;
    this.cachedRenderableBoundsMapRoot = null;
    this.cachedGeometryQualityStats = null;
  }

  private getRootPreviewBounds(root: Object3D | null = this.rootObject): PreviewBounds | null {
    if (!root) return null;
    if (this.cachedRootPreviewBounds && this.cachedRootPreviewBoundsObject === root) {
      return this.cachedRootPreviewBounds;
    }
    this.cachedRootPreviewBounds = getObjectPreviewBounds(root);
    this.cachedRootPreviewBoundsObject = root;
    return this.cachedRootPreviewBounds;
  }

  private getSliceRange(): SliceRange | null {
    const range = createSliceRange(this.getRootPreviewBounds(), {
      normal: toPreviewWorldPoint(this.sliceNormal),
      offset: this.sliceOffset,
    });
    if (!range || !this.sliceCenter) return range;
    const distance = this.sliceCenter.dot(this.sliceNormal);
    const offset = normalizeSliceOffset((distance - range.min) / range.span);
    this.sliceOffset = offset;
    return {
      ...range,
      offset,
      distance,
      point: toPreviewWorldPoint(this.sliceCenter),
    };
  }

  private setSliceCenterFromOffset(offset: number): void {
    const range = createSliceRange(this.getRootPreviewBounds(), {
      normal: toPreviewWorldPoint(this.sliceNormal),
      offset,
    });
    if (range) this.sliceCenter = new Vector3(range.point.x, range.point.y, range.point.z);
  }

  private alignSlicePlaneToWorld(): void {
    this.sliceNormal.set(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
    this.rebuildSlicePlaneAxes(new Vector3(1, 0, 0));
    this.sliceReferenceNormal.copy(this.sliceNormal);
    this.sliceCenter = null;
    this.setSliceCenterFromOffset(this.sliceOffset);
  }

  private rebuildSlicePlaneAxes(preferredX = this.slicePlaneX): void {
    const normal = this.sliceNormal.clone().normalize();
    const x = preferredX.clone().addScaledVector(normal, -preferredX.dot(normal));
    if (x.lengthSq() <= 0.000001) {
      x.copy(Math.abs(normal.y) < 0.92 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
      x.addScaledVector(normal, -x.dot(normal));
    }
    x.normalize();
    this.slicePlaneX.copy(x);
    this.slicePlaneY.crossVectors(normal, x).normalize();
  }

  private deactivateSliceMode(): boolean {
    if (!this.sliceActive && !this.sliceDragState) return false;
    this.endSliceDrag(null, true);
    this.sliceActive = false;
    this.syncSliceClipping();
    this.notifySliceChanged();
    return true;
  }

  private beginSliceDrag(event: PointerEvent): boolean {
    if (!this.rootObject || !this.sliceActive) return false;
    const target = this.getSlicePointerTarget(event);
    if (!target) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mode = target.mode;
    this.sliceInteractionMode = mode;
    const commonState: ThreeSliceDragStateBase = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      mode,
      moved: false,
    };
    if (mode === "rotate") {
      const range = this.getSliceRange();
      if (!range) return false;
      const pointerPolar = this.getSlicePointerPolar(event, target.axis);
      if (!pointerPolar) return false;
      this.sliceDragState = {
        ...commonState,
        mode,
        axis: target.axis,
        startNormal: toPreviewWorldPoint(this.sliceNormal),
        anchorPoint: { ...range.point },
        rotationAxis: toPreviewWorldPoint(
          target.axis === "x" ? this.slicePlaneX : target.axis === "y" ? this.slicePlaneY : this.sliceNormal,
        ),
        startPlaneX: toPreviewWorldPoint(this.slicePlaneX),
        startPlaneY: toPreviewWorldPoint(this.slicePlaneY),
        screenTangent: target.screenTangent,
        radiansPerPixel: target.radiansPerPixel,
        rotationRadians: 0,
        startPointerAngle: pointerPolar.angle,
        currentPointerAngle: pointerPolar.angle,
        snapMode: resolveSliceRotationSnapMode(pointerPolar.radiusRatio),
        useScreenRotation: shouldUseSliceScreenRotation(pointerPolar.rayPlaneAlignment),
        labelPoint: target.labelPoint,
      };
    } else {
      this.sliceDragState = {
        ...commonState,
        mode,
        startOffset: this.sliceOffset,
        screenAxis: this.getSliceScreenAxis(),
        pixelsToOffset: 1 / Math.max(Math.min(rect.width, rect.height) * 0.72, 1),
      };
    }
    this.syncSliceClipping();
    this.lastPointerDown = null;
    this.controls.enabled = false;
    this.renderer.domElement.classList.add("ai3d-slice-dragging");
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // Programmatic or canceled touch sequences may not have a capturable pointer.
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.prepareInteractiveFrameBudget();
    this.notifySliceChanged();
    return true;
  }

  private getSlicePointerPolar(
    event: PointerEvent,
    axis: PreviewAxis,
    frozenAxes?: { x: PreviewWorldPoint; y: PreviewWorldPoint; z: PreviewWorldPoint },
    frozenCenter?: PreviewWorldPoint,
  ): { angle: number; radiusRatio: number; rayPlaneAlignment: number } | null {
    const range = this.getSliceRange();
    const bounds = this.getRootPreviewBounds();
    if (!range || !bounds) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const centerPoint = frozenCenter ?? range.point;
    const center = new Vector3(centerPoint.x, centerPoint.y, centerPoint.z);
    const axes = frozenAxes
      ? {
        x: new Vector3(frozenAxes.x.x, frozenAxes.x.y, frozenAxes.x.z),
        y: new Vector3(frozenAxes.y.x, frozenAxes.y.y, frozenAxes.y.z),
        z: new Vector3(frozenAxes.z.x, frozenAxes.z.y, frozenAxes.z.z),
      }
      : { x: this.slicePlaneX, y: this.slicePlaneY, z: this.sliceNormal };
    const axisVector = (axis === "x" ? axes.x : axis === "y" ? axes.y : axes.z).clone().normalize();
    const first = (axis === "x" ? axes.y : axis === "y" ? axes.z : axes.x).clone().normalize();
    const second = (axis === "x" ? axes.z : axis === "y" ? axes.x : axes.y).clone().normalize();
    const plane = new ThreePlane(axisVector, -axisVector.dot(center));
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return null;
    const local = hit.sub(center);
    const radius = Math.max(getPreviewBoundsRadius(bounds) * 0.62, range.span * 0.16, Number.EPSILON);
    return {
      angle: Math.atan2(local.dot(second), local.dot(first)),
      radiusRatio: local.length() / radius,
      rayPlaneAlignment: Math.abs(this.raycaster.ray.direction.dot(axisVector)),
    };
  }

  private getSlicePointerTarget(event: PointerEvent): ThreeSlicePointerTarget | null {
    if (event.altKey) return null;
    const bounds = this.getRootPreviewBounds();
    const range = this.getSliceRange();
    if (!bounds || !range) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const project = (point: PreviewWorldPoint) => {
      const projected = new Vector3(point.x, point.y, point.z).project(this.camera);
      return {
        x: rect.left + (projected.x + 1) * rect.width * 0.5,
        y: rect.top + (1 - projected.y) * rect.height * 0.5,
      };
    };
    const pointer = { x: event.clientX, y: event.clientY };
    const threshold = event.pointerType === "touch" ? 28 : 14;
    const center = project(range.point);
    if (Math.hypot(pointer.x - center.x, pointer.y - center.y) <= threshold * 1.35) return { mode: "move" };

    const gizmo = createSliceGizmoGeometry(bounds, range, 64, {
      x: toPreviewWorldPoint(this.slicePlaneX),
      y: toPreviewWorldPoint(this.slicePlaneY),
      z: toPreviewWorldPoint(this.sliceNormal),
    });
    if (gizmo.moveGuide.some(([start, end]) => {
      const screenStart = project(start);
      const screenEnd = project(end);
      return distanceToScreenSegment(pointer, screenStart, screenEnd) <= threshold;
    })) return { mode: "move" };

    let best: ThreeSlicePointerTarget & { mode: "rotate" } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const axis of ["x", "y", "z"] as const) {
      const projectedSegments = gizmo.rotationRings[axis].map(([start, end]) => [project(start), project(end)] as const);
      const circumference = projectedSegments.reduce(
        (total, [start, end]) => total + Math.hypot(end.x - start.x, end.y - start.y),
        0,
      );
      for (const [start, end] of projectedSegments) {
        const distance = distanceToScreenSegment(pointer, start, end);
        if (distance > threshold || distance >= bestDistance) continue;
        const tangent = new Vector2(end.x - start.x, end.y - start.y);
        if (tangent.lengthSq() <= Number.EPSILON) continue;
        bestDistance = distance;
        best = {
          mode: "rotate",
          axis,
          screenTangent: tangent.normalize(),
          radiansPerPixel: (Math.PI * 2) / Math.max(circumference, 80),
          labelPoint: { ...range.point },
        };
      }
    }
    return best;
  }

  private updateSliceDrag(event: PointerEvent): boolean {
    const state = this.sliceDragState;
    if (!state || state.pointerId !== event.pointerId) return false;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const moved = Math.hypot(dx, dy) > 2;
    state.moved = state.moved || moved;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.prepareInteractiveFrameBudget();
    if (state.mode === "rotate") {
      const pointerPolar = this.getSlicePointerPolar(event, state.axis, {
        x: state.startPlaneX,
        y: state.startPlaneY,
        z: state.startNormal,
      }, state.anchorPoint);
      if (!pointerPolar) return true;
      const screenDelta = (dx * state.screenTangent.x + dy * state.screenTangent.y) * state.radiansPerPixel;
      const rawDelta = normalizeSliceRotationRadians(state.useScreenRotation
        ? screenDelta
        : pointerPolar.angle - state.startPointerAngle);
      if (!state.useScreenRotation) {
        state.snapMode = resolveSliceRotationSnapMode(pointerPolar.radiusRatio, state.snapMode);
      }
      state.rotationRadians = snapSliceRotationRadiansForMode(rawDelta, state.snapMode);
      state.currentPointerAngle = state.startPointerAngle + state.rotationRadians;
      const nextNormal = rotateSliceNormalAroundAxis(
        state.startNormal,
        state.rotationAxis,
        state.rotationRadians,
      );
      const nextPlaneX = rotateSliceNormalAroundAxis(state.startPlaneX, state.rotationAxis, state.rotationRadians);
      const nextPlaneY = rotateSliceNormalAroundAxis(state.startPlaneY, state.rotationAxis, state.rotationRadians);
      const normalDelta = this.sliceNormal.distanceToSquared(this.sliceDragScratch[0].set(nextNormal.x, nextNormal.y, nextNormal.z));
      const planeAxesDelta = this.slicePlaneX.distanceToSquared(this.sliceDragScratch[1].set(nextPlaneX.x, nextPlaneX.y, nextPlaneX.z))
        + this.slicePlaneY.distanceToSquared(this.sliceDragScratch[2].set(nextPlaneY.x, nextPlaneY.y, nextPlaneY.z));
      if (normalDelta <= 0.000001 && planeAxesDelta <= 0.000001) return true;
      if (normalDelta > 0.000001) {
        const bounds = this.getRootPreviewBounds();
        this.sliceNormal.set(nextNormal.x, nextNormal.y, nextNormal.z);
        this.sliceCenter = new Vector3(state.anchorPoint.x, state.anchorPoint.y, state.anchorPoint.z);
        this.sliceOffset = createSliceOffsetForPoint(bounds, nextNormal, state.anchorPoint);
      }
      this.slicePlaneX.set(nextPlaneX.x, nextPlaneX.y, nextPlaneX.z);
      this.slicePlaneY.set(nextPlaneY.x, nextPlaneY.y, nextPlaneY.z);
      this.syncSliceClipping();
      this.notifySliceChanged();
      return true;
    }
    const delta = dx * state.screenAxis.x + dy * state.screenAxis.y;
    const nextOffset = normalizeSliceOffset(state.startOffset + delta * state.pixelsToOffset);
    if (Math.abs(nextOffset - this.sliceOffset) <= 0.0005) return true;
    this.sliceOffset = nextOffset;
    this.setSliceCenterFromOffset(nextOffset);
    this.syncSliceClipping();
    this.notifySliceChanged();
    return true;
  }

  private endSliceDrag(event: PointerEvent | null, cancelled = false): boolean {
    const state = this.sliceDragState;
    if (!state) return false;
    if (event && state.pointerId !== event.pointerId) return false;
    this.sliceDragState = null;
    this.controls.enabled = true;
    this.renderer.domElement.classList.remove("ai3d-slice-dragging");
    this.syncSliceClipping();
    if (event) {
      try {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be gone after canceled touch/pointer sequences.
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (!cancelled || state.moved) {
      this.notifySliceChanged();
    }
    this.markDirty();
    return true;
  }

  private getSliceScreenAxis(): Vector2 {
    const range = this.getSliceRange();
    const bounds = this.getRootPreviewBounds();
    if (!range || !bounds) return new Vector2(0, -1);
    const radius = Math.max(getPreviewBoundsRadius(bounds), range.span * 0.25, Number.EPSILON);
    const center = new Vector3(range.point.x, range.point.y, range.point.z);
    const normal = new Vector3(range.normal.x, range.normal.y, range.normal.z).normalize();
    const projectedCenter = center.clone().project(this.camera);
    const projectedNormal = center.clone().add(normal.multiplyScalar(radius * 0.35)).project(this.camera);
    const axis = new Vector2(
      projectedNormal.x - projectedCenter.x,
      -(projectedNormal.y - projectedCenter.y),
    );
    if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() <= 0.000001) {
      return new Vector2(0, -1);
    }
    return axis.normalize();
  }

  private updateThreeSlicePlanes(range: SliceRange | null): boolean {
    const planes = createSliceClipPlanes(range, "three");
    if (!planes?.length) return false;
    const source = planes[0];
    if (this.slicePlanes.length === 1) {
      this.slicePlanes[0].normal.set(source.normal.x, source.normal.y, source.normal.z);
      this.slicePlanes[0].constant = source.constant;
    } else {
      this.slicePlanes = [new ThreePlane(
        new Vector3(source.normal.x, source.normal.y, source.normal.z),
        source.constant,
      )];
    }
    return true;
  }

  private syncSliceClipping(): void {
    this.renderer.domElement.classList.toggle("ai3d-slice-active", this.sliceActive);
    this.renderer.domElement.classList.toggle("ai3d-slice-rotate", this.sliceActive && this.sliceInteractionMode === "rotate");
    if (!this.rootObject || !this.sliceActive) {
      this.restoreSliceMaterialClipping();
      this.disposeSliceOverlay();
      this.slicePlanes = [];
      this.restoreSliceLocalClippingEnabled();
      this.renderer.domElement.classList.remove("ai3d-slice-dragging");
      this.renderer.domElement.classList.remove("ai3d-slice-rotate");
      this.markDirty();
      return;
    }

    const range = this.getSliceRange();
    if (!this.updateThreeSlicePlanes(range)) {
      this.restoreSliceMaterialClipping();
      this.disposeSliceOverlay();
      this.restoreSliceLocalClippingEnabled();
      this.markDirty();
      return;
    }

    this.syncSliceOverlay(range);
    if (this.sliceOriginalLocalClippingEnabled === null) {
      this.sliceOriginalLocalClippingEnabled = this.renderer.localClippingEnabled;
    }
    this.renderer.localClippingEnabled = true;
    const activeMaterialIds = new Set<string>();
    for (const mesh of this.getRenderableMeshes(this.rootObject)) {
      for (const material of materialList(mesh.material)) {
        activeMaterialIds.add(material.uuid);
        const firstBinding = !this.sliceOriginalMaterialClipping.has(material.uuid);
        if (firstBinding) {
          this.sliceOriginalMaterialClipping.set(material.uuid, {
            material,
            clippingPlanes: material.clippingPlanes,
            clipIntersection: material.clipIntersection,
            clipShadows: material.clipShadows,
          });
        }
        if (firstBinding || material.clippingPlanes !== this.slicePlanes) {
          material.clippingPlanes = this.slicePlanes;
          material.clipIntersection = false;
          material.clipShadows = true;
          material.needsUpdate = true;
        }
      }
    }

    for (const [id, snapshot] of Array.from(this.sliceOriginalMaterialClipping.entries())) {
      if (!activeMaterialIds.has(id)) {
        snapshot.material.clippingPlanes = snapshot.clippingPlanes;
        snapshot.material.clipIntersection = snapshot.clipIntersection;
        snapshot.material.clipShadows = snapshot.clipShadows;
        snapshot.material.needsUpdate = true;
        this.sliceOriginalMaterialClipping.delete(id);
      }
    }
    this.markDirty();
  }

  private restoreSliceMaterialClipping(): void {
    for (const snapshot of this.sliceOriginalMaterialClipping.values()) {
      snapshot.material.clippingPlanes = snapshot.clippingPlanes;
      snapshot.material.clipIntersection = snapshot.clipIntersection;
      snapshot.material.clipShadows = snapshot.clipShadows;
      snapshot.material.needsUpdate = true;
    }
    this.sliceOriginalMaterialClipping.clear();
  }

  private restoreSliceLocalClippingEnabled(): void {
    if (this.sliceOriginalLocalClippingEnabled === null) return;
    this.renderer.localClippingEnabled = this.sliceOriginalLocalClippingEnabled;
    this.sliceOriginalLocalClippingEnabled = null;
  }

  private syncSliceOverlay(range: SliceRange | null): void {
    this.disposeSliceOverlay(false);
    const bounds = this.getRootPreviewBounds();
    if (!bounds || !range) return;

    const sliceAxes = {
      x: toPreviewWorldPoint(this.slicePlaneX),
      y: toPreviewWorldPoint(this.slicePlaneY),
      z: toPreviewWorldPoint(this.sliceNormal),
    };
    const planeGeometry = createSlicePlaneGeometry(bounds, range, 0.12, sliceAxes);
    const plane = this.createSliceOverlayPlane(planeGeometry);
    const frameColor = this.sliceInteractionMode === "rotate" ? SLICE_ROTATE_FRAME_COLOR : SLICE_FRAME_COLOR;
    const frame = this.createSliceOverlayLines(planeGeometry.segments, frameColor, SLICE_FRAME_OPACITY);
    const normalGuide = this.createSliceOverlayLines(this.createSliceNormalGuide(bounds, range), SLICE_CENTER_FRAME_COLOR, 0.92);
    const rotationAngles = this.sliceDragState?.mode === "rotate"
      ? { [this.sliceDragState.axis]: this.sliceDragState.currentPointerAngle }
      : undefined;
    const gizmoAxes = this.sliceDragState?.mode === "rotate"
      ? { x: this.sliceDragState.startPlaneX, y: this.sliceDragState.startPlaneY, z: this.sliceDragState.startNormal }
      : sliceAxes;
    const gizmo = createSliceGizmoGeometry(bounds, range, 64, gizmoAxes, rotationAngles);
    const activeAxis = this.sliceDragState?.mode === "rotate" ? this.sliceDragState.axis : null;
    const moveActive = this.sliceDragState?.mode === "move";
    const ringStyle = (axis: PreviewAxis, color: number) => ({
      color: activeAxis === axis ? SLICE_GIZMO_ACTIVE_COLOR : color,
      opacity: activeAxis ? (activeAxis === axis ? 0.98 : 0) : moveActive ? 0.1 : 0.34,
      tickOpacity: activeAxis ? (activeAxis === axis ? 0.82 : 0) : moveActive ? 0.04 : 0.14,
    });
    const styleX = ringStyle("x", SLICE_GIZMO_X_COLOR);
    const styleY = ringStyle("y", SLICE_GIZMO_Y_COLOR);
    const styleZ = ringStyle("z", SLICE_GIZMO_Z_COLOR);
    const ringX = this.createSliceOverlayLines(gizmo.rotationRings.x, styleX.color, styleX.opacity);
    const ringY = this.createSliceOverlayLines(gizmo.rotationRings.y, styleY.color, styleY.opacity);
    const ringZ = this.createSliceOverlayLines(gizmo.rotationRings.z, styleZ.color, styleZ.opacity);
    const ticksX = this.createSliceOverlayLines(gizmo.rotationTicks.x, styleX.color, styleX.tickOpacity);
    const ticksY = this.createSliceOverlayLines(gizmo.rotationTicks.y, styleY.color, styleY.tickOpacity);
    const ticksZ = this.createSliceOverlayLines(gizmo.rotationTicks.z, styleZ.color, styleZ.tickOpacity);
    const moveGuide = this.createSliceOverlayLines(gizmo.moveGuide, SLICE_MOVE_COLOR, activeAxis ? 0.22 : 0.96);
    const activeArc = activeAxis
      ? this.createSliceOverlayLines(gizmo.rotationArcs[activeAxis], activeAxis === "x"
        ? SLICE_GIZMO_X_COLOR
        : activeAxis === "y" ? SLICE_GIZMO_Y_COLOR : SLICE_GIZMO_Z_COLOR, 1)
      : null;
    const activeArrowheads = activeAxis
      ? this.createSliceOverlayLines(gizmo.rotationArrowheads[activeAxis], activeAxis === "x"
        ? SLICE_GIZMO_X_COLOR
        : activeAxis === "y" ? SLICE_GIZMO_Y_COLOR : SLICE_GIZMO_Z_COLOR, 1)
      : null;
    this.sliceOverlayPlanes.push(plane);
    this.sliceOverlayLines.push(frame, normalGuide, ringX, ringY, ringZ, ticksX, ticksY, ticksZ, moveGuide);
    this.scene.add(plane, frame, normalGuide, ringX, ringY, ringZ, ticksX, ticksY, ticksZ, moveGuide);
    if (activeAxis && activeArc && activeArrowheads) {
      this.sliceOverlayLines.push(activeArc, activeArrowheads);
      this.scene.add(activeArc, activeArrowheads);
      const drag = this.sliceDragState;
      if (drag?.mode === "rotate") {
        const degrees = ((drag.currentPointerAngle * 180 / Math.PI) % 360 + 360) % 360;
        const arc = gizmo.rotationArcs[activeAxis];
        const labelPoint = arc[arc.length - 1]?.[1] ?? drag.labelPoint;
        const label = this.createMeasurementLabelSprite(
          { primary: `${activeAxis.toUpperCase()}: ${degrees.toFixed(1)}°`, secondary: "" },
          new Vector3(labelPoint.x, labelPoint.y, labelPoint.z),
          this.getMeasurementMarkerSize() * 2.5,
        );
        this.sliceOverlayLabels.push(label);
        this.scene.add(label);
      }
    }
  }

  private createSliceOverlayPlane(plane: SlicePlaneGeometry): Mesh {
    const geometry = new BufferGeometry();
    const corners = plane.corners;
    geometry.setAttribute("position", new Float32BufferAttribute([
      corners[0].x, corners[0].y, corners[0].z,
      corners[1].x, corners[1].y, corners[1].z,
      corners[2].x, corners[2].y, corners[2].z,
      corners[0].x, corners[0].y, corners[0].z,
      corners[2].x, corners[2].y, corners[2].z,
      corners[3].x, corners[3].y, corners[3].z,
    ], 3));
    geometry.computeVertexNormals();
    const material = new MeshBasicMaterial({
      color: this.sliceInteractionMode === "rotate" ? SLICE_ROTATE_PLANE_COLOR : SLICE_PLANE_COLOR,
      transparent: true,
      opacity: SLICE_PLANE_OPACITY,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = "ai3d-slice-plane";
    mesh.renderOrder = 995;
    return mesh;
  }

  private createSliceOverlayLines(
    segments: Array<[PreviewWorldPoint, PreviewWorldPoint]>,
    color: number,
    opacity: number,
  ): LineSegments {
    const geometry = new BufferGeometry();
    const positions: number[] = [];
    for (const [start, end] of segments) {
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
    });
    const lines = new LineSegments(geometry, material);
    lines.name = "ai3d-slice-frame";
    lines.renderOrder = 996;
    return lines;
  }

  private createSliceNormalGuide(bounds: PreviewBounds, range: SliceRange): Array<[PreviewWorldPoint, PreviewWorldPoint]> {
    const radius = Math.max(getPreviewBoundsRadius(bounds), range.span * 0.25, Number.EPSILON);
    const normal = normalizePreviewWorldPoint(range.normal) ?? DEFAULT_SLICE_NORMAL;
    const start = range.point;
    const end = {
      x: start.x + normal.x * radius * 0.26,
      y: start.y + normal.y * radius * 0.26,
      z: start.z + normal.z * radius * 0.26,
    };
    return [[start, end]];
  }

  private disposeSliceOverlay(markDirty = true): void {
    for (const plane of this.sliceOverlayPlanes) {
      plane.removeFromParent();
      plane.geometry.dispose();
      for (const material of materialList(plane.material)) {
        material.dispose();
      }
    }
    for (const line of this.sliceOverlayLines) {
      line.removeFromParent();
      line.geometry.dispose();
      for (const material of materialList(line.material)) {
        material.dispose();
      }
    }
    for (const label of this.sliceOverlayLabels) {
      label.removeFromParent();
      label.material.map?.dispose();
      label.material.dispose();
    }
    this.sliceOverlayPlanes = [];
    this.sliceOverlayLines = [];
    this.sliceOverlayLabels = [];
    if (markDirty) {
      this.markDirty();
    }
  }

  private notifySliceChanged(): void {
    for (const callback of this.sliceObservers) {
      callback();
    }
  }

  /**
   * Remove and dispose a BoxHelper. `removeFromParent()` alone detaches the
   * LineSegments but leaves its fresh BufferGeometry and LineBasicMaterial
   * allocated, leaking GPU buffers on every selection/focus/bbox change.
   */
  private disposeBoxHelper(helper: BoxHelper | null): void {
    if (!helper) return;
    helper.removeFromParent();
    helper.geometry.dispose();
    helper.material.dispose();
  }

  private ensureBoundingBoxHelper(): void {
    if (!this.rootObject) return;
    this.disposeBoxHelper(this.bboxHelper);
    this.bboxHelper = new BoxHelper(this.rootObject, 0xfacc15);
    this.scene.add(this.bboxHelper);
  }

  private updateSelectionHighlight(object: Object3D | null): void {
    if (!this.rootObject || !object) {
      this.clearSelectionHighlight();
      return;
    }
    if (this.highlightedObject === object && this.selectionHelper) {
      return;
    }

    this.disposeBoxHelper(this.selectionHelper);
    this.selectionHelper = new BoxHelper(object, 0x4a9eff);
    this.scene.add(this.selectionHelper);
    this.highlightedObject = object;
    this.markDirty();
  }

  private setFocusedObject(object: Object3D | null): void {
    if (!this.rootObject || !object) {
      this.clearFocusedMesh();
      return;
    }
    if (this.focusedObject === object) return;

    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    const selectedMeshes = isMesh(object)
      ? [object]
      : this.getChildRenderableMeshMap(this.rootObject).get(object) ?? [];
    if (selectedMeshes.length === 0 && !isThreeRenderableObject(object)) {
      this.clearFocusedMesh();
      return;
    }

    if (this.originalMaterials.size === 0) {
      this.applyInitialFocusMaterials(renderableMeshes, selectedMeshes);
    } else {
      this.applyFocusSelectionDelta(selectedMeshes);
    }

    this.disposeBoxHelper(this.focusHelper);
    this.focusHelper = new BoxHelper(object, 0x2ec4ff);
    this.scene.add(this.focusHelper);
    this.focusedObject = object;
    this.focusedSelectedMeshes.clear();
    for (const mesh of selectedMeshes) {
      this.focusedSelectedMeshes.set(mesh.id, mesh);
    }
    this.syncSliceClipping();
    this.markDirty();
  }

  private clearFocusedMesh(): void {
    this.restoreFocusedMaterials();
    this.disposeFocusDimMaterials();
    this.originalMaterials.clear();
    this.focusedSelectedMeshes.clear();
    this.disposeBoxHelper(this.focusHelper);
    this.focusHelper = null;
    this.focusedObject = null;
    this.syncSliceClipping();
    this.markDirty();
  }

  private restoreFocusedMaterials(): void {
    if (!this.rootObject) return;
    for (const mesh of this.getRenderableMeshes(this.rootObject)) {
      const originalMaterial = this.originalMaterials.get(mesh.id);
      if (originalMaterial) {
        mesh.material = originalMaterial;
      }
    }
  }

  private applyInitialFocusMaterials(renderableMeshes: readonly Mesh[], selectedMeshes: readonly Mesh[]): void {
    const selectedMeshIds = new Set(selectedMeshes.map((mesh) => mesh.id));
    for (const candidate of renderableMeshes) {
      this.originalMaterials.set(candidate.id, candidate.material);
      if (selectedMeshIds.has(candidate.id)) {
        continue;
      }
      candidate.material = this.focusDimMaterialCache.get(candidate.material);
    }
  }

  private applyFocusSelectionDelta(selectedMeshes: readonly Mesh[]): void {
    const selectedMeshIds = new Set(selectedMeshes.map((mesh) => mesh.id));
    for (const [id, mesh] of this.focusedSelectedMeshes) {
      if (selectedMeshIds.has(id)) {
        continue;
      }
      const originalMaterial = this.originalMaterials.get(id) ?? mesh.material;
      if (!this.originalMaterials.has(id)) {
        this.originalMaterials.set(id, originalMaterial);
      }
      mesh.material = this.focusDimMaterialCache.get(originalMaterial);
    }

    for (const mesh of selectedMeshes) {
      const originalMaterial = this.originalMaterials.get(mesh.id) ?? mesh.material;
      if (!this.originalMaterials.has(mesh.id)) {
        this.originalMaterials.set(mesh.id, originalMaterial);
      }
      mesh.material = originalMaterial;
    }
  }

  private disposeFocusDimMaterials(): void {
    this.focusDimMaterialCache.clear();
  }

  private clearSelectionHighlight(): void {
    this.disposeBoxHelper(this.selectionHelper);
    this.selectionHelper = null;
    this.highlightedObject = null;
    this.markDirty();
  }

  private setMeasurementTargetObject(object: Object3D | null, notify = true): void {
    this.clearMeasurementTargetHelper(false);
    this.measurementSnapInputCache.invalidate();
    const target = object && this.isObjectInLoadedRoot(object) ? object : null;
    this.measurementTargetObject = target;
    this.setMeasurementSnapKind(null, false);
    if (target) {
      this.measurementTargetHelper = new BoxHelper(target, 0x60a5fa);
      this.scene.add(this.measurementTargetHelper);
    }
    this.markDirty();
    if (notify) {
      this.notifyMeasurementsChanged();
    }
  }

  private clearMeasurementTargetHelper(markDirty = true): void {
    this.disposeBoxHelper(this.measurementTargetHelper);
    this.measurementTargetHelper = null;
    if (markDirty) {
      this.markDirty();
    }
  }

  private updateMeasurementTargetHelper(): void {
    if (!this.measurementTargetHelper || !this.measurementTargetObject) return;
    this.measurementTargetHelper.update();
  }

  private setMeasurementSnapKind(kind: MeasurementSnapKind | null, notify = true): void {
    this.measurementSession.setSnapKind(kind, notify);
  }

  private updateMeasurementModifierAltKey(altKey: boolean): void {
    if (this.lastPointerClient.altKey === altKey) return;
    this.lastPointerClient = { ...this.lastPointerClient, altKey };
    if (this.measurementActive && this.pendingPoint) {
      this.schedulePreviewLineUpdate();
    }
  }

  private getCurrentMeasurementTargetObject(): Object3D | null {
    if (!this.rootObject) return null;
    if (
      this.focusSelectionEnabled &&
      this.focusedObject &&
      this.isObjectInLoadedRoot(this.focusedObject)
    ) {
      return this.focusedObject;
    }
    return this.rootObject;
  }

  private isObjectInLoadedRoot(object: Object3D): boolean {
    if (!this.rootObject) return false;
    let current: Object3D | null = object;
    while (current) {
      if (current === this.rootObject) return true;
      current = current.parent;
    }
    return false;
  }

  private getMeasurementTargetName(): string | null {
    const target = this.measurementTargetObject;
    if (!target || !this.isObjectInLoadedRoot(target)) return null;
    return getThreeObjectDisplayName(target, target.type || `object-${target.id}`);
  }

  private getMeasurementTargetBounds(): PreviewBounds | null {
    const target = this.measurementTargetObject;
    if (!target || !this.isObjectInLoadedRoot(target)) return null;
    target.updateWorldMatrix(true, true);
    return getObjectPreviewBounds(target);
  }

  private resolveMeasurementPickPoint(point: Vector3, forceFreePick: boolean): Vector3 {
    if (forceFreePick) {
      this.setMeasurementSnapKind("free");
      return point;
    }
    const snapInput = this.createMeasurementGeometrySnapInput();
    if (!snapInput) {
      this.setMeasurementSnapKind("free");
      return point;
    }
    const snapped = snapMeasurementPointToGeometry(this.toMeasurementPoint(point), snapInput);
    if (!snapped) {
      this.setMeasurementSnapKind("free");
      return point;
    }
    this.setMeasurementSnapKind(snapped.kind);
    return new Vector3(snapped.point.x, snapped.point.y, snapped.point.z);
  }

  private createMeasurementGeometrySnapInput(): MeasurementGeometrySnapInput | null {
    const target = this.measurementTargetObject;
    if (!target || !this.isObjectInLoadedRoot(target)) return null;
    const renderables = this.getMeasurementTargetRenderables();
    if (renderables.length === 0) return null;
    const signature = this.createMeasurementSnapInputSignature(renderables);
    return this.measurementSnapInputCache.getOrCreate(target, signature, () => {
      const vertices: MeasurementSnapVertexCandidate[] = [];
      const edges: MeasurementSnapEdgeCandidate[] = [];
      const targetId = `three:${target.id}`;

      for (const object of renderables) {
        const position = object.geometry.getAttribute("position");
        if (!position || position.count <= 0) continue;
        object.updateWorldMatrix(true, false);
        const objectVertices: PreviewWorldPoint[] = [];
        for (let i = 0; i < position.count; i++) {
          const world = new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
          const point = this.toMeasurementPoint(world);
          objectVertices.push(point);
          vertices.push({ point, targetId });
        }
        if (isMesh(object)) {
          const triangles = createMeasurementTrianglesFromIndices(
            position.count,
            object.geometry.getIndex()?.array ?? null,
          );
          edges.push(...createMeasurementGeometryEdgesFromTriangles(objectVertices, triangles, targetId));
        }
      }

      const bounds = this.getMeasurementTargetBounds();
      return buildMeasurementGeometrySnapInput({
        vertices,
        edges,
        targetId,
        boundsSize: bounds ? getPreviewBoundsSize(bounds) : { x: 1, y: 1, z: 1 },
      });
    });
  }

  private createMeasurementSnapInputSignature(renderables: readonly ThreeRenderableObject[]): string {
    return renderables.map((object) => {
      const geometry = object.geometry;
      const position = geometry.getAttribute("position");
      const index = geometry.getIndex();
      const positionVersion = position && "version" in position ? (position as { version?: number }).version ?? 0 : 0;
      object.updateWorldMatrix(true, false);
      return [
        object.id,
        geometry.id,
        position?.count ?? 0,
        positionVersion,
        index?.count ?? 0,
        index?.version ?? 0,
        object.matrixWorld.elements.map(formatMeasurementSnapSignatureNumber).join(","),
      ].join(":");
    }).join("|");
  }

  private getMeasurementTargetRenderables(): ThreeRenderableObject[] {
    const target = this.measurementTargetObject;
    if (!this.rootObject || !target || !this.isObjectInLoadedRoot(target)) return [];
    const renderableSet = new Set(this.getRenderableObjects(this.rootObject));
    if (isThreeRenderableObject(target) && renderableSet.has(target)) {
      return [target];
    }
    const renderables: ThreeRenderableObject[] = [];
    target.traverse((child) => {
      if (isThreeRenderableObject(child) && child.geometry && renderableSet.has(child)) {
        renderables.push(child);
      }
    });
    return renderables;
  }

  private getMeasurementTargetRaycastPoint(frontmostHit?: { object?: Object3D; point?: Vector3 | null } | null): Vector3 | null {
    const renderables = this.getMeasurementTargetRenderables();
    if (renderables.length === 0) return null;
    const hit = frontmostHit ?? this.raycaster.intersectObjects(this.rootObject ? this.getRenderableObjects(this.rootObject) : [], false)[0];
    if (!hit?.point) return null;
    return renderables.includes(hit.object as ThreeRenderableObject) ? hit.point.clone() : null;
  }

  private createThreeMeasurementDraftingLayout(start: Vector3, end: Vector3): {
    linePoints: Vector3[];
    labelPosition: Vector3;
  } | null {
    const displayStart = this.toMeasurementDisplayPoint(start);
    const displayEnd = this.toMeasurementDisplayPoint(end);
    const markerSize = this.getMeasurementMarkerSize();
    const cameraPosition = this.camera.getWorldPosition(new Vector3());
    const cameraUp = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const layout = createMeasurementDraftingLayout(
      this.toMeasurementPoint(displayStart),
      this.toMeasurementPoint(displayEnd),
      {
        viewPosition: this.toMeasurementPoint(cameraPosition),
        viewUp: this.toMeasurementPoint(cameraUp),
        offset: markerSize * 4.2,
        extensionGap: markerSize * 0.55,
        extensionOvershoot: markerSize * 0.8,
        arrowLength: markerSize * 2.35,
        arrowWidth: markerSize * 0.78,
        labelGap: markerSize * 1.05,
      },
    );
    if (!layout) return null;
    const linePoints = layout.lineSegments.flatMap(([left, right]) => [
      new Vector3(left.x, left.y, left.z),
      new Vector3(right.x, right.y, right.z),
    ]);
    return {
      linePoints,
      labelPosition: new Vector3(layout.labelPoint.x, layout.labelPoint.y, layout.labelPoint.z),
    };
  }

  private getMeasurementMarkerSize(): number {
    if (!this.rootObject) return 0.02;
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    const size = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(size.x, size.y, size.z, 0.001);
    return maxSpan * 0.018;
  }

  private cancelPendingMeasurement(markDirty = true): void {
    if (this.measurementOverlay.cancelPendingPoint()) {
      this.setMeasurementSnapKind(null, false);
    }
    if (markDirty) {
      this.markDirty();
    }
  }

  private createMeasurementMarker(point: Vector3): Mesh {
    const size = this.getMeasurementMarkerSize();
    const markerGeometry = new SphereGeometry(size * 0.38, 12, 12);
    const markerMaterial = new MeshBasicMaterial({
      color: MEASUREMENT_MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.48,
    });
    const marker = new Mesh(markerGeometry, markerMaterial);
    marker.position.copy(this.toMeasurementDisplayPoint(point));
    marker.renderOrder = 999;
    this.scene.add(marker);
    return marker;
  }

  private setMeasurementMarkerState(marker: Mesh, state: MeasurementMarkerVisualState): void {
    marker.scale.setScalar(state === "default" ? 1 : 1.6);
    const color = state === "hover"
      ? MEASUREMENT_HOVER_COLOR
      : state === "pending"
        ? MEASUREMENT_PENDING_COLOR
        : MEASUREMENT_MARKER_COLOR;
    (marker.material as MeshBasicMaterial).color.setHex(color);
  }

  private disposeMeasurementMarker(marker: Mesh): void {
    marker.removeFromParent();
    marker.geometry.dispose();
    const mat = marker.material;
    if (Array.isArray(mat)) {
      for (const entry of mat) entry.dispose();
    } else {
      mat.dispose();
    }
  }

  private addMeasurementPoint(point: Vector3): void {
    const basePoint = this.toMeasurementBasePoint(point);
    const result = this.measurementOverlay.selectPoint(basePoint, this.getMeasurementMarkerSize() * 2.5);
    if (result === "ignored") return;
    this.markDirty();
    this.notifyMeasurementsChanged();
  }

  private createMeasurementSegment(start: Vector3, end: Vector3): ThreeMeasurementSegment {
    const layout = this.createThreeMeasurementDraftingLayout(start, end);
    const displayStart = this.toMeasurementDisplayPoint(start);
    const displayEnd = this.toMeasurementDisplayPoint(end);
    const linePoints = layout?.linePoints ?? [displayStart, displayEnd];
    const geometry = new BufferGeometry().setFromPoints(linePoints);
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color: MEASUREMENT_LINE_COLOR,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 998;
    this.scene.add(line);

    const labelText = createMeasurementLabel(this.createMeasurementReading(start, end));
    const mid = layout?.labelPosition ?? new Vector3().addVectors(displayStart, displayEnd).multiplyScalar(0.5);
    const label = this.createMeasurementLabelSprite(labelText, mid, this.getMeasurementMarkerSize() * 3.2);
    this.scene.add(label);

    return { start: start.clone(), end: end.clone(), line, label };
  }

  private disposeMeasurementSegment(segment: ThreeMeasurementSegment): void {
    segment.line.removeFromParent();
    segment.line.geometry.dispose();
    (segment.line.material as Material).dispose();
    segment.label.removeFromParent();
    const material = segment.label.material;
    material.map?.dispose();
    material.dispose();
  }

  private updateMeasurementSegmentLabel(segment: ThreeMeasurementSegment): void {
    const labelText = createMeasurementLabel(this.createMeasurementReading(segment.start, segment.end));
    segment.label.removeFromParent();
    const material = segment.label.material;
    material.map?.dispose();
    material.dispose();
    const layout = this.createThreeMeasurementDraftingLayout(segment.start, segment.end);
    const labelPosition = layout?.labelPosition ?? new Vector3()
      .addVectors(this.toMeasurementDisplayPoint(segment.start), this.toMeasurementDisplayPoint(segment.end))
      .multiplyScalar(0.5);
    segment.label = this.createMeasurementLabelSprite(
      labelText,
      labelPosition,
      this.getMeasurementMarkerSize() * 3.2,
    );
    this.scene.add(segment.label);
  }

  private createMeasurementLabelSprite(text: { primary: string; secondary: string }, position: Vector3, scale: number): Sprite {
    const canvas = createStagedEl("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = MEASUREMENT_LABEL_CANVAS.width;
    canvas.height = MEASUREMENT_LABEL_CANVAS.height;
    drawMeasurementLabelCanvas(ctx, text, canvas.width, canvas.height);

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale * 3.7, scale * 1.08, 1);
    sprite.renderOrder = 1000;
    return sprite;
  }

  private ensurePreviewLine(): void {
    if (this.previewLine) return;
    const geometry = new BufferGeometry().setFromPoints(Array.from({ length: 14 }, () => new Vector3()));
    this.previewLine = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color: MEASUREMENT_PREVIEW_COLOR,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.previewLine.renderOrder = 997;
    this.scene.add(this.previewLine);
  }

  private updatePreviewLine(): void {
    this.previewLineUpdateHandle = 0;
    if (!this.pendingPoint || !this.previewLine || !this.rootObject) return;
    const displayStart = this.toMeasurementDisplayPoint(this.pendingPoint);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((this.lastPointerClient.x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((this.lastPointerClient.y - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let endPoint: Vector3 | null = null;
    if (this.lastPointerClient.altKey) {
      this.setMeasurementSnapKind("free");
      const hit = this.raycaster.intersectObjects(this.getRenderableObjects(this.rootObject), false)[0];
      endPoint = hit?.point
        ? this.resolveMeasurementPickPoint(hit.point.clone(), true)
        : displayStart.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(5));
    } else {
      const targetPoint = this.getMeasurementTargetRaycastPoint();
      if (targetPoint) {
        endPoint = this.resolveMeasurementPickPoint(targetPoint, false);
      } else {
        this.setMeasurementSnapKind(null);
      }
    }
    const previewLayout = endPoint
      ? this.createThreeMeasurementDraftingLayout(this.pendingPoint, this.toMeasurementBasePoint(endPoint))
      : null;
    const linePoints = endPoint && previewLayout ? previewLayout.linePoints : [displayStart, displayStart];
    const position = this.previewLine.geometry.getAttribute("position");
    if (position.count !== linePoints.length) {
      this.previewLine.geometry.dispose();
      this.previewLine.geometry = new BufferGeometry().setFromPoints(linePoints);
    } else {
      for (let i = 0; i < linePoints.length; i++) {
        const point = linePoints[i];
        position.setXYZ(i, point.x, point.y, point.z);
      }
      position.needsUpdate = true;
    }
    this.previewLine.geometry.computeBoundingSphere();
    this.markDirty();
  }

  private schedulePreviewLineUpdate(): void {
    if (this.previewLineUpdateHandle) return;
    this.previewLineUpdateHandle = window.requestAnimationFrame(() => this.updatePreviewLine());
  }

  private cancelPreviewLineUpdate(): void {
    if (!this.previewLineUpdateHandle) return;
    window.cancelAnimationFrame(this.previewLineUpdateHandle);
    this.previewLineUpdateHandle = 0;
  }

  private removePreviewLine(): void {
    this.cancelPreviewLineUpdate();
    if (!this.previewLine) return;
    this.previewLine.removeFromParent();
    this.previewLine.geometry.dispose();
    (this.previewLine.material as Material).dispose();
    this.previewLine = null;
  }

  private createMeasurementReading(start: Vector3, end: Vector3): MeasurementReading {
    return buildMeasurementReading(
      this.toMeasurementPoint(start),
      this.toMeasurementPoint(end),
      this.measurementScale,
      this.measurementUnit,
    );
  }

  private createMeasurementRecords(): MeasurementRecord[] {
    return this.measurementOverlay.getSegments().map((segment, index) => ({
      index: index + 1,
      start: this.toMeasurementPoint(segment.start),
      end: this.toMeasurementPoint(segment.end),
      reading: this.createMeasurementReading(segment.start, segment.end),
    }));
  }

  private toMeasurementPoint(point: Vector3): PreviewWorldPoint {
    return { x: point.x, y: point.y, z: point.z };
  }

  private notifyMeasurementsChanged(): void {
    this.measurementSession.notify();
  }

}

function formatMeasurementSnapSignatureNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(10) : String(value);
}

export function createThreeModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new ThreeModelPreview(canvas);
}
