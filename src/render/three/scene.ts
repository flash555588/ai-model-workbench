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
const FOCUS_DIM_OPACITY = 0.68;
const FOCUS_DIM_TINT = new Color("#dfe3ea");
const FOCUS_DIM_TINT_MIX = 0.12;
const DEFAULT_SHADOW_OPACITY = 0.28;

type ShadowCastingLight = DirectionalLight | PointLight | SpotLight;

function isMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

function isDisposable(value: unknown): value is { dispose(): void } {
  return !!value && typeof value === "object" && "dispose" in value && typeof value.dispose === "function";
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

function createFocusDimMaterial(material: Material): Material {
  const clone = material.clone();
  const record = clone as unknown as { color?: unknown };
  clone.transparent = true;
  clone.opacity = FOCUS_DIM_OPACITY;
  clone.depthWrite = false;
  if (record.color instanceof Color) {
    record.color.lerp(FOCUS_DIM_TINT, FOCUS_DIM_TINT_MIX);
  }
  clone.needsUpdate = true;
  return clone;
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
  private renderHandle = 0;
  private quality: "low" | "medium" | "high" = "high";
  private renderScale = 1;
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
  private readonly originalMaterialFlags = new Map<number, { transparent: boolean; opacity: number }[]>();
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
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
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
    this.controls.screenSpacePanning = true;
    this.controls.target.copy(this.initialTarget);

    this.installDefaultLighting();

    this.resizeObs = new ResizeObserver(() => this.resizeRenderer());
    this.resizeObs.observe(canvas);
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
    this.clearLoadedModel();
    this.loadedExt = ext.toLowerCase();

    let root: Object3D;
    let animations: import("three").AnimationClip[] = [];

    if (this.loadedExt === "glb" || this.loadedExt === "gltf") {
      const gltfResult = await loadThreeGLTF(data, this.loadedExt, readFile, modelPath);
      root = gltfResult.scene;
      animations = gltfResult.animations;
    } else if (this.loadedExt === "stl") {
      root = await loadThreeSTL(data);
    } else if (this.loadedExt === "ply") {
      root = await loadThreePLY(data);
    } else if (this.loadedExt === "obj") {
      root = await loadThreeOBJ(data, readFile, modelPath);
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
    this.clearLoadedModel();
    for (const light of this.configLights) {
      this.disposeConfiguredLight(light);
    }
    this.configLights.length = 0;
    for (const light of this.defaultLights) {
      this.disposeConfiguredLight(light);
    }
    this.defaultLights.length = 0;
    this.disposeGlobalEnvironment();
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("wheel", this.preventCanvasWheelScroll);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.resizeObs.disconnect();
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
        name: mesh.name || `mesh-${mesh.id}`,
        triangleCount: triangleCountForMesh(mesh),
        vertexCount: vertexCountForMesh(mesh),
        materialName: describeMaterial(materialList(mesh.material)[0]),
      })),
    });
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

  setExplode(factor: number, axis: PreviewAxis): void {
    if (!this.rootObject) return;
    setThreeExplode(this.rootObject, factor, axis);
    this.markDirty();
  }

  resetExplode(): void {
    if (!this.rootObject) return;
    resetThreeExplode(this.rootObject);
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
      () => this.markDirty(),
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
    const tick = () => {
      this.renderNow(performance.now());
      this.renderHandle = requestAnimationFrame(tick);
    };
    this.renderHandle = requestAnimationFrame(tick);
  }

  private renderNow(now: number): void {
    const canvas = this.renderer.domElement;
    if (!canvas.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;

    const deltaSeconds = Math.max(0, (now - this.clock.last) / 1000);
    this.clock.last = now;

    const cameraMoved = this.controls.update();
    const animating = !!this.mixer && this.animationPlaying;
    if (animating && this.mixer) {
      this.mixer.update(deltaSeconds);
    }

    if (!cameraMoved && !animating && !this.renderDirty) {
      this.notifyRenderObservers();
      return;
    }
    this.renderDirty = false;

    this.bboxHelper?.update();
    this.selectionHelper?.update();
    this.focusHelper?.update();
    this.renderer.render(this.scene, this.camera);
    this.notifyRenderObservers();
  }

  private notifyRenderObservers(): void {
    for (const callback of this.renderObservers) {
      callback();
    }
  }

  private markDirty(): void {
    this.renderDirty = true;
  }

  private resizeRenderer(): void {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const qualityScale = this.quality === "low" ? 0.5 : this.quality === "medium" ? 0.75 : 1;
    const mobileScale = isMobile() ? 0.85 : 1;
    const pixelRatio = Math.min(2.5, window.devicePixelRatio * qualityScale * mobileScale * this.renderScale);
    this.renderer.setPixelRatio(pixelRatio);
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
      if (this.focusedMesh) {
        this.clearFocusedMesh();
      }
    } else {
      this.updateSelectionHighlight(mesh);
    }
    this._onPickCallbacks.forEach((callback) => callback(result));
  }

  private clearLoadedModel(): void {
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
    if (!this.rootObject) return;

    this.scene.remove(this.rootObject);
    this.rootObject.traverse((object) => {
      if (!isMesh(object)) return;
      object.geometry.dispose();
      for (const material of materialList(object.material)) {
        const mat = material as unknown as Record<string, unknown>;
        for (const key of Object.keys(mat)) {
          const value = mat[key];
          if (isDisposable(value)) {
            value.dispose();
          }
        }
        material.dispose();
      }
    });
    this.rootObject = null;
  }

  private fitCameraToObject(root: Object3D): void {
    const fit = createPreviewPerspectiveCameraFit(getObjectPreviewBounds(root));
    this.initialTarget.set(fit.target.x, fit.target.y, fit.target.z);
    this.initialPosition.set(fit.position.x, fit.position.y, fit.position.z);
    this.initialFov = 45;
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
    if (!this.rootObject || !mesh) return;
    const renderableMeshes = this.getRenderableMeshes(this.rootObject);

    for (const candidate of renderableMeshes) {
      if (!this.originalMaterials.has(candidate.id)) {
        this.originalMaterials.set(candidate.id, candidate.material);
        this.originalMaterialFlags.set(
          candidate.id,
          materialList(candidate.material).map((material) => ({
            transparent: material.transparent,
            opacity: material.opacity,
          })),
        );
      }

      if (candidate === mesh) {
        candidate.material = this.originalMaterials.get(candidate.id) ?? candidate.material;
        materialList(candidate.material).forEach((material, index) => {
          const flags = this.originalMaterialFlags.get(candidate.id)?.[index];
          if (!flags) return;
          material.transparent = flags.transparent;
          material.opacity = flags.opacity;
          material.needsUpdate = true;
        });
        continue;
      }

      candidate.material = materialList(this.originalMaterials.get(candidate.id) as Material | Material[])
        .map(createFocusDimMaterial);
    }

    this.focusHelper?.removeFromParent();
    this.focusHelper = new BoxHelper(mesh, 0x2ec4ff);
    this.scene.add(this.focusHelper);
    this.focusedMesh = mesh;
    this.markDirty();
  }

  private clearFocusedMesh(): void {
    if (this.rootObject) {
      for (const mesh of this.getRenderableMeshes(this.rootObject)) {
        const originalMaterial = this.originalMaterials.get(mesh.id);
        if (originalMaterial) {
          materialList(mesh.material).forEach((material) => {
            if (material !== originalMaterial && !materialList(originalMaterial).includes(material)) {
              material.dispose();
            }
          });
          mesh.material = originalMaterial;
          materialList(mesh.material).forEach((material, index) => {
            const flags = this.originalMaterialFlags.get(mesh.id)?.[index];
            if (!flags) return;
            material.transparent = flags.transparent;
            material.opacity = flags.opacity;
            material.needsUpdate = true;
          });
        }
      }
    }

    this.originalMaterials.clear();
    this.originalMaterialFlags.clear();
    this.focusHelper?.removeFromParent();
    this.focusHelper = null;
    this.focusedMesh = null;
    this.markDirty();
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
    return createPreviewPartSummary({
      name: mesh.name || `mesh-${mesh.id}`,
      triangleCount: triangleCountForMesh(mesh),
      vertexCount: vertexCountForMesh(mesh),
      materialName: describeMaterial(materialList(mesh.material)[0]),
      boundingSize: getPreviewBoundsSize(bounds),
      center: getPreviewBoundsCenter(bounds),
    });
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
    });
  }
}

export function createThreeModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new ThreeModelPreview(canvas);
}
