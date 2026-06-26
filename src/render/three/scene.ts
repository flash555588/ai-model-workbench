import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxHelper,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Light,
  Line,
  LineBasicMaterial,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
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
  loadThreeGLTF,
  loadThreeSTL,
  loadThreePLY,
  loadThreeOBJ,
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
import {
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
  type PreviewBounds,
} from "../preview/bounds";
import { createPreviewPerspectiveCameraFit } from "../preview/camera-fit";
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
  MeasurementScale,
  MeasurementUnit,
  PreviewQualitySnapshot,
} from "../preview/types";
import {
  createAnnotationViewportProvider,
  formatAnnotationCameraStateKey,
  projectNormalizedDevicePointToCanvas,
} from "../preview/annotation-projection";
import { createPreviewLineOfSight, isPreviewHitOccluded, toPreviewWorldPoint } from "../preview/geometry";
import type { PreviewDisassemblyController } from "../preview/disassembly";
import { createPreviewEvidence } from "../preview/evidence";
import {
  createMeasurementLabel,
  createMeasurementMarkdown,
  createMeasurementReading as buildMeasurementReading,
  normalizeMeasurementUnit,
  sanitizeMeasurementScale,
  type MeasurementReading,
  type MeasurementRecord,
} from "../preview/measurement";
import { createThreeDisassemblyController } from "./disassembly";
import { setThreeExplode, resetThreeExplode } from "./explode";
import { getPortableBasename } from "../../utils/resolve-path";
import {
  prepareThreeMaterialForColorAccuracy,
  type ThreeTextureAudit,
} from "./material-quality";
import { shouldContinueThreeRenderLoop, ThreeSmoothnessTracker } from "./smoothness";
import {
  createThreeGeometryQualityStats,
  createThreeGroupedPartCandidates,
  createThreeChildRenderableMeshMap,
  createThreeModelPreviewSummary,
  createThreeObjectPartPreviewSummary,
  createThreeRenderableInfoBreakdown,
  createThreeRenderablePartPreviewSummary,
  findThreeSelectablePartObject,
  getThreeMaterialList as materialList,
  getThreeRenderableMaterialNames,
  getThreeObjectPreviewBounds as getObjectPreviewBounds,
  isThreeRenderableObject,
  isThreeMesh as isMesh,
  type ThreeChildRenderableMeshMap,
  type ThreeRenderableObject,
} from "./mesh-preview";

const DEFAULT_BACKGROUND = new Color("#20242e");
const FOCUS_DIM_OPACITY = 0.242;
const DEFAULT_SHADOW_OPACITY = 0.28;
const MAX_RENDER_PIXEL_RATIO = 2.5;
const DESKTOP_INTERACTIVE_PIXEL_RATIO_CAP = 1.5;
const MOBILE_INTERACTIVE_PIXEL_RATIO_CAP = 1.15;
const INTERACTIVE_PIXEL_RATIO_HOLD_MS = 260;
const RENDER_OBSERVER_SETTLE_FRAMES = 30;
const RENDER_OBSERVER_SETTLE_MIN_FRAMES = 8;
const FRAME_BUDGET_SLOW_MS = 28;
const FRAME_BUDGET_FAST_MS = 18;
const FRAME_BUDGET_SLOW_STREAK = 2;
const FRAME_BUDGET_FAST_STREAK = 28;
const FRAME_BUDGET_PIXEL_RATIO_STEP = 0.86;
const FRAME_BUDGET_PIXEL_RATIO_RECOVERY_STEP = 1.08;
const FRAME_BUDGET_MIN_PIXEL_RATIO_SCALE = 0.62;
const FRAME_BUDGET_SHADOW_SCALE = 0.86;
const FRAME_BUDGET_MAX_OBSERVER_STRIDE = 4;

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

function isObjectOrDescendant(candidate: Object3D, target: Object3D): boolean {
  let current: Object3D | null = candidate;
  while (current) {
    if (current === target) return true;
    current = current.parent;
  }
  return false;
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

function createFocusDimMaterial(material: Material): Material {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = Math.max(0, Math.min(1, material.opacity)) * FOCUS_DIM_OPACITY;
  clone.depthWrite = false;
  clone.needsUpdate = true;
  return clone;
}

function cloneFocusDimMaterialValue(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material)
    ? material.map(createFocusDimMaterial)
    : createFocusDimMaterial(material);
}

function disposeMaterialValue(material: Material | Material[] | undefined): void {
  for (const entry of materialList(material)) {
    entry.dispose();
  }
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
  private readonly pointer = new Vector2();
  private readonly annotationProjection = new Vector3();
  private readonly annotationDirection = new Vector3();
  private readonly clock = { last: performance.now() };
  private readonly defaultLights: Light[] = [];
  private readonly configLights: Light[] = [];
  private environmentTarget: WebGLRenderTarget | null = null;
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
  private bboxHelper: BoxHelper | null = null;
  private groundShadowMesh: Mesh | null = null;
  private meshShadowFlagsPrepared = false;
  private gridHelper: GridHelper | null = null;
  private bboxEnabled = false;
  private wireframeEnabled = false;
  private wireframeOriginalMaterials = new Map<number, Material | Material[]>();
  private sceneConfig: SceneConfig = {};
  private focusSelectionEnabled = false;
  private focusedObject: Object3D | null = null;
  private highlightedObject: Object3D | null = null;
  private selectionHelper: BoxHelper | null = null;
  private focusHelper: BoxHelper | null = null;
  private mixer: AnimationMixer | null = null;
  private animationPlaying = false;
  private initialTarget = new Vector3();
  private initialPosition = new Vector3(3, 2, 3);
  private initialFov = 45;
  private initialZoom = 1;
  private initialCameraMode: "perspective" | "orthographic" = "perspective";
  private cameraMode: "perspective" | "orthographic" = "perspective";
  private lastPointerDown: { x: number; y: number } | null = null;
  private measurementActive = false;
  private measurementScale: MeasurementScale = { x: 1, y: 1, z: 1 };
  private measurementUnit: MeasurementUnit = "mm";
  private measurementSegments: Array<{ start: Vector3; end: Vector3; line: Line; label: Sprite }> = [];
  private measurementMarkers: Mesh[] = [];
  private pendingPoint: Vector3 | null = null;
  private pendingMarker: Mesh | null = null;
  private hoveredMarkerIndex = -1;
  private lastPointerClient = { x: 0, y: 0 };
  private previewLine: Line | null = null;
  private previewLineUpdateHandle = 0;
  private readonly originalMaterials = new Map<number, Material | Material[]>();
  private readonly focusDimMaterials = new Map<number, Material | Material[]>();
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
  private cachedChildMeshMap: ThreeChildRenderableMeshMap | null = null;
  private cachedChildMeshMapRoot: Object3D | null = null;
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
    this.markDirty();
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
    this.lastPointerDown = { x: event.clientX, y: event.clientY };
    this.prepareInteractiveFrameBudget();
  };
  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const down = this.lastPointerDown;
    this.lastPointerDown = null;
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    if (this.disassembly?.isEnabled()) return;
    this.dispatchPick(event);
  };
  private readonly handlePointerMove = (event: PointerEvent) => {
    this.lastPointerClient = { x: event.clientX, y: event.clientY };
    if (event.buttons & 1) {
      this.prepareInteractiveFrameBudget();
    }
    if (!this.measurementActive) return;
    if (this.pendingPoint) {
      this.schedulePreviewLineUpdate();
    }
    if (this.measurementMarkers.length === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.measurementMarkers, false);
    const newHover = hits.length > 0 ? this.measurementMarkers.indexOf(hits[0].object as Mesh) : -1;
    if (newHover !== this.hoveredMarkerIndex) {
      if (this.hoveredMarkerIndex >= 0 && this.hoveredMarkerIndex < this.measurementMarkers.length) {
        const prev = this.measurementMarkers[this.hoveredMarkerIndex];
        if (prev !== this.pendingMarker) {
          prev.scale.setScalar(1);
          (prev.material as MeshBasicMaterial).color.setHex(0xff6b6b);
        }
      }
      if (newHover >= 0 && newHover < this.measurementMarkers.length) {
        const next = this.measurementMarkers[newHover];
        next.scale.setScalar(1.6);
        (next.material as MeshBasicMaterial).color.setHex(0xffd43b);
      }
      this.hoveredMarkerIndex = newHover;
      this.markDirty();
    }
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
    this.installGlobalEnvironment();
    this.camera = new PerspectiveCamera(this.initialFov, 1, 0.01, 2000);
    this.camera.position.copy(this.initialPosition);
    this.camera.lookAt(this.initialTarget);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 0.85;
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
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.resizeRenderer();
    this.startRenderLoop();
  }

  async loadModel(
    data: ArrayBuffer,
    ext: string,
    readFile?: (path: string) => Promise<ArrayBuffer>,
    modelPath?: string,
  ): Promise<ModelPreviewSummary> {
    this.clearLoadedModel("model-switch");
    this.loadedExt = ext.toLowerCase();
    this.resourceWarnings = [];
    this.textureAudit = createEmptyTextureAudit();

    let root: Object3D;
    let animations: import("three").AnimationClip[] = [];

    if (this.loadedExt === "glb" || this.loadedExt === "gltf") {
      const gltfResult = await loadThreeGLTF(data, this.loadedExt, readFile, modelPath);
      root = gltfResult.scene;
      animations = gltfResult.animations;
      this.resourceWarnings = gltfResult.warnings;
    } else if (this.loadedExt === "stl") {
      root = await loadThreeSTL(data);
      this.stlMaterial = isMesh(root) ? (root.material as MeshStandardMaterial) : null;
    } else if (this.loadedExt === "ply") {
      root = await loadThreePLY(data);
    } else if (this.loadedExt === "obj") {
      const objResult = await loadThreeOBJ(data, readFile, modelPath);
      root = objResult.object;
      this.resourceWarnings = objResult.warnings;
    } else {
      throw new Error(`Three preview does not support .${this.loadedExt} format`);
    }

    this.rootObject = root;
    this.scene.add(root);
    this.invalidateMeshCache();
    const renderableObjects = this.getRenderableObjects(root);
    this.prepareModelForQuality(renderableObjects);
    this.syncShadowFeatures();
    const rootBounds = this.getRootPreviewBounds(root);
    this.updateShadowFraming(rootBounds);
    this.syncSceneHelpers();
    this.markDirty();

    if (animations.length > 0) {
      this.mixer = new AnimationMixer(root);
      for (const clip of animations) {
        this.mixer.clipAction(clip).play();
      }
      this.animationPlaying = true;
    }

    const summary = createThreeModelPreviewSummary(root, renderableObjects, this.resourceWarnings, rootBounds ?? undefined);
    this.cachedGeometryQualityStats = createThreeGeometryQualityStats(root, renderableObjects, rootBounds ?? undefined);
    this.fitCameraToObject(root, rootBounds ?? undefined);
    if (this.bboxEnabled) {
      this.ensureBoundingBoxHelper();
    }
    this.disassemblySetup = false;
    this.disassembly?.dispose();
    this.disassembly = null;
    return summary;
  }

  applyConfig(config: ThreeDBlockConfig): void {
    if (config.camera) this.applyCameraConfig(config.camera);
    if (config.lights) this.applyLightConfig(config.lights);
    if (config.scene) this.applySceneConfig(config.scene);
    if (config.stl) this.applySTLConfig(config.stl);
  }

  private applySTLConfig(config: STLConfig): void {
    const material = this.stlMaterial;
    if (!material) return;
    if (config.color !== undefined) {
      material.color.set(config.color);
    }
    if (config.wireframe !== undefined) {
      material.wireframe = config.wireframe;
      material.needsUpdate = true;
    }
    this.markDirty();
  }

  destroy(): void {
    cancelAnimationFrame(this.renderHandle);
    cancelAnimationFrame(this.cameraAnimHandle);
    this._onPickCallbacks = [];
    this.renderObservers.clear();
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
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("wheel", this.preventCanvasWheelScroll);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
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
    const groupedPartCandidates = createThreeGroupedPartCandidates(this.rootObject, renderableMeshes, childMeshMap);
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
      createMeshPart: (object) => createThreeRenderablePartPreviewSummary(object, this.rootObject),
      getMeshMaterialNames: getThreeRenderableMaterialNames,
      resourceWarnings: this.resourceWarnings,
    });
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    const object = this.focusedObject
      ?? (this._lastPickResult.mesh instanceof Object3D ? this._lastPickResult.mesh : null);
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

    if (result.mesh instanceof Object3D) {
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
    if (this.rootObject) {
      resetThreeExplode(this.rootObject);
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
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.markDirty();
    this.renderNow(performance.now());
  }

  toggleFocusSelection(): boolean {
    const nextEnabled = !this.focusSelectionEnabled;
    if (nextEnabled && this.disassembly?.isEnabled()) {
      this.disassembly.setEnabled(false);
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
        const materials = materialList(mesh.material);
        const cloned = materials.map((mat) => {
          if (mat instanceof MeshStandardMaterial) {
            const basic = new MeshBasicMaterial({
              color: mat.color,
              transparent: mat.transparent,
              opacity: mat.opacity,
              side: mat.side,
              visible: mat.visible,
            });
            basic.wireframe = true;
            return basic;
          }
          if ("wireframe" in mat) {
            const c = mat.clone();
            c.wireframe = true;
            return c;
          }
          return mat;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      } else {
        const original = this.wireframeOriginalMaterials.get(mesh.id);
        if (original) {
          mesh.material = original;
        }
        this.wireframeOriginalMaterials.delete(mesh.id);
      }
    }
  }

  toggleOrientationGizmo(): boolean {
    if (!this.axesHelper) {
      this.axesHelper = new AxesHelper(1.2);
      this.axesHelper.visible = false;
      const mat = this.axesHelper.material as LineBasicMaterial;
      mat.depthTest = false;
      mat.depthWrite = false;
      this.axesHelper.renderOrder = 999;
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = !this.axesHelper.visible;
    this.axesHelper.position.copy(this.controls.target);
    this.markDirty();
    return this.axesHelper.visible;
  }

  isOrientationGizmoEnabled(): boolean {
    return !!this.axesHelper?.visible;
  }

  toggleBoundingBox(): boolean {
    this.bboxEnabled = !this.bboxEnabled;
    if (!this.bboxEnabled) {
      this.bboxHelper?.removeFromParent();
      this.bboxHelper = null;
      this.markDirty();
      return false;
    }

    this.ensureBoundingBoxHelper();
    this.markDirty();
    return !!this.bboxHelper;
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
    this.measurementActive = !this.measurementActive;
    if (!this.measurementActive) {
      this.cancelPendingMeasurement();
    }
    return this.measurementActive;
  }

  isMeasurementActive(): boolean {
    return this.measurementActive;
  }

  clearMeasurements(): void {
    this.disposeMeasurementOverlays(false);
  }

  private disposeMeasurementOverlays(deactivate: boolean): void {
    if (deactivate) {
      this.measurementActive = false;
    }
    this.cancelPendingMeasurement(false);
    for (const segment of this.measurementSegments) {
      segment.line.removeFromParent();
      segment.line.geometry.dispose();
      (segment.line.material as Material).dispose();
      segment.label.removeFromParent();
      const mat = segment.label.material;
      mat.map?.dispose();
      mat.dispose();
    }
    this.measurementSegments = [];
    for (const marker of this.measurementMarkers) {
      marker.removeFromParent();
      marker.geometry.dispose();
      const mat = marker.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat.dispose();
      }
    }
    this.measurementMarkers = [];
    this.markDirty();
  }


  setMeasurementScale(scale: MeasurementScale): void {
    this.measurementScale = sanitizeMeasurementScale(scale);
    this.updateMeasurementLabels();
  }

  getMeasurementScale(): MeasurementScale {
    return { ...this.measurementScale };
  }

  setMeasurementUnit(unit: MeasurementUnit): void {
    this.measurementUnit = normalizeMeasurementUnit(unit);
    this.updateMeasurementLabels();
  }

  getMeasurementUnit(): MeasurementUnit {
    return this.measurementUnit;
  }

  getMeasurementBounds(): { x: number; y: number; z: number } | null {
    if (!this.rootObject) return null;
    const bounds = getObjectPreviewBounds(this.rootObject);
    const size = getPreviewBoundsSize(bounds);
    return size;
  }

  getMeasurementRecords(): MeasurementRecord[] {
    return this.createMeasurementRecords();
  }

  exportMeasurements(): string {
    return createMeasurementMarkdown(this.createMeasurementRecords());
  }

  updateMeasurementLabels(): void {
    if (this.measurementSegments.length === 0) return;
    const markerSize = this.getMeasurementMarkerSize() * 4;
    for (const segment of this.measurementSegments) {
      const labelText = createMeasurementLabel(this.createMeasurementReading(segment.start, segment.end));
      segment.label.removeFromParent();
      const mat = segment.label.material;
      mat.map?.dispose();
      mat.dispose();
      const mid = new Vector3().addVectors(segment.start, segment.end).multiplyScalar(0.5);
      segment.label = this.createMeasurementLabelSprite(labelText, mid, markerSize);
      this.scene.add(segment.label);
    }
    this.markDirty();
  }
  setRenderQuality(quality: "low" | "medium" | "high", renderScale = this.renderScale): void {
    this.quality = quality;
    this.renderScale = renderScale;
    this.applyShadowQuality();
    this.resizeRenderer();
  }

  setRenderScale(scale: number): number {
    this.renderScale = Math.min(2, Math.max(0.25, scale));
    this.resizeRenderer();
    return Number(this.renderScale.toFixed(2));
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
    setThreeExplode(this.rootObject, factor, axis);
    this.invalidateRootBoundsCache();
    this.markShadowDirty();
    this.markDirty();
  }

  resetExplode(): void {
    if (!this.rootObject) return;
    resetThreeExplode(this.rootObject);
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
    }
    const enabled = this.disassembly.setEnabled(nextEnabled);
    if (!enabled) {
      this.disassembly.reset();
    }
    return enabled;
  }

  resetDisassembly(): void {
    this.disassembly?.reset();
    this.invalidateRootBoundsCache();
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
    const duration = 500;
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

    const cameraMoved = this.controls.update();
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
    if (this.camera instanceof OrthographicCamera) {
      this.updateOrthographicFrustum(width / height);
    } else {
      this.camera.aspect = width / height;
    }
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private computeOrthographicViewSpan(): number {
    if (!this.rootObject) return 2;
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    const size = getPreviewBoundsSize(bounds);
    return Math.max(Math.max(size.x, size.y, size.z, Number.EPSILON) * 1.2, 0.001);
  }

  private updateOrthographicFrustum(aspect: number): void {
    if (!(this.camera instanceof OrthographicCamera)) return;
    const viewSpan = this.computeOrthographicViewSpan();
    const halfHeight = viewSpan / 2;
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
  }

  private updateOrthographicFrustumForCamera(camera: OrthographicCamera, aspect: number): void {
    const viewSpan = this.computeOrthographicViewSpan();
    const halfHeight = viewSpan / 2;
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
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
    }
    if (config.lookAt) {
      this.controls.target.set(...config.lookAt);
      this.camera.lookAt(this.controls.target);
      this.initialTarget.set(...config.lookAt);
    }
    if (typeof config.near === "number" && Number.isFinite(config.near)) {
      this.camera.near = config.near;
    }
    if (typeof config.far === "number" && Number.isFinite(config.far)) {
      this.camera.far = config.far;
    }
    if (typeof config.zoom === "number" && Number.isFinite(config.zoom)) {
      this.camera.zoom = config.zoom;
      this.initialZoom = config.zoom;
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.markDirty();
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
      if (light.parent !== this.camera) {
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
    }
    if (typeof config.autoRotateSpeed === "number") {
      this.controls.autoRotateSpeed = config.autoRotateSpeed;
    }
    if (typeof config.axis === "boolean") {
      this.syncAxisHelper(config.axis);
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
    this.scene.environmentIntensity = 0.48;
    room.dispose();
    pmrem.dispose();
  }

  private disposeGlobalEnvironment(): void {
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
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    for (const object of renderables) {
      for (const material of materialList(object.material)) {
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

    if (typeof this.sceneConfig.axis === "boolean") {
      this.syncAxisHelper(this.sceneConfig.axis);
    }
  }

  private syncAxisHelper(visible: boolean): void {
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
    };
    this._lastPickResult = result;

    if (this.measurementActive && hit?.point) {
      this.addMeasurementPoint(hit.point.clone());
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
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.meshShadowFlagsPrepared = false;
    this.invalidateMeshCache();
    this.markDirty();
    this.clearFocusedMesh();
    this.clearSelectionHighlight();
    this.disposeMeasurementOverlays(true);
    this.wireframeEnabled = false;
    this.wireframeOriginalMaterials.clear();
    this.stlMaterial = null;
    this.bboxHelper?.removeFromParent();
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
    this.markShadowDirty();
  }

  private disposeObjectGraph(root: Object3D, reason: DisposalReason): ThreeDisposalAudit {
    const geometryIds = new Set<string>();
    const materialIds = new Set<string>();
    const textureIds = new Set<string>();
    let meshCount = 0;
    let objectCount = 0;

    root.traverse((object) => {
      objectCount++;
      if (!isThreeRenderableObject(object)) return;
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
    });

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

    if (!materialIds.has(material.uuid)) {
      material.dispose();
      materialIds.add(material.uuid);
    }
  }

  private fitCameraToObject(root: Object3D, rootBounds?: PreviewBounds): void {
    const bounds = rootBounds ?? this.getRootPreviewBounds(root) ?? getObjectPreviewBounds(root);
    const fit = createPreviewPerspectiveCameraFit(bounds);
    this.initialTarget.set(fit.target.x, fit.target.y, fit.target.z);
    this.initialPosition.set(fit.position.x, fit.position.y, fit.position.z);
    this.initialFov = 45;
    const boundsSize = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(boundsSize.x, boundsSize.y, boundsSize.z, Number.EPSILON);
    const fitDistance = this.initialPosition.distanceTo(this.initialTarget);
    this.controls.minDistance = Math.max(fit.near * 4, maxSpan * 0.02, 0.00001);
    this.controls.maxDistance = Math.max(fitDistance * 8, this.controls.minDistance * 10);
    this.raycaster.params.Points = { threshold: Math.max(maxSpan * 0.01, 0.00001) };
    this.raycaster.params.Line = { threshold: Math.max(maxSpan * 0.002, 0.00001) };
    this.occlusionRaycaster.params.Points = { threshold: Math.max(maxSpan * 0.006, 0.00001) };
    this.occlusionRaycaster.params.Line = { threshold: Math.max(maxSpan * 0.001, 0.00001) };
    this.resetView();
    if (this.axesHelper) {
      this.axesHelper.position.copy(this.controls.target);
      this.axesHelper.scale.setScalar(Math.max(maxSpan * 0.25, 0.0005));
    }
    this.camera.near = fit.near;
    this.camera.far = fit.far;
    this.camera.updateProjectionMatrix();
    this.markDirty();
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
    root.traverse((object) => {
      if (isThreeRenderableObject(object) && object.geometry) {
        renderables.push(object);
      }
    });
    this.cachedRenderables = renderables;
    this.cachedRenderableRoot = root;
    return renderables;
  }

  private getChildRenderableMeshMap(root: Object3D): ThreeChildRenderableMeshMap {
    if (this.cachedChildMeshMap && this.cachedChildMeshMapRoot === root) return this.cachedChildMeshMap;
    this.cachedChildMeshMap = createThreeChildRenderableMeshMap(root, this.getRenderableMeshes(root));
    this.cachedChildMeshMapRoot = root;
    return this.cachedChildMeshMap;
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
      );
    }
    return this.cachedGeometryQualityStats;
  }

  private invalidateMeshCache(): void {
    this.cachedMeshes = null;
    this.cachedMeshRoot = null;
    this.cachedRenderables = null;
    this.cachedRenderableRoot = null;
    this.cachedChildMeshMap = null;
    this.cachedChildMeshMapRoot = null;
    this.invalidateRootBoundsCache();
  }

  private invalidateRootBoundsCache(): void {
    this.cachedRootPreviewBounds = null;
    this.cachedRootPreviewBoundsObject = null;
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

  private ensureBoundingBoxHelper(): void {
    if (!this.rootObject) return;
    this.bboxHelper?.removeFromParent();
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

    this.selectionHelper?.removeFromParent();
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
    const selectedMeshes = renderableMeshes.filter((candidate) => isObjectOrDescendant(candidate, object));
    if (selectedMeshes.length === 0 && !isThreeRenderableObject(object)) {
      this.clearFocusedMesh();
      return;
    }
    const selectedMeshSet = new Set(selectedMeshes);
    this.restoreFocusedMaterials();
    this.disposeFocusDimMaterials();

    for (const candidate of renderableMeshes) {
      if (!this.originalMaterials.has(candidate.id)) {
        this.originalMaterials.set(candidate.id, candidate.material);
      }

      if (selectedMeshSet.has(candidate)) {
        candidate.material = this.originalMaterials.get(candidate.id) ?? candidate.material;
        continue;
      }

      const originalMaterial = this.originalMaterials.get(candidate.id) ?? candidate.material;
      const dimMaterial = cloneFocusDimMaterialValue(originalMaterial);
      this.focusDimMaterials.set(candidate.id, dimMaterial);
      candidate.material = dimMaterial;
    }

    this.focusHelper?.removeFromParent();
    this.focusHelper = new BoxHelper(object, 0x2ec4ff);
    this.scene.add(this.focusHelper);
    this.focusedObject = object;
    this.markDirty();
  }

  private clearFocusedMesh(): void {
    this.restoreFocusedMaterials();
    this.disposeFocusDimMaterials();
    this.originalMaterials.clear();
    this.focusHelper?.removeFromParent();
    this.focusHelper = null;
    this.focusedObject = null;
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

  private disposeFocusDimMaterials(): void {
    for (const material of this.focusDimMaterials.values()) {
      disposeMaterialValue(material);
    }
    this.focusDimMaterials.clear();
  }

  private clearSelectionHighlight(): void {
    this.selectionHelper?.removeFromParent();
    this.selectionHelper = null;
    this.highlightedObject = null;
    this.markDirty();
  }

  private getMeasurementMarkerSize(): number {
    if (!this.rootObject) return 0.02;
    const bounds = this.getRootPreviewBounds() ?? getObjectPreviewBounds(this.rootObject);
    const size = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(size.x, size.y, size.z, 0.001);
    return maxSpan * 0.015;
  }

  private cancelPendingMeasurement(markDirty = true): void {
    const pendingMarker = this.pendingMarker;
    const pendingPoint = this.pendingPoint?.clone() ?? null;
    this.pendingPoint = null;
    this.pendingMarker = null;
    this.hoveredMarkerIndex = -1;
    this.removePreviewLine();

    if (pendingMarker && pendingPoint && !this.isMeasurementPointUsed(pendingPoint)) {
      const index = this.measurementMarkers.indexOf(pendingMarker);
      if (index >= 0) {
        this.measurementMarkers.splice(index, 1);
      }
      this.disposeMeasurementMarker(pendingMarker);
    } else if (pendingMarker) {
      pendingMarker.scale.setScalar(1);
      (pendingMarker.material as MeshBasicMaterial).color.setHex(0xff6b6b);
    }

    if (markDirty) {
      this.markDirty();
    }
  }

  private isMeasurementPointUsed(point: Vector3): boolean {
    return this.measurementSegments.some((segment) =>
      segment.start.distanceTo(point) < 0.0001 || segment.end.distanceTo(point) < 0.0001);
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

  private findNearestMarkerIndex(point: Vector3): number {
    const threshold = this.getMeasurementMarkerSize() * 2.5;
    for (let i = 0; i < this.measurementMarkers.length; i++) {
      if (this.measurementMarkers[i].position.distanceTo(point) < threshold) {
        return i;
      }
    }
    return -1;
  }

  private addMeasurementPoint(point: Vector3): void {
    const existingIndex = this.findNearestMarkerIndex(point);
    const usePoint = existingIndex >= 0
      ? this.measurementMarkers[existingIndex].position.clone()
      : point;

    if (this.pendingPoint) {
      if (usePoint.distanceTo(this.pendingPoint) < 0.0001) {
        return;
      }
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const markerGeometry = new SphereGeometry(size, 16, 16);
        const markerMaterial = new MeshBasicMaterial({ color: 0xff6b6b, depthTest: false });
        const marker = new Mesh(markerGeometry, markerMaterial);
        marker.position.copy(usePoint);
        marker.renderOrder = 999;
        this.scene.add(marker);
        this.measurementMarkers.push(marker);
      }
      this.createMeasurementSegment(this.pendingPoint, usePoint);
      // 恢复起点标记颜色
      if (this.pendingMarker) {
        this.pendingMarker.scale.setScalar(1);
        (this.pendingMarker.material as MeshBasicMaterial).color.setHex(0xff6b6b);
      }
      this.pendingPoint = null;
      this.pendingMarker = null;
      this.removePreviewLine();
    } else {
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const markerGeometry = new SphereGeometry(size, 16, 16);
        const markerMaterial = new MeshBasicMaterial({ color: 0xff6b6b, depthTest: false });
        const marker = new Mesh(markerGeometry, markerMaterial);
        marker.position.copy(usePoint);
        marker.renderOrder = 999;
        this.scene.add(marker);
        this.measurementMarkers.push(marker);
        this.pendingMarker = marker;
      } else {
        this.pendingMarker = this.measurementMarkers[existingIndex];
      }
      this.pendingMarker.scale.setScalar(1.6);
      (this.pendingMarker.material as MeshBasicMaterial).color.setHex(0x51cf66);
      this.pendingPoint = usePoint;
      this.ensurePreviewLine();
    }
    this.markDirty();
  }

  private createMeasurementSegment(start: Vector3, end: Vector3): void {
    const geometry = new BufferGeometry().setFromPoints([start, end]);
    const line = new Line(geometry, new LineBasicMaterial({ color: 0xff6b6b, depthTest: false }));
    line.renderOrder = 998;
    this.scene.add(line);

    const labelText = createMeasurementLabel(this.createMeasurementReading(start, end));
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5);
    const label = this.createMeasurementLabelSprite(labelText, mid, this.getMeasurementMarkerSize() * 4);
    this.scene.add(label);

    this.measurementSegments.push({ start, end, line, label });
  }

  private createMeasurementLabelSprite(text: { primary: string; secondary: string }, position: Vector3, scale: number): Sprite {
    const canvas = activeDocument.createEl("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 640;
    canvas.height = 160;
    ctx.fillStyle = "rgba(32, 36, 46, 0.9)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 640, 160, 18);
    ctx.fill();
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 46px sans-serif";
    ctx.fillText(text.primary, 320, 58);
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.fillText(text.secondary, 320, 112);

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale * 5, scale * 1.25, 1);
    sprite.renderOrder = 1000;
    return sprite;
  }

  private ensurePreviewLine(): void {
    if (this.previewLine) return;
    const geometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
    this.previewLine = new Line(
      geometry,
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false }),
    );
    this.previewLine.renderOrder = 997;
    this.scene.add(this.previewLine);
  }

  private updatePreviewLine(): void {
    this.previewLineUpdateHandle = 0;
    if (!this.pendingPoint || !this.previewLine || !this.rootObject) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((this.lastPointerClient.x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((this.lastPointerClient.y - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.getRenderableObjects(this.rootObject), false)[0];
    let endPoint: Vector3;
    if (hit?.point) {
      endPoint = hit.point.clone();
    } else {
      endPoint = this.pendingPoint.clone().add(
        this.raycaster.ray.direction.clone().multiplyScalar(5),
      );
    }
    const position = this.previewLine.geometry.getAttribute("position");
    position.setXYZ(0, this.pendingPoint.x, this.pendingPoint.y, this.pendingPoint.z);
    position.setXYZ(1, endPoint.x, endPoint.y, endPoint.z);
    position.needsUpdate = true;
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
    return this.measurementSegments.map((segment, index) => ({
      index: index + 1,
      start: this.toMeasurementPoint(segment.start),
      end: this.toMeasurementPoint(segment.end),
      reading: this.createMeasurementReading(segment.start, segment.end),
    }));
  }

  private toMeasurementPoint(point: Vector3): PreviewWorldPoint {
    return { x: point.x, y: point.y, z: point.z };
  }

}

export function createThreeModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new ThreeModelPreview(canvas);
}
