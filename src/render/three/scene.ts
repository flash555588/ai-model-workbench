import {
  AmbientLight,
  AnimationMixer,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  Group,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  AxesHelper,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  loadThreeGLTF,
  loadThreeSTL,
  loadThreePLY,
  loadThreeOBJ,
} from "./loaders";
import type {
  CameraConfig,
  ModelPartSummary,
  ModelPreviewSummary,
  SceneConfig,
  ThreeDBlockConfig,
} from "../../domain/models";
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
const FOCUS_DIM_OPACITY = 0.22;

function isMesh(value: Object3D): value is Mesh {
  return value instanceof Mesh;
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
  private readonly gltfLoader = new GLTFLoader();
  private rootObject: Object3D | null = null;
  private loadedExt = "";
  private renderHandle = 0;
  private quality: "low" | "medium" | "high" = "high";
  private renderScale = 1;
  private axesHelper: AxesHelper | null = null;
  private bboxHelper: BoxHelper | null = null;
  private bboxEnabled = false;
  private wireframeEnabled = false;
  private focusSelectionEnabled = false;
  private focusedMesh: Mesh | null = null;
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
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handlePointerDown = (event: PointerEvent) => {
    this.lastPointerDown = { x: event.clientX, y: event.clientY };
  };
  private readonly handlePointerUp = (event: PointerEvent) => {
    const down = this.lastPointerDown;
    this.lastPointerDown = null;
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    this.dispatchPick(event);
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(this.initialFov, 1, 0.01, 2000);
    this.camera.position.copy(this.initialPosition);
    this.camera.lookAt(this.initialTarget);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.target.copy(this.initialTarget);

    this.scene.add(new AmbientLight(0xffffff, 1.8));
    const keyLight = new DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(4, 8, 6);
    this.scene.add(keyLight);

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
    if (config.scene) this.applySceneConfig(config.scene);
  }

  destroy(): void {
    cancelAnimationFrame(this.renderHandle);
    this._onPickCallbacks = [];
    this.renderObservers.clear();
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.clearFocusedMesh();
    this.clearSelectionHighlight();
    this.clearLoadedModel();
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
      ?? (this._lastPickResult.mesh instanceof Mesh ? this._lastPickResult.mesh : null);
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
    this.clearFocusedMesh();
    this.camera.fov = this.initialFov;
    this.camera.position.copy(this.initialPosition);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
  }

  toggleFocusSelection(): boolean {
    this.focusSelectionEnabled = !this.focusSelectionEnabled;
    if (!this.focusSelectionEnabled) {
      this.clearFocusedMesh();
      this.updateSelectionHighlight(this._lastPickResult.mesh instanceof Mesh ? this._lastPickResult.mesh : null);
    } else if (this._lastPickResult.mesh instanceof Mesh) {
      this.clearSelectionHighlight();
      this.setFocusedMesh(this._lastPickResult.mesh);
    } else {
      this.clearSelectionHighlight();
    }
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
    return this.wireframeEnabled;
  }

  toggleOrientationGizmo(): boolean {
    if (!this.axesHelper) {
      this.axesHelper = new AxesHelper(1.2);
      this.axesHelper.visible = false;
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = !this.axesHelper.visible;
    return this.axesHelper.visible;
  }

  toggleBoundingBox(): boolean {
    this.bboxEnabled = !this.bboxEnabled;
    if (!this.bboxEnabled) {
      this.bboxHelper?.removeFromParent();
      this.bboxHelper = null;
      return false;
    }

    this.ensureBoundingBoxHelper();
    return !!this.bboxHelper;
  }

  hasAnimations(): boolean {
    return this.mixer !== null;
  }

  toggleAnimation(): boolean {
    if (!this.mixer) return false;
    this.animationPlaying = !this.animationPlaying;
    this.mixer.timeScale = this.animationPlaying ? 1 : 0;
    return this.animationPlaying;
  }

  setRenderQuality(quality: "low" | "medium" | "high", renderScale = this.renderScale): void {
    this.quality = quality;
    this.renderScale = renderScale;
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
  }

  resetExplode(): void {
    if (!this.rootObject) return;
    resetThreeExplode(this.rootObject);
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
    const enabled = this.disassembly.toggle();
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
    );
  }

  private animateCamera(targetPos: Vector3, targetLookAt: Vector3): void {
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

      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
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

    this.controls.update();
    if (this.mixer && this.animationPlaying) {
      this.mixer.update(deltaSeconds);
    }
    this.bboxHelper?.update();
    this.selectionHelper?.update();
    this.focusHelper?.update();
    this.renderer.render(this.scene, this.camera);
    for (const callback of this.renderObservers) {
      callback();
    }
  }

  private resizeRenderer(): void {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const qualityScale = this.quality === "low" ? 0.5 : this.quality === "medium" ? 0.75 : 1;
    this.renderer.setPixelRatio(window.devicePixelRatio * qualityScale * this.renderScale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applyCameraConfig(config: CameraConfig): void {
    if (typeof config.fov === "number" && Number.isFinite(config.fov)) {
      this.camera.fov = config.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private applySceneConfig(config: SceneConfig): void {
    if (config.transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(DEFAULT_BACKGROUND, 0);
    } else if (config.background) {
      this.scene.background = new Color(config.background);
      this.renderer.setClearColor(new Color(config.background), 1);
    } else {
      this.scene.background = DEFAULT_BACKGROUND;
      this.renderer.setClearColor(DEFAULT_BACKGROUND, 1);
    }

    if (typeof config.autoRotate === "boolean") {
      this.controls.autoRotate = config.autoRotate;
    }
    if (typeof config.autoRotateSpeed === "number") {
      this.controls.autoRotateSpeed = config.autoRotateSpeed;
    }
    if (typeof config.axis === "boolean") {
      if (!this.axesHelper) {
        this.axesHelper = new AxesHelper(1.2);
        this.scene.add(this.axesHelper);
      }
      this.axesHelper.visible = config.axis;
    }
  }

  private dispatchPick(event: PointerEvent): void {
    if (!this.rootObject) return;

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
      this.setFocusedMesh(mesh);
    } else if (this.focusSelectionEnabled) {
      this.clearFocusedMesh();
    } else {
      this.updateSelectionHighlight(mesh);
    }
    this._onPickCallbacks.forEach((callback) => callback(result));
  }

  private clearLoadedModel(): void {
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblySetup = false;
    this.clearFocusedMesh();
    this.clearSelectionHighlight();
    this.bboxHelper?.removeFromParent();
    this.bboxHelper = null;
    this.bboxEnabled = false;
    this.mixer = null;
    this.animationPlaying = false;
    if (!this.rootObject) return;

    this.scene.remove(this.rootObject);
    this.rootObject.traverse((object) => {
      if (!isMesh(object)) return;
      object.geometry.dispose();
      for (const material of materialList(object.material)) {
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
    const meshes: Mesh[] = [];
    root.traverse((object) => {
      if (isMesh(object) && object.geometry) {
        meshes.push(object);
      }
    });
    return meshes;
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

    this.selectionHelper?.removeFromParent();
    this.selectionHelper = new BoxHelper(mesh, 0x4a9eff);
    this.scene.add(this.selectionHelper);
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

      candidate.material = materialList(this.originalMaterials.get(candidate.id) as Material | Material[]).map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = FOCUS_DIM_OPACITY;
        clone.needsUpdate = true;
        return clone;
      });
    }

    this.focusHelper?.removeFromParent();
    this.focusHelper = new BoxHelper(mesh, 0x2ec4ff);
    this.scene.add(this.focusHelper);
    this.focusedMesh = mesh;
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
  }

  private clearSelectionHighlight(): void {
    this.selectionHelper?.removeFromParent();
    this.selectionHelper = null;
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
