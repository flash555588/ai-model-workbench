import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Light,
  Material,
  Mesh,
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
  ThreeDBlockConfig,
} from "../../domain/models";
import { isMobile } from "../../utils/device";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
} from "../preview/bounds";
import { createPreviewPerspectiveCameraFit } from "../preview/camera-fit";
import {
  createPreviewModelInfoMarkdown,
  createPreviewPartInfoMarkdown,
} from "../preview/report";
import {
  createPreviewModelSummary,
  createPreviewPartSummary,
} from "../preview/summary";
import { extractPreviewComponentIdentity, type PreviewComponentIdentity } from "../preview/component-identity";
import type {
  PreviewAxis,
  WorkbenchPreview,
  AnnotationViewportProvider,
  PreviewPickResult,
  PreviewProjectionResult,
  PreviewWorldPoint,
} from "../preview/types";
import { createPreviewLineOfSight, isPreviewHitOccluded, toPreviewWorldPoint } from "../preview/geometry";
import type { PreviewDisassemblyController } from "../preview/disassembly";
import { createThreeDisassemblyController } from "./disassembly";
import { setThreeExplode, resetThreeExplode } from "./explode";
import { getPortableBasename } from "../../utils/resolve-path";

const DEFAULT_BACKGROUND = new Color("#20242e");
const FOCUS_DIM_OPACITY = 0.242;
const DEFAULT_SHADOW_OPACITY = 0.28;
const MAX_RENDER_PIXEL_RATIO = 2.5;
const DESKTOP_INTERACTIVE_PIXEL_RATIO_CAP = 1.5;
const MOBILE_INTERACTIVE_PIXEL_RATIO_CAP = 1.15;
const INTERACTIVE_PIXEL_RATIO_HOLD_MS = 180;
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

type ShadowCastingLight = DirectionalLight | PointLight | SpotLight;

function isMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

function isShadowCastingLight(light: Light): light is ShadowCastingLight {
  return light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight;
}

function materialList(material: Material | Material[] | undefined | null): Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function triangleCountForMesh(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const indexCount = geometry.getIndex()?.count ?? 0;
  if (indexCount > 0) return Math.floor(indexCount / 3);
  const positionCount = geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(positionCount / 3);
}

function vertexCountForMesh(mesh: Mesh): number {
  return mesh.geometry.getAttribute("position")?.count ?? 0;
}

function describeMaterial(material: Material | null | undefined): string | null {
  if (!material) return null;
  return material.name || material.type || `material-${material.uuid}`;
}

function getObjectDisplayName(object: Object3D, fallback: string): string {
  const originalName = object.userData?.name;
  return typeof originalName === "string" && originalName.trim().length > 0
    ? originalName
    : object.name || fallback;
}

function getObjectComponentPath(root: Object3D, object: Object3D): string {
  const names: string[] = [];
  let current: Object3D | null = object;
  while (current && current !== root) {
    names.push(getObjectDisplayName(current, current.type || `object-${current.id}`));
    current = current.parent;
  }
  return names.reverse().join("/");
}

function getPartDisplayName(identity: PreviewComponentIdentity, fallback: string): string {
  return identity.displayName?.trim() || identity.partNumber || identity.componentId || fallback;
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

function getObjectPreviewBounds(object: Object3D) {
  const box = new Box3().setFromObject(object);
  return createPreviewBounds(
    toPreviewWorldPoint(box.min),
    toPreviewWorldPoint(box.max),
  );
}

export class ThreeModelPreview implements WorkbenchPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
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
  private renderHandle = 0;
  private quality: "low" | "medium" | "high" = "high";
  private renderScale = 1;
  private interactivePixelRatioActive = false;
  private interactionPixelRatioDeadline = 0;
  private renderObserverSettleFrames = RENDER_OBSERVER_SETTLE_FRAMES;
  private frameBudgetPixelRatioScale = 1;
  private frameBudgetSlowStreak = 0;
  private frameBudgetFastStreak = 0;
  private frameBudgetObserverStride = 1;
  private frameBudgetObserverCursor = 0;
  private frameBudgetShadowDeferred = false;
  private lastFrameDurationMs = 0;
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
  private gridHelper: GridHelper | null = null;
  private bboxEnabled = false;
  private wireframeEnabled = false;
  private sceneConfig: SceneConfig = {};
  private focusSelectionEnabled = false;
  private focusedMesh: Mesh | null = null;
  private highlightedMesh: Mesh | null = null;
  private selectionHelper: BoxHelper | null = null;
  private focusHelper: BoxHelper | null = null;
  private mixer: AnimationMixer | null = null;
  private animationPlaying = false;
  private initialTarget = new Vector3();
  private initialPosition = new Vector3(3, 2, 3);
  private initialFov = 45;
  private lastPointerDown: { x: number; y: number } | null = null;
  private readonly originalMaterials = new Map<number, Material | Material[]>();
  private readonly focusDimMaterials = new Map<number, Material | Material[]>();
  private _lastPickResult: PreviewPickResult = { mesh: null, pickedPoint: null, screenX: 0, screenY: 0 };
  private _onPickCallbacks: Array<(result: PreviewPickResult) => void> = [];
  private disassembly: PreviewDisassemblyController | null = null;
  private disassemblySetup = false;
  private renderDirty = true;
  private cachedMeshes: Mesh[] | null = null;
  private cachedMeshRoot: Object3D | null = null;
  private cameraAnimHandle = 0;
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handleControlsChange = () => {
    const now = performance.now();
    this.interactionPixelRatioDeadline = now + INTERACTIVE_PIXEL_RATIO_HOLD_MS;
    if (this.activateInteractivePixelRatio()) {
      this.resizeRenderer();
    }
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
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

    let root: Object3D;
    let animations: import("three").AnimationClip[] = [];

    if (this.loadedExt === "glb" || this.loadedExt === "gltf") {
      const gltfResult = await loadThreeGLTF(data, this.loadedExt, readFile, modelPath);
      root = gltfResult.scene;
      animations = gltfResult.animations;
      this.resourceWarnings = gltfResult.warnings;
    } else if (this.loadedExt === "stl") {
      root = await loadThreeSTL(data);
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
    this.prepareModelForQuality(root);
    this.updateShadowFraming();
    this.syncSceneHelpers();
    this.markDirty();

    if (animations.length > 0) {
      this.mixer = new AnimationMixer(root);
      for (const clip of animations) {
        this.mixer.clipAction(clip).play();
      }
      this.animationPlaying = true;
    }

    const summary = this.computeSummary(root);
    this.fitCameraToObject(root);
    if (this.axesHelper) {
      const size = Math.max(summary.boundingSize.x, summary.boundingSize.y, summary.boundingSize.z) || 1;
      this.axesHelper.scale.setScalar(Math.max(0.5, size * 0.25));
    }
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
    return {
      canvas,
      observeRender: (callback) => {
        this.renderObservers.add(callback);
        return {
          remove: () => this.renderObservers.delete(callback),
        };
      },
      getCameraStateKey: () => this.getAnnotationCameraStateKey(),
      projectWorldPoint: (point, result) => this.projectAnnotationWorldPoint(point, result),
      isWorldPointOccluded: (point) => this.isAnnotationWorldPointOccluded(point),
    };
  }

  exportModelInfo(modelPath?: string): string {
    if (!this.rootObject) return "";
    const summary = this.computeSummary(this.rootObject);
    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    const name = modelPath ? getPortableBasename(modelPath) || summary.rootName : summary.rootName;
    return createPreviewModelInfoMarkdown({
      title: name,
      format: this.loadedExt.toUpperCase(),
      summary,
      meshBreakdown: renderableMeshes.map((mesh) => ({
        name: getObjectDisplayName(mesh, `mesh-${mesh.id}`),
        triangleCount: triangleCountForMesh(mesh),
        vertexCount: vertexCountForMesh(mesh),
        materialName: describeMaterial(materialList(mesh.material)[0]),
      })),
    });
  }

  getModelEvidence(): ModelEvidence | null {
    if (!this.rootObject) return null;
    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    const groupedPartCandidates = this.computeComponentPartSummaries(this.rootObject, renderableMeshes);
    const meshParts = renderableMeshes
      .filter((mesh) => !groupedPartCandidates.groupedMeshes.has(mesh))
      .map((mesh) => this.computePartSummary(mesh));
    const parts = groupedPartCandidates.parts.length > 0 ? [...groupedPartCandidates.parts, ...meshParts] : meshParts;
    const materialNames = new Set<string>();
    for (const mesh of renderableMeshes) {
      for (const material of materialList(mesh.material)) {
        const name = describeMaterial(material);
        if (name) materialNames.add(name);
      }
    }
    return {
      summary: this.computeSummary(this.rootObject),
      parts,
      materialNames: Array.from(materialNames).sort((left, right) => left.localeCompare(right)),
      resourceWarnings: [...this.resourceWarnings],
      capturedAt: new Date().toISOString(),
    };
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    const mesh = this.focusedMesh
      ?? (isMesh(this._lastPickResult.mesh) ? this._lastPickResult.mesh : null);
    return mesh ? this.computePartSummary(mesh) : null;
  }

  exportSelectedPartInfo(): string {
    const part = this.getSelectedPartInfo();
    return part ? createPreviewPartInfoMarkdown(part) : "";
  }

  getPickWorldPoint(result: PreviewPickResult): PreviewWorldPoint | null {
    if (result.pickedPoint && typeof result.pickedPoint === "object") {
      return toPreviewWorldPoint(result.pickedPoint as { x: number; y: number; z: number });
    }

    if (result.mesh instanceof Mesh) {
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
    this.camera.fov = this.initialFov;
    this.camera.position.copy(this.initialPosition);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.initialTarget);
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
      if (this._lastPickResult.mesh instanceof Mesh) {
        this.setFocusedMesh(this._lastPickResult.mesh);
      }
    }
    this.markDirty();
    return this.focusSelectionEnabled;
  }

  isFocusSelectionEnabled(): boolean {
    return this.focusSelectionEnabled;
  }

  toggleWireframe(): boolean {
    this.wireframeEnabled = !this.wireframeEnabled;
    if (!this.rootObject) return this.wireframeEnabled;

    for (const mesh of this.getRenderableMeshes(this.rootObject)) {
      for (const material of materialList(mesh.material)) {
        if ("wireframe" in material) {
          material.wireframe = this.wireframeEnabled;
          material.needsUpdate = true;
        }
      }
    }
    this.markDirty();
    return this.wireframeEnabled;
  }

  toggleOrientationGizmo(): boolean {
    if (!this.axesHelper) {
      this.axesHelper = new AxesHelper(1.2);
      this.axesHelper.visible = false;
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = !this.axesHelper.visible;
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
      viewportVisible: this.viewportVisible,
      disposalAudit: { ...this.lastDisposalAudit },
      meshCount: this.rootObject ? this.getRenderableMeshes(this.rootObject).length : 0,
    };
  }

  setExplode(factor: number, axis: PreviewAxis): void {
    if (!this.rootObject) return;
    setThreeExplode(this.rootObject, factor, axis);
    this.markShadowDirty();
    this.markDirty();
  }

  resetExplode(): void {
    if (!this.rootObject) return;
    resetThreeExplode(this.rootObject);
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
      meshes,
      this.controls,
      () => {
        this.markShadowDirty();
        this.markDirty();
      },
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
        this.cameraAnimHandle = requestAnimationFrame(tick);
      }
    };
    this.cameraAnimHandle = requestAnimationFrame(tick);
  }

  private startRenderLoop(): void {
    if (this.renderHandle || !this.viewportVisible) return;
    const tick = () => {
      if (!this.viewportVisible) {
        this.renderHandle = 0;
        return;
      }
      this.renderHandle = requestAnimationFrame(tick);
      this.renderNow(performance.now());
    };
    this.renderHandle = requestAnimationFrame(tick);
  }

  private renderNow(now: number): void {
    const canvas = this.renderer.domElement;
    if (!this.viewportVisible || !canvas.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;

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
      if (this.renderObserverSettleFrames > 0) {
        this.renderObserverSettleFrames--;
        this.notifyRenderObservers();
      }
      return;
    }
    this.renderDirty = false;
    this.renderObserverSettleFrames = RENDER_OBSERVER_SETTLE_FRAMES;

    this.bboxHelper?.update();
    this.selectionHelper?.update();
    this.focusHelper?.update();
    const renderStartedAt = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.updateFrameBudget(performance.now() - renderStartedAt);
    this.notifyRenderObservers();
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
    if (this.shouldDeferShadowRefresh()) {
      this.frameBudgetShadowDeferred = true;
      return;
    }
    this.frameBudgetShadowDeferred = false;
    this.renderer.shadowMap.needsUpdate = true;
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
    if (this.frameBudgetShadowDeferred) {
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
        this.renderObserverSettleFrames = Math.max(
          RENDER_OBSERVER_SETTLE_MIN_FRAMES,
          Math.floor(RENDER_OBSERVER_SETTLE_FRAMES / this.frameBudgetObserverStride),
        );
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
      this.renderObserverSettleFrames = RENDER_OBSERVER_SETTLE_FRAMES;
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
    this.renderObserverSettleFrames = RENDER_OBSERVER_SETTLE_FRAMES;
    if (changed) {
      this.markDirty();
    }
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private applyCameraConfig(config: CameraConfig): void {
    if (typeof config.fov === "number" && Number.isFinite(config.fov)) {
      this.camera.fov = config.fov;
      this.camera.updateProjectionMatrix();
    }
    if (config.position) {
      this.camera.position.set(...config.position);
    }
    if (config.lookAt) {
      this.controls.target.set(...config.lookAt);
      this.camera.lookAt(this.controls.target);
    }
    if (typeof config.near === "number" && Number.isFinite(config.near)) {
      this.camera.near = config.near;
    }
    if (typeof config.far === "number" && Number.isFinite(config.far)) {
      this.camera.far = config.far;
    }
    if (typeof config.zoom === "number" && Number.isFinite(config.zoom)) {
      this.camera.zoom = config.zoom;
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

  private prepareModelForQuality(root: Object3D): void {
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    root.traverse((object) => {
      if (!isMesh(object)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      for (const material of materialList(object.material)) {
        this.prepareMaterialForQuality(material, anisotropy);
      }
    });
  }

  private prepareMaterialForQuality(material: Material, anisotropy: number): void {
    const record = material as unknown as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value instanceof Texture) {
        value.anisotropy = Math.max(value.anisotropy, anisotropy);
        value.needsUpdate = true;
      }
    }
    material.needsUpdate = true;
  }

  private applyShadowQuality(): void {
    const size = this.shadowMapSize();
    for (const light of this.allLights()) {
      if (!isShadowCastingLight(light) || !light.castShadow) continue;
      light.shadow.mapSize.set(size, size);
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.018;
      light.shadow.needsUpdate = true;
    }
    this.markShadowDirty();
    this.markDirty();
  }

  private updateShadowFraming(): void {
    if (!this.rootObject) return;
    const box = new Box3().setFromObject(this.rootObject);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 1.8;

    for (const light of this.allLights()) {
      if (!isShadowCastingLight(light) || !light.castShadow) continue;
      light.shadow.mapSize.set(this.shadowMapSize(), this.shadowMapSize());
      light.shadow.bias = -0.00012;
      light.shadow.normalBias = 0.018;

      if (light instanceof DirectionalLight) {
        const direction = light.position.clone().sub(light.target.position);
        if (direction.lengthSq() < 0.001) {
          direction.set(4, 7, 5);
        }
        light.target.position.copy(center);
        if (!light.target.parent) {
          this.scene.add(light.target);
        }
        light.position.copy(center).add(direction.normalize().multiplyScalar(radius * 2.4));

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
    }
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
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = visible;
  }

  private createGroundShadow(): void {
    if (!this.rootObject || this.groundShadowMesh) return;
    const bounds = getObjectPreviewBounds(this.rootObject);
    const center = getPreviewBoundsCenter(bounds);
    const boundsSize = getPreviewBoundsSize(bounds);
    const size = Math.max(boundsSize.x, boundsSize.z, 1) * 3;
    const y = bounds.min.y - Math.max(size * 0.002, 0.002);

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
    const bounds = getObjectPreviewBounds(this.rootObject);
    const center = getPreviewBoundsCenter(bounds);
    const boundsSize = getPreviewBoundsSize(bounds);
    const size = Math.max(boundsSize.x, boundsSize.z, 1) * 2;

    const grid = new GridHelper(size, 20, 0x6f7785, 0x343b46);
    grid.name = "ai3d-grid";
    grid.position.set(center.x, bounds.min.y - Math.max(size * 0.003, 0.003), center.z);
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

    const hit = this.raycaster.intersectObjects(this.getRenderableMeshes(this.rootObject), false)[0];
    const mesh = hit?.object instanceof Mesh ? hit.object : null;
    const result: PreviewPickResult = {
      mesh,
      pickedPoint: hit?.point?.clone() ?? null,
      screenX: event.clientX,
      screenY: event.clientY,
    };
    this._lastPickResult = result;
    if (this.focusSelectionEnabled && mesh) {
      this.clearSelectionHighlight();
      if (this.focusedMesh !== mesh) {
        this.setFocusedMesh(mesh);
      }
    } else if (this.focusSelectionEnabled) {
      this.clearSelectionHighlight();
    } else {
      this.updateSelectionHighlight(mesh);
    }
    this._onPickCallbacks.forEach((callback) => callback(result));
  }

  private clearLoadedModel(reason: DisposalReason = "model-switch"): void {
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.invalidateMeshCache();
    this.markDirty();
    this.clearFocusedMesh();
    this.clearSelectionHighlight();
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
      if (!isMesh(object)) return;
      meshCount++;

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

  private fitCameraToObject(root: Object3D): void {
    const bounds = getObjectPreviewBounds(root);
    const fit = createPreviewPerspectiveCameraFit(bounds);
    this.initialTarget.set(fit.target.x, fit.target.y, fit.target.z);
    this.initialPosition.set(fit.position.x, fit.position.y, fit.position.z);
    this.initialFov = 45;
    const boundsSize = getPreviewBoundsSize(bounds);
    const maxSpan = Math.max(boundsSize.x, boundsSize.y, boundsSize.z, 1);
    const fitDistance = this.initialPosition.distanceTo(this.initialTarget);
    this.controls.minDistance = Math.max(fit.near * 4, maxSpan * 0.02, 0.001);
    this.controls.maxDistance = Math.max(fitDistance * 8, this.controls.minDistance * 10);
    this.resetView();
    this.camera.near = fit.near;
    this.camera.far = fit.far;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private getAnnotationCameraStateKey(): string {
    return [
      this.camera.position.x.toFixed(3),
      this.camera.position.y.toFixed(3),
      this.camera.position.z.toFixed(3),
      this.controls.target.x.toFixed(2),
      this.controls.target.y.toFixed(2),
      this.controls.target.z.toFixed(2),
      this.camera.fov.toFixed(2),
    ].join("_");
  }

  private projectAnnotationWorldPoint(point: PreviewWorldPoint, result: PreviewProjectionResult): boolean {
    const canvas = this.renderer.domElement;
    if (!canvas.isConnected || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return false;
    }

    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.annotationProjection.set(point.x, point.y, point.z).project(this.camera);

    if (!Number.isFinite(this.annotationProjection.x)
      || !Number.isFinite(this.annotationProjection.y)
      || !Number.isFinite(this.annotationProjection.z)) {
      return false;
    }

    result.screenX = ((this.annotationProjection.x + 1) / 2) * canvas.clientWidth;
    result.screenY = ((1 - this.annotationProjection.y) / 2) * canvas.clientHeight;
    result.depth = (this.annotationProjection.z + 1) / 2;
    return true;
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

    const hit = this.occlusionRaycaster.intersectObjects(this.getRenderableMeshes(this.rootObject), false)[0];
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

  private invalidateMeshCache(): void {
    this.cachedMeshes = null;
    this.cachedMeshRoot = null;
  }

  private ensureBoundingBoxHelper(): void {
    if (!this.rootObject) return;
    this.bboxHelper?.removeFromParent();
    this.bboxHelper = new BoxHelper(this.rootObject, 0xfacc15);
    this.scene.add(this.bboxHelper);
  }

  private updateSelectionHighlight(mesh: Mesh | null): void {
    if (!this.rootObject || !mesh) {
      this.clearSelectionHighlight();
      return;
    }
    if (this.highlightedMesh === mesh && this.selectionHelper) {
      return;
    }

    this.selectionHelper?.removeFromParent();
    this.selectionHelper = new BoxHelper(mesh, 0x4a9eff);
    this.scene.add(this.selectionHelper);
    this.highlightedMesh = mesh;
    this.markDirty();
  }

  private setFocusedMesh(mesh: Mesh | null): void {
    if (!this.rootObject || !mesh) {
      this.clearFocusedMesh();
      return;
    }
    if (this.focusedMesh === mesh) return;

    const renderableMeshes = this.getRenderableMeshes(this.rootObject);
    if (!renderableMeshes.includes(mesh)) {
      this.clearFocusedMesh();
      return;
    }
    this.restoreFocusedMaterials();
    this.disposeFocusDimMaterials();

    for (const candidate of renderableMeshes) {
      if (!this.originalMaterials.has(candidate.id)) {
        this.originalMaterials.set(candidate.id, candidate.material);
      }

      if (candidate === mesh) {
        candidate.material = this.originalMaterials.get(candidate.id) ?? candidate.material;
        continue;
      }

      const originalMaterial = this.originalMaterials.get(candidate.id) ?? candidate.material;
      const dimMaterial = cloneFocusDimMaterialValue(originalMaterial);
      this.focusDimMaterials.set(candidate.id, dimMaterial);
      candidate.material = dimMaterial;
    }

    this.focusHelper?.removeFromParent();
    this.focusHelper = new BoxHelper(mesh, 0x2ec4ff);
    this.scene.add(this.focusHelper);
    this.focusedMesh = mesh;
    this.markDirty();
  }

  private clearFocusedMesh(): void {
    this.restoreFocusedMaterials();
    this.disposeFocusDimMaterials();
    this.originalMaterials.clear();
    this.focusHelper?.removeFromParent();
    this.focusHelper = null;
    this.focusedMesh = null;
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
    this.highlightedMesh = null;
    this.markDirty();
  }

  private computePartSummary(mesh: Mesh): ModelPartSummary {
    mesh.updateWorldMatrix(true, false);
    const bounds = getObjectPreviewBounds(mesh);
    const name = getObjectDisplayName(mesh, `mesh-${mesh.id}`);
    const identity = extractPreviewComponentIdentity(mesh.userData, {
      name,
      path: this.rootObject ? getObjectComponentPath(this.rootObject, mesh) : name,
    });
    return createPreviewPartSummary({
      name: getPartDisplayName(identity, name),
      triangleCount: triangleCountForMesh(mesh),
      vertexCount: vertexCountForMesh(mesh),
      materialName: describeMaterial(materialList(mesh.material)[0]),
      boundingSize: getPreviewBoundsSize(bounds),
      center: getPreviewBoundsCenter(bounds),
      source: identity.hasExplicitIdentity ? "component" : "mesh",
      meshNames: [name],
      childCount: 1,
      componentId: identity.componentId,
      occurrenceId: identity.occurrenceId,
      partNumber: identity.partNumber,
      componentPath: identity.componentPath,
    });
  }

  private computeComponentPartSummaries(root: Object3D, renderableMeshes: readonly Mesh[]): {
    parts: ModelPartSummary[];
    groupedMeshes: Set<Mesh>;
  } {
    const renderableSet = new Set(renderableMeshes);
    const parts: ModelPartSummary[] = [];
    const groupedMeshes = new Set<Mesh>();
    const candidates: Array<{
      object: Object3D;
      childMeshes: Mesh[];
      identity: PreviewComponentIdentity;
    }> = [];
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (object === root || isMesh(object)) {
        return;
      }
      const childMeshes: Mesh[] = [];
      object.traverse((child) => {
        if (isMesh(child) && renderableSet.has(child)) {
          childMeshes.push(child);
        }
      });
      if (childMeshes.length < 2 || childMeshes.length === renderableMeshes.length) {
        const identity = extractPreviewComponentIdentity(object.userData, {
          name: getObjectDisplayName(object, `component-${object.id}`),
          path: getObjectComponentPath(root, object),
        });
        if (!identity.hasExplicitIdentity || childMeshes.length < 1 || childMeshes.length === renderableMeshes.length) {
          return;
        }
        candidates.push({ object, childMeshes, identity });
        return;
      }
      const identity = extractPreviewComponentIdentity(object.userData, {
        name: getObjectDisplayName(object, `group-${object.id}`),
        path: getObjectComponentPath(root, object),
      });
      if (!identity.hasExplicitIdentity && !object.name.trim()) return;
      candidates.push({ object, childMeshes, identity });
    });

    candidates
      .sort((left, right) => left.childMeshes.length - right.childMeshes.length)
      .forEach(({ object, childMeshes, identity }) => {
        const availableMeshes = childMeshes.filter((mesh) => !groupedMeshes.has(mesh));
        if (availableMeshes.length < 1) return;
        if (!identity.hasExplicitIdentity && availableMeshes.length < 2) return;
        for (const mesh of availableMeshes) {
          groupedMeshes.add(mesh);
        }
      const bounds = new Box3();
      for (const mesh of availableMeshes) {
        mesh.updateWorldMatrix(true, false);
        bounds.union(new Box3().setFromObject(mesh));
      }
      const materialNames = new Set<string>();
      let triangleCount = 0;
      let vertexCount = 0;
      for (const mesh of availableMeshes) {
        triangleCount += triangleCountForMesh(mesh);
        vertexCount += vertexCountForMesh(mesh);
        for (const material of materialList(mesh.material)) {
          const name = describeMaterial(material);
          if (name) materialNames.add(name);
        }
      }
      parts.push(createPreviewPartSummary({
        name: getPartDisplayName(identity, getObjectDisplayName(object, `group-${object.id}`)),
        triangleCount,
        vertexCount,
        materialName: materialNames.size === 0
          ? null
          : materialNames.size === 1
            ? Array.from(materialNames)[0]
            : `${materialNames.size} materials`,
        boundingSize: getPreviewBoundsSize({
          min: toPreviewWorldPoint(bounds.min),
          max: toPreviewWorldPoint(bounds.max),
        }),
        center: getPreviewBoundsCenter({
          min: toPreviewWorldPoint(bounds.min),
          max: toPreviewWorldPoint(bounds.max),
        }),
        source: identity.hasExplicitIdentity ? "component" : "group",
        meshNames: availableMeshes.map((mesh) => getObjectDisplayName(mesh, `mesh-${mesh.id}`)),
        childCount: availableMeshes.length,
        componentId: identity.componentId,
        occurrenceId: identity.occurrenceId,
        partNumber: identity.partNumber,
        componentPath: identity.componentPath,
      }));
      });
    return { parts, groupedMeshes };
  }

  private computeSummary(root: Object3D): ModelPreviewSummary {
    const renderableMeshes = this.getRenderableMeshes(root);
    return createPreviewModelSummary({
      rootName: root.name || "__root__",
      boundingSize: getPreviewBoundsSize(getObjectPreviewBounds(root)),
      meshes: renderableMeshes.map((mesh) => ({
        triangleCount: triangleCountForMesh(mesh),
        vertexCount: vertexCountForMesh(mesh),
        materialKeys: materialList(mesh.material).map((material) => material.uuid),
      })),
      resourceWarnings: this.resourceWarnings,
    });
  }
}

export function createThreeModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new ThreeModelPreview(canvas);
}
