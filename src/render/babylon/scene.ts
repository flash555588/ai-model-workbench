import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import { AutoRotationBehavior } from "@babylonjs/core/Behaviors/Cameras/autoRotationBehavior.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Light } from "@babylonjs/core/Lights/light.js";
import type { IShadowLight } from "@babylonjs/core/Lights/shadowLight.js";
import type {
  ModelPreviewSummary,
  ModelEvidence,
  ModelPartSummary,
  CameraConfig,
  LightConfig,
  SceneConfig,
  ThreeDBlockConfig,
} from "../../domain/models";
import "./loaders/register";
import { ensureLoadersRegistered } from "./loaders/register";
import { loadSTLBuffer } from "./loaders/stl-loader";
import { loadPLYBuffer } from "./loaders/ply-loader";
import { setExplode, resetExplode } from "./explode";
import { setupPicking, type PickingCleanup } from "./picking";
import { arrayBufferToBase64 } from "../../utils/base64";
import { isMobile } from "../../utils/device";
import { getPortableBasename, getPortableDirname, getPortableStem, joinPortablePath } from "../../utils/resolve-path";
import { OrientationGizmo } from "./orientation-gizmo";
import { createBabylonDisassemblyController } from "./disassembly";
import {
  collectBabylonGltfComponentMetadata,
  createBabylonGroupedPartCandidates,
  createBabylonMeshInfoBreakdown,
  createBabylonModelPreviewSummary,
  createBabylonNodePartPreviewSummary,
  createBabylonPartPreviewSummary,
  findBabylonSelectablePartNode,
  getBabylonMeshesPreviewBounds,
  getBabylonNodeDisplayName,
  type BabylonSelectablePartNode,
  getBabylonRenderableMeshes,
  getBabylonRenderablePreviewBounds,
  getBabylonVertexCount,
} from "./mesh-preview";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsMaxSpan,
  getPreviewBoundsRadius,
  getPreviewBoundsSize,
  type PreviewBounds,
} from "../preview/bounds";
import { createPreviewOrbitCameraFit } from "../preview/camera-fit";
import type { PreviewDisassemblyController } from "../preview/disassembly";
import {
  createAnnotationViewportProvider,
  formatAnnotationCameraStateKey,
  projectViewportPointToCanvas,
} from "../preview/annotation-projection";
import { createPreviewEvidence } from "../preview/evidence";
import {
  createPreviewLineOfSight,
  isPreviewHitOccluded,
  normalizePreviewWorldPoint,
  toPreviewWorldPoint,
} from "../preview/geometry";
import {
  createPreviewModelInfoMarkdown,
  createPreviewPartInfoMarkdown,
} from "../preview/report";
import type {
  AnnotationViewportProvider,
  PreviewAxis,
  PreviewPickResult,
  PreviewProjectionResult,
  PreviewWorldPoint,
  PreviewEulerDegrees,
  MeasurementScale,
  MeasurementSnapKind,
  MeasurementUnit,
  MeasurementState,
  CameraZoomState,
  WorkbenchPreview,
  SliceInteractionMode,
  SliceState,
} from "../preview/types";
import {
  isPreviewLoadInterruptedError,
  throwIfPreviewLoadInterrupted,
  type PreviewLoadOptions,
} from "../preview/load-control";
import {
  createMeasurementLabel,
  createMeasurementDraftingLayout,
  createMeasurementGeometryEdgesFromTriangles,
  createMeasurementMarkdown,
  createMeasurementReading as buildMeasurementReading,
  createMeasurementState,
  createMeasurementTrianglesFromIndices,
  createMeasurementVertexSnapRadius,
  drawMeasurementLabelCanvas,
  MEASUREMENT_LABEL_CANVAS,
  normalizeMeasurementUnit,
  sanitizeMeasurementScale,
  scaleMeasurementPointFromBase,
  setMeasurementCanvasActive,
  snapMeasurementPointToGeometry,
  unscaleMeasurementPointToBase,
  type MeasurementGeometrySnapInput,
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

/** Guard against concurrent OBJ loads monkey-patching the same prototype. */
let objMtlLock: Promise<void> | null = null;
const OBJ_IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];
const OBJ_TEXTURE_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/i;
const FOCUS_DIM_VISIBILITY = 0.242;
const FOCUS_WORLD_POINT_ANIMATION_MS = 320;
const MEASUREMENT_LINE_COLOR = new Color3(0.97, 0.98, 0.99);
const MEASUREMENT_MARKER_COLOR = new Color3(0.97, 0.98, 0.99);
const MEASUREMENT_PENDING_COLOR = new Color3(0.96, 0.62, 0.04);
const MEASUREMENT_HOVER_COLOR = new Color3(1, 1, 1);
const MEASUREMENT_PREVIEW_COLOR = new Color3(0.9, 0.91, 0.92);
const SLICE_PLANE_COLOR = new Color3(0.22, 0.74, 0.97);
const SLICE_FRAME_COLOR = new Color3(0.58, 0.77, 0.99);
const SLICE_CENTER_FRAME_COLOR = new Color3(0.88, 0.95, 1);
const SLICE_ROTATE_PLANE_COLOR = new Color3(0.96, 0.62, 0.04);
const SLICE_ROTATE_FRAME_COLOR = new Color3(0.99, 0.83, 0.3);
const SLICE_GIZMO_X_COLOR = new Color3(0.94, 0.27, 0.27);
const SLICE_GIZMO_Y_COLOR = new Color3(0.13, 0.77, 0.37);
const SLICE_GIZMO_Z_COLOR = new Color3(0.23, 0.51, 0.96);
const SLICE_GIZMO_ACTIVE_COLOR = new Color3(0.97, 0.98, 0.99);
const SLICE_MOVE_COLOR = new Color3(0.98, 0.8, 0.08);
const SLICE_PLANE_ALPHA = 0.32;

type BabylonMeasurementSegment = { start: Vector3; end: Vector3; line: LinesMesh; label: Mesh };
type BabylonSliceDragStateBase = {
  pointerId: number;
  startX: number;
  startY: number;
  mode: SliceInteractionMode;
  moved: boolean;
};
type BabylonSliceDragState = BabylonSliceDragStateBase & ({
  mode: "move";
  startOffset: number;
  screenAxis: { x: number; y: number };
  pixelsToOffset: number;
} | {
  mode: "rotate";
  axis: PreviewAxis;
  startNormal: PreviewWorldPoint;
  anchorPoint: PreviewWorldPoint;
  rotationAxis: PreviewWorldPoint;
  startPlaneX: PreviewWorldPoint;
  startPlaneY: PreviewWorldPoint;
  screenTangent: { x: number; y: number };
  radiansPerPixel: number;
  rotationRadians: number;
  startPointerAngle: number;
  currentPointerAngle: number;
  snapMode: SliceRotationSnapMode;
  useScreenRotation: boolean;
  labelPoint: PreviewWorldPoint;
});
type BabylonSlicePointerTarget = {
  mode: "move";
} | {
  mode: "rotate";
  axis: PreviewAxis;
  screenTangent: { x: number; y: number };
  radiansPerPixel: number;
  labelPoint: PreviewWorldPoint;
};
type BabylonSlicePointerSample = {
  pointerId: number;
  clientX: number;
  clientY: number;
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
type BabylonMaterialClippingSnapshot = {
  material: Material;
  clipPlane: Material["clipPlane"];
  clipPlane2: Material["clipPlane2"];
};

function isShadowLight(light: Light): light is IShadowLight {
  const className = light.getClassName();
  return className === "DirectionalLight" || className === "PointLight" || className === "SpotLight";
}

function isGaussianSplattingMesh(mesh: AbstractMesh): boolean {
  return mesh.getClassName() === "GaussianSplattingMesh";
}

function isBabylonMesh(value: unknown): value is AbstractMesh {
  return !!value && typeof value === "object" && "getBoundingInfo" in value;
}

function isBabylonSelectablePartNode(value: unknown): value is BabylonSelectablePartNode {
  return value instanceof TransformNode;
}

function isBabylonNodeDisposed(node: BabylonSelectablePartNode): boolean {
  return typeof node.isDisposed === "function" ? node.isDisposed() : false;
}

function isBabylonNodeOrDescendant(candidate: AbstractMesh, target: BabylonSelectablePartNode): boolean {
  let current: TransformNode | null = candidate;
  while (current) {
    if (current === target) return true;
    current = current.parent as TransformNode | null;
  }
  return false;
}

function disposeBabylonLoadedNodes(
  meshes: readonly AbstractMesh[],
  transformNodes: readonly TransformNode[] = [],
): void {
  for (const mesh of meshes) {
    if (!mesh.isDisposed()) {
      mesh.dispose(true, true);
    }
  }
  for (const node of transformNodes) {
    if (!node.isDisposed()) {
      node.dispose(false, true);
    }
  }
}

function toBabylonVector3(value: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function createMeasurementMarkerMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial("measure-marker-mat", scene);
  mat.diffuseColor = MEASUREMENT_MARKER_COLOR.clone();
  mat.emissiveColor = MEASUREMENT_MARKER_COLOR.clone();
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.alpha = 0.48;
  return mat;
}

function setMeasurementMarkerColor(marker: Mesh, color: Color3): void {
  const mat = marker.material as StandardMaterial | null;
  if (!mat) return;
  mat.diffuseColor = color.clone();
  mat.emissiveColor = color.clone();
}

function firstMtlPath(value: string): string {
  const trimmed = value.replace(/\s+#.*$/, "").trim();
  if (trimmed.startsWith("\"")) {
    const end = trimmed.indexOf("\"", 1);
    if (end > 1) return trimmed.slice(1, end);
  }
  return trimmed;
}

function firstTexturePath(value: string): string {
  const tokens = value.trim().split(/\s+/);
  const pathStart = tokens.findIndex((token) => !token.startsWith("-") && !/^[-+]?\d*\.?\d+$/.test(token));
  return tokens.slice(Math.max(0, pathStart)).join(" ").replace(/^"|"$/g, "");
}

function guessTextureMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tga") return "image/x-tga";
  if (ext === "webp") return "image/webp";
  return `image/${ext}`;
}

function buildObjTextureCandidates(modelDir: string, rawPath: string, modelPath: string): string[] {
  const texFilename = getPortableBasename(rawPath);
  const texBase = texFilename.replace(/\.[^.]+$/, "");
  const objBasename = getPortableStem(modelPath);
  const candidates = [
    joinPortablePath(modelDir, rawPath),
    joinPortablePath(modelDir, texFilename),
  ];
  if (objBasename) {
    for (const ext of OBJ_IMAGE_EXTS) {
      candidates.push(joinPortablePath(modelDir, `${objBasename}.${ext}`));
    }
  }
  for (const ext of OBJ_IMAGE_EXTS) {
    const alt = `${texBase}.${ext}`;
    if (alt !== texFilename) {
      candidates.push(joinPortablePath(modelDir, alt));
    }
  }
  return candidates;
}

// TODO(P2): split this class into loader/camera/light/annotation helpers.
// Scene class is >1,700 lines and mixes rendering, interaction, and fallback logic (debt: renderer-babylon).
export class BabylonModelPreview implements WorkbenchPreview {
  private static readonly annotationIdentity = Matrix.Identity();
  private static readonly annotationWorldPoint = Vector3.Zero();
  private static readonly annotationProjection = Vector3.Zero();
  private static readonly annotationDirection = Vector3.Zero();
  private static readonly annotationRay = new Ray(Vector3.Zero(), Vector3.Zero(), 1);
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private rootMesh: Mesh | null = null;
  private loadedMeshes: AbstractMesh[] = [];
  private loadedTransformNodes: TransformNode[] = [];
  private cachedRenderableMeshes: AbstractMesh[] | null = null;
  private cachedRenderableRoot: Mesh | null = null;
  private loadedExt: string = "";
  private rendering = false;
  private contextLost = false;
  private viewportVisible = true;
  private viewportObserver: IntersectionObserver | null = null;
  private cleanupPicking: PickingCleanup | null = null;
  private resizeObs: ResizeObserver;
  private configLights: Light[] = [];
  private shadowGenerator: ShadowGenerator | null = null;
  private groundMesh: Mesh | null = null;
  private gridMesh: Mesh | null = null;
  private axisMeshes: Mesh[] = [];
  private autoRotateBehavior: AutoRotationBehavior | null = null;
  private sliceAutoRotatePaused = false;
  private wireframeEnabled = false;
  private sliceActive = false;
  private sliceNormal = new Vector3(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
  private slicePlaneX = new Vector3(1, 0, 0);
  private slicePlaneY = new Vector3(0, 0, -1);
  private sliceCenter: Vector3 | null = null;
  private sliceReferenceNormal = new Vector3(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
  private sliceOffset = DEFAULT_SLICE_OFFSET;
  private sliceInteractionMode: SliceInteractionMode = DEFAULT_SLICE_INTERACTION_MODE;
  private sliceThickness = DEFAULT_SLICE_THICKNESS;
  private slicePlane: Plane | null = null;
  private sliceOverlayPlanes: Mesh[] = [];
  private sliceOverlayLines: LinesMesh[] = [];
  private sliceOverlayLabels: Mesh[] = [];
  private sliceRotationLabel: Mesh | null = null;
  private sliceRotationLabelText = "";
  private sliceDragState: BabylonSliceDragState | null = null;
  private pendingSliceMove: BabylonSlicePointerSample | null = null;
  private sliceMoveFrame = 0;
  private readonly sliceObservers = new Set<() => void>();
  private readonly sliceOriginalMaterialClipping = new Map<number, BabylonMaterialClippingSnapshot>();
  private gizmo: OrientationGizmo | null = null;
  private gizmoEnabled = false;
  private disassembly: PreviewDisassemblyController | null = null;
  private focusSelectionEnabled = false;
  private focusedNode: BabylonSelectablePartNode | null = null;
  private readonly originalMeshVisibility = new Map<number, number>();
  private bboxMesh: Mesh | null = null;
  private bboxEnabled = false;
  private currentQuality: "low" | "medium" | "high" = "high";
  private renderScale = 1;
  private resourceWarnings: string[] = [];
  private gltfComponentMetadata = new Map<string, unknown>();
  private animPlaying = false;
  private initialCamera = { alpha: Math.PI / 4, beta: Math.PI / 3, radius: 5, target: Vector3.Zero() };
  private focusWorldPointFrame = 0;
  private _lastPickResult: PreviewPickResult = { mesh: null, pickedPoint: null, screenX: 0, screenY: 0 };
  private _onPickCallbacks: Array<(result: PreviewPickResult) => void> = [];
  private measurementActive = false;
  private measurementScale: MeasurementScale = { x: 1, y: 1, z: 1 };
  private measurementBaseRootScaling = new Vector3(1, 1, 1);
  private measurementBaseBounds: PreviewBounds | null = null;
  private measurementUnit: MeasurementUnit = "mm";
  private measurementSegments: BabylonMeasurementSegment[] = [];
  private measurementMarkers: Mesh[] = [];
  private measurementMarkerPoints: Vector3[] = [];
  private measurementTargetNode: BabylonSelectablePartNode | null = null;
  private measurementTargetMeshes: AbstractMesh[] = [];
  private measurementSnapInputCache: MeasurementGeometrySnapInput | null = null;
  private measurementSnapInputCacheTargetId: number | null = null;
  private measurementSnapInputCacheSignature: string | null = null;
  private measurementSnapKind: MeasurementSnapKind | null = null;
  private readonly measurementObservers = new Set<() => void>();
  private pendingPoint: Vector3 | null = null;
  private pendingMarker: Mesh | null = null;
  private hoveredMarkerIndex = -1;
  private lastPointerClient = { x: 0, y: 0, altKey: false };
  private previewLine: LinesMesh | null = null;
  private readonly cameraZoomObservers = new Set<(state: CameraZoomState | null) => void>();
  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (this.sliceActive) {
      this.beginSliceDrag(event);
    }
  };
  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    this.endSliceDrag(event);
  };
  private readonly handlePointerMove = (event: PointerEvent) => {
    this.lastPointerClient = { x: event.clientX, y: event.clientY, altKey: event.altKey };
    if (this.updateSliceDrag(event)) return;
    if (!this.measurementActive) return;
    if (this.pendingPoint) {
      this.updatePreviewLine();
    }
    if (this.measurementMarkers.length === 0) return;
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const pickResult = this.scene.pick(x, y, (mesh) => this.measurementMarkers.includes(mesh as Mesh));
    const newHover = pickResult.hit ? this.measurementMarkers.indexOf(pickResult.pickedMesh as Mesh) : -1;
    if (newHover !== this.hoveredMarkerIndex) {
      if (this.hoveredMarkerIndex >= 0 && this.hoveredMarkerIndex < this.measurementMarkers.length) {
        const prev = this.measurementMarkers[this.hoveredMarkerIndex];
        if (prev !== this.pendingMarker) {
          prev.scaling.setAll(1);
          setMeasurementMarkerColor(prev, MEASUREMENT_MARKER_COLOR);
        }
      }
      if (newHover >= 0 && newHover < this.measurementMarkers.length) {
        const next = this.measurementMarkers[newHover];
        next.scaling.setAll(1.6);
        setMeasurementMarkerColor(next, MEASUREMENT_HOVER_COLOR);
      }
      this.hoveredMarkerIndex = newHover;
    }
  };
  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.endSliceDrag(event, true);
  };
  private readonly handlePointerCaptureLost = (event: PointerEvent) => {
    this.endSliceDrag(event, true);
  };
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handleMeasurementModifierKey = (event: KeyboardEvent) => {
    if (event.key !== "Alt") return;
    this.updateMeasurementModifierAltKey(event.type === "keydown");
  };
  private readonly handleMeasurementModifierBlur = () => {
    this.updateMeasurementModifierAltKey(false);
    this.endSliceDrag(null, true);
  };

  private canRender(): boolean {
    const canvas = this.engine.getRenderingCanvas();
    return !!canvas?.isConnected && canvas.clientWidth > 0 && canvas.clientHeight > 0;
  }

  private getCameraZoomRange(): { current: number; min: number; max: number } | null {
    if (!this.rootMesh) return null;
    const current = this.camera.radius;
    const lower = this.camera.lowerRadiusLimit;
    const upper = this.camera.upperRadiusLimit;
    const min = typeof lower === "number" && Number.isFinite(lower) && lower > 0
      ? lower
      : Math.max(current * 0.08, 0.00001);
    const max = typeof upper === "number" && Number.isFinite(upper) && upper > min
      ? upper
      : Math.max(current * 8, min * 10);
    return {
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

  private ensureDisassemblyController(): PreviewDisassemblyController | null {
    if (!this.rootMesh) {
      return null;
    }
    if (!this.disassembly) {
      this.disassembly = createBabylonDisassemblyController(
        this.scene,
        this.camera,
        this.rootMesh,
        this.getRenderableMeshes(this.rootMesh),
        this.gltfComponentMetadata,
      );
    }
    return this.disassembly;
  }

  private isDisassemblyActive(): boolean {
    return this.disassembly?.isEnabled() ?? false;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.12, 0.12, 0.14, 1);
    this.scene.setRenderingAutoClearDepthStencil(2, true, true, true);

    this.camera = new ArcRotateCamera(
      "cam",
      Math.PI / 4,
      Math.PI / 3,
      5,
      Vector3.Zero(),
      this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 0.1;
    this.camera.wheelPrecision = 45;
    this.camera.onViewMatrixChangedObservable.add(() => {
      if (this.measurementSegments.length > 0) {
        this.updateMeasurementOverlayPositions();
      }
      this.notifyCameraZoomChanged();
    });
    canvas.addEventListener("wheel", this.preventCanvasWheelScroll, { passive: false });
    canvas.addEventListener("pointerdown", this.handlePointerDown, true);
    canvas.addEventListener("pointerup", this.handlePointerUp, true);
    canvas.addEventListener("pointermove", this.handlePointerMove, true);
    canvas.addEventListener("pointercancel", this.handlePointerCancel, true);
    canvas.addEventListener("lostpointercapture", this.handlePointerCaptureLost, true);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    window.addEventListener("keydown", this.handleMeasurementModifierKey);
    window.addEventListener("keyup", this.handleMeasurementModifierKey);
    window.addEventListener("blur", this.handleMeasurementModifierBlur);

    this.scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    const hemi = new HemisphericLight("default-light", new Vector3(0, 1, 0.5), this.scene);
    hemi.intensity = 1.2;

    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas);
    if (typeof IntersectionObserver !== "undefined") {
      this.viewportObserver = new IntersectionObserver(this.handleViewportIntersection, {
        root: null,
        threshold: [0, 0.01],
      });
      this.viewportObserver.observe(canvas);
    }
    // Force a resize after the canvas is mounted and has layout dimensions
    window.requestAnimationFrame(() => this.engine.resize());
  }

  async loadModel(
    data: ArrayBuffer,
    ext: string,
    readFile?: (path: string) => Promise<ArrayBuffer>,
    modelPath?: string,
    options?: PreviewLoadOptions,
  ): Promise<ModelPreviewSummary> {
    throwIfPreviewLoadInterrupted(options);
    await ensureLoadersRegistered();
    throwIfPreviewLoadInterrupted(options);

    if (this.rootMesh) {
      this.engine.getRenderingCanvas()?.classList.remove("ai3d-slice-active", "ai3d-slice-dragging", "ai3d-slice-rotate");
      this.restoreSliceMaterialClipping();
      this.disposeSliceOverlay(false);
      disposeBabylonLoadedNodes(this.loadedMeshes, this.loadedTransformNodes);
      this.rootMesh = null;
      this.notifyCameraZoomChanged();
    }
    this.invalidateMeshCache();
    this.loadedMeshes = [];
    this.loadedTransformNodes = [];
    this.disposeMeasurementOverlays(true);
    this.resetMeasurementCalibrationState();
    this.disassembly?.dispose();
    this.disassembly = null;
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();

    const extLower = ext.toLowerCase().replace(".", "");
    this.loadedExt = extLower;
    this.resourceWarnings = [];
    throwIfPreviewLoadInterrupted(options);
    this.gltfComponentMetadata = collectBabylonGltfComponentMetadata(data, extLower);
    const scene = this.scene;

    // Map extension to Babylon SceneLoader file extension
    const extToLoader: Record<string, string> = {
      glb: ".glb",
      gltf: ".gltf",
      stl: ".stl",
      obj: ".obj",
      splat: ".splat",
      ply: ".ply",
    };
    const fileExt = extToLoader[extLower] ?? `.${extLower}`;

    // Use data URL instead of blob URL — Obsidian's Electron converts
    // blob: URLs to blob:app://... which Babylon's GLTF loader cannot parse.
    throwIfPreviewLoadInterrupted(options);
    const dataUrl = `data:application/octet-stream;base64,${arrayBufferToBase64(data)}`;
    throwIfPreviewLoadInterrupted(options);

    const assignImportResult = (result: Awaited<ReturnType<typeof ImportMeshAsync>>): void => {
      try {
        throwIfPreviewLoadInterrupted(options);
      } catch (error) {
        disposeBabylonLoadedNodes(result.meshes, result.transformNodes);
        throw error;
      }
      this.loadedMeshes = result.meshes;
      this.loadedTransformNodes = result.transformNodes;
      if (result.meshes.length > 0) this.rootMesh = result.meshes[0] as Mesh;
    };

    const disposeCurrentLoadAndThrowIfInterrupted = (): void => {
      try {
        throwIfPreviewLoadInterrupted(options);
      } catch (error) {
        disposeBabylonLoadedNodes(this.loadedMeshes, this.loadedTransformNodes);
        this.loadedMeshes = [];
        this.loadedTransformNodes = [];
        this.rootMesh = null;
        this.invalidateMeshCache();
        this.notifyCameraZoomChanged();
        throw error;
      }
    };

    // OBJ: override _loadMTL to read MTL from vault instead of network fetch.
    // Serialized via objMtlLock to prevent concurrent loads from clobbering the prototype.
    if (extLower === "obj" && readFile && modelPath) {
      if (objMtlLock) await objMtlLock;
      throwIfPreviewLoadInterrupted(options);
      let resolveLock!: () => void;
      objMtlLock = new Promise<void>(r => { resolveLock = r; });
      try {
        const { OBJFileLoader } = await import("@babylonjs/loaders/OBJ/objFileLoader.js");
        const proto = OBJFileLoader.prototype as unknown as Record<string, unknown>;
        if (typeof proto._loadMTL !== "function") {
          console.warn("[AI3D] OBJFileLoader._loadMTL not found — MTL vault resolution disabled");
        }
        const originalLoadMTL = proto._loadMTL;

        // Pre-load MTL content from vault (if exists)
        const objText = new TextDecoder().decode(new Uint8Array(data));
        const mtlMatch = objText.match(/mtllib\s+(.+)/);
        let mtlContent: string | null = null;
        if (mtlMatch && readFile && modelPath) {
          const mtlFilename = firstMtlPath(mtlMatch[1]);
          const modelDir = getPortableDirname(modelPath);
          const mtlPath = joinPortablePath(modelDir, mtlFilename);
          try {
            const mtlData = await readFile(mtlPath);
            throwIfPreviewLoadInterrupted(options);
            const raw = new TextDecoder().decode(new Uint8Array(mtlData));
            const lines = raw.split("\n");

            // Resolve texture files referenced in MTL from vault.
            // Try: 1) full relative path, 2) same-dir filename,
            //      3) OBJ-name with image extensions (e.g. bat.jpeg),
            //      4) common basecolor/texture names in same dir
            for (let i = 0; i < lines.length; i++) {
              const m = lines[i].match(OBJ_TEXTURE_RE);
              if (!m) continue;
              const rawPath = firstTexturePath(m[2]);
              const candidates = buildObjTextureCandidates(modelDir, rawPath, modelPath);
              let resolved = false;
              for (const cand of candidates) {
                try {
                  throwIfPreviewLoadInterrupted(options);
                  const texBuf = await readFile(cand);
                  throwIfPreviewLoadInterrupted(options);
                  const dataUrl = `data:${guessTextureMime(cand)};base64,${arrayBufferToBase64(texBuf)}`;
                  lines[i] = `${m[1]} ${dataUrl}`;
                  resolved = true;
                  break;
                } catch (error) {
                  if (isPreviewLoadInterruptedError(error)) throw error;
                  /* try next candidate */
                }
              }
              if (!resolved) {
                this.resourceWarnings.push(`OBJ material texture not found: ${rawPath}`);
                lines[i] = ""; // strip — prevents red-black checkerboard
              }
            }

            // If MTL has no Kd (diffuse color), add default light gray
            const filtered = lines.filter(l => l !== "");
            const hasKd = filtered.some(l => /^\s*Kd\s+/i.test(l));
            if (!hasKd) {
              const nmIdx = filtered.findIndex(l => /^\s*newmtl\s+/i.test(l));
              filtered.splice(nmIdx >= 0 ? nmIdx + 1 : 0, 0, "Kd 0.80 0.80 0.80");
            }
            mtlContent = filtered.join("\n");
          } catch (error) {
            if (isPreviewLoadInterruptedError(error)) throw error;
            this.resourceWarnings.push(`OBJ material library not found: ${mtlPath}`);
          }
        }

        // Override _loadMTL to use vault content or skip (prevents network fetch)
        proto._loadMTL = function(_url: string, _rootUrl: string, onSuccess: (data: string) => void) {
          const content = mtlContent ?? "";
          onSuccess(content);
        };

        const result = await ImportMeshAsync(dataUrl, scene, { meshNames: "", pluginExtension: fileExt });
        assignImportResult(result);

        // Restore original _loadMTL
        proto._loadMTL = originalLoadMTL;
      } catch (e) {
        if (isPreviewLoadInterruptedError(e)) {
          throw e;
        }
        console.error("[AI3D] OBJ load error:", e);
        throw e;
      } finally {
        resolveLock();
        objMtlLock = null;
      }
    } else if (extLower === "stl") {
      // Direct parse — Babylon v9 SceneLoader mishandles data URLs for custom plugins
      const rootMesh = loadSTLBuffer(scene, data);
      try {
        throwIfPreviewLoadInterrupted(options);
      } catch (error) {
        rootMesh?.dispose(false, true);
        throw error;
      }
      this.rootMesh = rootMesh;
      if (this.rootMesh) this.loadedMeshes = [this.rootMesh];
    } else if (extLower === "ply") {
      // Direct parse — same Babylon v9 data-URL issue as STL
      const rootMesh = loadPLYBuffer(scene, data);
      try {
        throwIfPreviewLoadInterrupted(options);
      } catch (error) {
        rootMesh?.dispose(false, true);
        throw error;
      }
      this.rootMesh = rootMesh;
      if (this.rootMesh) this.loadedMeshes = [this.rootMesh];
    } else {
      const result = await ImportMeshAsync(dataUrl, scene, { meshNames: "", pluginExtension: fileExt });
      assignImportResult(result);
    }

    disposeCurrentLoadAndThrowIfInterrupted();

    if (!this.rootMesh) {
      throw new Error("No mesh found in model file");
    }
    const rootBounds = this.getRenderableBounds(this.rootMesh);
    this.captureMeasurementBaseState(this.rootMesh, rootBounds);

    // Disable backface culling on all materials to prevent invisible faces
    // (CAD-converted models often have inconsistent face normals)
    for (const m of this.getRenderableMeshes(this.rootMesh)) {
      if (m.material) {
        m.material.backFaceCulling = false;
      }
    }
    this.syncSliceClipping();
    this.notifySliceChanged();

    const fit = createPreviewOrbitCameraFit(rootBounds);

    this.camera.target = toBabylonVector3(fit.target);
    this.camera.radius = fit.radius;
    this.camera.lowerRadiusLimit = fit.lowerRadiusLimit;
    this.camera.upperRadiusLimit = fit.upperRadiusLimit;
    this.camera.minZ = fit.near;
    this.camera.maxZ = fit.far;

    this.initialCamera = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
    this.notifyCameraZoomChanged();

    this.startRenderLoop();
    this.engine.resize();

    this.cleanupPicking?.();
    this.cleanupPicking = setupPicking(this.scene, (result) => {
      if (this.sliceActive) return;
      if (this.isDisassemblyActive()) return;
      const selectable = result.mesh && this.rootMesh
        ? findBabylonSelectablePartNode(
          this.rootMesh,
          result.mesh,
          this.getRenderableMeshes(this.rootMesh),
          this.gltfComponentMetadata,
        )
        : null;
      const previewResult: PreviewPickResult = {
        mesh: selectable,
        pickedPoint: result.pickedPoint,
        screenX: result.screenX,
        screenY: result.screenY,
        modifiers: result.modifiers,
      };
      this.lastPointerClient = {
        x: result.screenX,
        y: result.screenY,
        altKey: result.modifiers?.altKey === true,
      };
      this._lastPickResult = previewResult;
      if (this.measurementActive) {
        if (result.modifiers?.altKey === true) {
          if (!result.pickedPoint) return;
          this.setMeasurementSnapKind("free");
          this.addMeasurementPoint(toBabylonVector3(result.pickedPoint));
          return;
        }
        if (!this.measurementTargetNode) {
          if (selectable) {
            this.setMeasurementTargetNode(selectable);
          }
          return;
        }
        const targetPoint = this.getMeasurementTargetPickPoint(result.mesh, result.pickedPoint);
        if (!targetPoint) {
          this.setMeasurementSnapKind(null);
          return;
        }
        this.addMeasurementPoint(this.resolveMeasurementPickPoint(targetPoint, false));
        return;
      }
      if (this.focusSelectionEnabled) {
        if (selectable) {
          this.setFocusedNode(selectable);
        } else {
          this.cleanupPicking?.clearHighlight();
        }
      }
      this._onPickCallbacks.forEach(cb => cb(previewResult));
    }, () => !this.focusSelectionEnabled && !this.measurementActive && !this.sliceActive, (mesh) => this.resolvePickHighlightMeshes(mesh));
    this.ensureDisassemblyController();

    return this.createModelSummary(this.rootMesh);
  }

  // ── Config application ───────────────────────────────────────────

  applyConfig(config: ThreeDBlockConfig): void {
    if (config.camera) this.applyCameraConfig(config.camera);
    if (config.lights) this.applyLightConfig(config.lights);
    if (config.scene) this.applySceneConfig(config.scene);
    if (config.stl && this.loadedExt === "stl") {
      if (config.stl.color) this.setSTLColor(config.stl.color);
      if (config.stl.wireframe !== undefined) this.setWireframe(config.stl.wireframe);
    }
  }

  applyCameraConfig(config: CameraConfig): void {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;

    if (config.mode === "orthographic") {
      const radius = this.camera.radius;
      const aspect = canvas.clientWidth / canvas.clientHeight;
      const zoom = config.zoom ?? 1;
      const size = radius / zoom;

      this.camera.mode = 1; // orthographic
      this.camera.orthoLeft = -size * aspect;
      this.camera.orthoRight = size * aspect;
      this.camera.orthoTop = size;
      this.camera.orthoBottom = -size;
    } else {
      this.camera.mode = 0; // perspective
      if (config.fov) this.camera.fov = (config.fov * Math.PI) / 180;
    }

    if (config.position) {
      const [x, y, z] = config.position;
      this.camera.setPosition(new Vector3(x, y, z));
    }

    if (config.lookAt) {
      const [x, y, z] = config.lookAt;
      this.camera.setTarget(new Vector3(x, y, z));
    }

    if (config.near !== undefined) this.camera.minZ = config.near;
    if (config.far !== undefined) this.camera.maxZ = config.far;
    this.notifyCameraZoomChanged();
  }

  applyLightConfig(lights: LightConfig[]): void {
    // Dispose previous config lights and shadow generator
    for (const light of this.configLights) {
      light.dispose();
    }
    this.configLights = [];
    this.shadowGenerator?.dispose();
    this.shadowGenerator = null;

    // Remove the default light when config lights are provided
    const defaultLight = this.scene.getLightByName("default-light");
    if (defaultLight) {
      defaultLight.dispose();
    }

    for (const cfg of lights) {
      const light = this.createLight(cfg);
      if (light) this.configLights.push(light);
    }
  }

  private createLight(cfg: LightConfig): Light | null {
    const color = cfg.color ? Color3.FromHexString(cfg.color) : Color3.White();
    const intensity = cfg.intensity ?? 1;

    switch (cfg.type) {
      case "hemisphere": {
        const ground = cfg.groundColor
          ? Color3.FromHexString(cfg.groundColor)
          : new Color3(0.2, 0.2, 0.2);
        const l = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
        l.diffuse = color;
        l.groundColor = ground;
        l.intensity = intensity;
        return l;
      }
      case "directional": {
        const dir = cfg.position
          ? new Vector3(...cfg.position).normalize()
          : new Vector3(-1, -2, -1).normalize();
        const l = new DirectionalLight("dir", dir, this.scene);
        l.diffuse = color;
        l.intensity = intensity;
        if (cfg.castShadow && this.rootMesh) {
          this.setupShadow(l);
        }
        return l;
      }
      case "point": {
        const pos = cfg.position ? new Vector3(...cfg.position) : new Vector3(0, 5, 0);
        const l = new PointLight("point", pos, this.scene);
        l.diffuse = color;
        l.intensity = intensity;
        if (cfg.decay !== undefined) (l as unknown as Record<string, unknown>).decay = cfg.decay;
        return l;
      }
      case "spot": {
        const pos = cfg.position ? new Vector3(...cfg.position) : new Vector3(0, 5, 0);
        const target = cfg.target ? new Vector3(...cfg.target) : Vector3.Zero();
        const dir = target.subtract(pos).normalize();
        const angle = cfg.angle ? (cfg.angle * Math.PI) / 180 : Math.PI / 4;
        const penumbra = cfg.penumbra ?? 0.5;
        const l = new SpotLight("spot", pos, dir, angle, penumbra, this.scene);
        l.diffuse = color;
        l.intensity = intensity;
        if (cfg.decay !== undefined) (l as unknown as Record<string, unknown>).decay = cfg.decay;
        if (cfg.castShadow && this.rootMesh) {
          this.setupShadow(l);
        }
        return l;
      }
      case "attachToCam": {
        const l = new PointLight("cam-light", Vector3.Zero(), this.scene);
        l.diffuse = color;
        l.intensity = intensity;
        l.parent = this.camera;
        return l;
      }
      default:
        return null;
    }
  }

  private setupShadow(light: Light): void {
    if (!this.rootMesh) return;
    // ShadowGenerator requires a ShadowLight (DirectionalLight | PointLight | SpotLight).
    // HemisphericLight cannot cast shadows — silently skip.
    if (!isShadowLight(light)) {
      console.warn("[AI3D] Light type does not support shadows:", light.name);
      return;
    }
    const sg = new ShadowGenerator(1024, light);
    sg.useBlurExponentialShadowMap = true;
    sg.blurKernel = 32;
    for (const m of this.getRenderableMeshes(this.rootMesh)) {
      sg.addShadowCaster(m);
      m.receiveShadows = true;
    }
    this.shadowGenerator = sg;
  }

  applySceneConfig(config: SceneConfig): void {
    if (config.background !== undefined) {
      const c = Color4.FromColor3(Color3.FromHexString(config.background), config.transparent ? 0 : 1);
      this.scene.clearColor = c;
    }

    if (config.autoRotate === true) {
      if (!this.autoRotateBehavior) {
        this.autoRotateBehavior = new AutoRotationBehavior();
        this.autoRotateBehavior.idleRotationSpeed = config.autoRotateSpeed ?? 0.5;
        this.autoRotateBehavior.idleRotationWaitTime = 1000;
        this.autoRotateBehavior.idleRotationSpinupTime = 500;
        if (this.sliceDragState) {
          this.sliceAutoRotatePaused = true;
        } else {
          this.camera.addBehavior(this.autoRotateBehavior);
        }
      } else {
        this.autoRotateBehavior.idleRotationSpeed = config.autoRotateSpeed ?? 0.5;
      }
    } else if (config.autoRotate === false && this.autoRotateBehavior) {
      if (!this.sliceAutoRotatePaused) {
        this.camera.removeBehavior(this.autoRotateBehavior);
      }
      this.autoRotateBehavior = null;
      this.sliceAutoRotatePaused = false;
    }

    if (config.groundShadow && this.rootMesh) {
      this.createGround();
    }

    if (config.grid) {
      this.createGrid();
    }

    if (config.axis) {
      this.createAxis();
    }
  }

  private createGround(): void {
    if (!this.rootMesh || this.groundMesh) return;
    const bounds = this.getRenderableBounds(this.rootMesh);
    const boundsSize = getPreviewBoundsSize(bounds);
    const size = Math.max(boundsSize.x, boundsSize.z) * 3;
    const y = bounds.min.y;

    this.groundMesh = MeshBuilder.CreateGround("ground", { width: size, height: size }, this.scene);
    this.groundMesh.position.y = y;
    const mat = new StandardMaterial("ground-mat", this.scene);
    mat.diffuseColor = new Color3(0.15, 0.15, 0.15);
    mat.specularColor = Color3.Black();
    mat.alpha = 0.5;
    this.groundMesh.material = mat;
    this.groundMesh.receiveShadows = true;
  }

  private createGrid(): void {
    if (!this.rootMesh || this.gridMesh) return;
    const bounds = this.getRenderableBounds(this.rootMesh);
    const boundsSize = getPreviewBoundsSize(bounds);
    const size = Math.max(boundsSize.x, boundsSize.z) * 2;
    const y = bounds.min.y - 0.01;

    this.gridMesh = MeshBuilder.CreateGround("grid", { width: size, height: size, subdivisions: 20 }, this.scene);
    this.gridMesh.position.y = y;
    const mat = new StandardMaterial("grid-mat", this.scene);
    mat.wireframe = true;
    mat.diffuseColor = new Color3(0.3, 0.3, 0.3);
    mat.emissiveColor = new Color3(0.1, 0.1, 0.1);
    this.gridMesh.material = mat;
  }

  private createAxis(): void {
    if (!this.rootMesh || this.axisMeshes.length > 0) return;
    const bounds = this.getRenderableBounds(this.rootMesh);
    const len = getPreviewBoundsMaxSpan(bounds) * 1.5;
    const origin = toBabylonVector3(bounds.min);
    const radius = getPreviewBoundsRadius(bounds) * 0.01;

    const axes: [string, Color3, Vector3][] = [
      ["x", Color3.Red(), new Vector3(len, 0, 0)],
      ["y", Color3.Green(), new Vector3(0, len, 0)],
      ["z", Color3.Blue(), new Vector3(0, 0, len)],
    ];

    for (const [name, color, dir] of axes) {
      const tube = MeshBuilder.CreateTube(`axis-${name}`, {
        path: [origin, origin.add(dir)],
        radius,
        tessellation: 8,
      }, this.scene);
      const mat = new StandardMaterial(`axis-${name}-mat`, this.scene);
      mat.emissiveColor = color;
      mat.diffuseColor = Color3.Black();
      tube.material = mat;
      this.axisMeshes.push(tube);
    }
  }

  setSTLColor(hex: string): void {
    if (!this.rootMesh) return;
    const color = Color3.FromHexString(hex);
    for (const m of this.getRenderableMeshes(this.rootMesh)) {
      if (m.material && m.material.name === "stl-mat") {
        const mat = m.material as StandardMaterial;
        mat.diffuseColor = color;
        mat.emissiveColor = color.scale(0.1);
      }
    }
  }

  setWireframe(enabled: boolean): void {
    if (!this.rootMesh) return;
    if (isGaussianSplattingMesh(this.rootMesh)) return;
    this.wireframeEnabled = enabled;
    this.scene.forceWireframe = enabled;
  }

  toggleWireframe(): boolean {
    this.setWireframe(!this.wireframeEnabled);
    return this.wireframeEnabled;
  }

  hasAnimations(): boolean {
    return this.scene.animationGroups.length > 0;
  }

  toggleAnimation(): boolean {
    const groups = this.scene.animationGroups;
    if (groups.length === 0) return false;
    this.animPlaying = !this.animPlaying;
    for (const g of groups) {
      if (this.animPlaying) {
        g.play(true);
      } else {
        g.pause();
      }
    }
    return this.animPlaying;
  }

  toggleMeasurement(): boolean {
    if (this.measurementActive) {
      this.deactivateMeasurementMode();
      return false;
    }
    if (this.isDisassemblyActive()) {
      this.disableDisassemblyAndReset();
    }
    this.deactivateSliceMode();
    const measurementTarget = this.getCurrentMeasurementTargetNode();
    this.cleanupPicking?.clearHighlight();
    this.clearFocusedMesh();
    if (this.focusSelectionEnabled) {
      this.focusSelectionEnabled = false;
    }
    this.measurementActive = true;
    this.setMeasurementTargetNode(measurementTarget, false);
    setMeasurementCanvasActive(this.engine.getRenderingCanvas(), this.measurementActive);
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
    const hadPendingPoint = !!this.pendingPoint;
    this.cancelPendingMeasurement();
    if (hadPendingPoint) {
      this.notifyMeasurementsChanged();
    }
  }

  private deactivateMeasurementMode(): boolean {
    if (!this.measurementActive) return false;
    this.measurementActive = false;
    setMeasurementCanvasActive(this.engine.getRenderingCanvas(), false);
    this.setMeasurementTargetNode(null, false);
    this.cancelPendingMeasurement();
    this.notifyMeasurementsChanged();
    return true;
  }

  private disposeMeasurementOverlays(deactivate: boolean): void {
    if (deactivate) {
      this.measurementActive = false;
      setMeasurementCanvasActive(this.engine.getRenderingCanvas(), false);
      this.setMeasurementTargetNode(null, false);
    }
    this.cancelPendingMeasurement(false);
    for (const segment of this.measurementSegments) {
      segment.line.dispose(false, true);
      segment.label.dispose(false, true);
    }
    this.measurementSegments = [];
    for (const marker of this.measurementMarkers) {
      marker.dispose(false, true);
    }
    this.measurementMarkers = [];
    this.measurementMarkerPoints = [];
    this.setMeasurementSnapKind(null, false);
    this.notifyMeasurementsChanged();
  }


  setMeasurementScale(scale: MeasurementScale): void {
    this.measurementScale = sanitizeMeasurementScale(scale);
    this.invalidateMeasurementSnapInputCache();
    this.applyMeasurementModelScale();
    if (this.sliceActive) {
      this.setSliceCenterFromOffset(this.sliceOffset);
      this.syncSliceClipping();
    }
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
    if (!this.rootMesh) return null;
    const bounds = this.measurementBaseBounds ?? this.getRenderableBounds(this.rootMesh);
    if (!bounds) return null;
    return {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    };
  }

  getMeasurementRecords(): MeasurementRecord[] {
    return this.createMeasurementRecords();
  }

  getMeasurementState(): MeasurementState {
    return createMeasurementState({
      active: this.measurementActive,
      pending: !!this.pendingPoint,
      records: this.createMeasurementRecords(),
      unit: this.measurementUnit,
      scale: this.getMeasurementScale(),
      bounds: this.getMeasurementBounds(),
      targetLocked: !!this.measurementTargetNode,
      targetName: this.getMeasurementTargetName(),
      targetScope: this.measurementTargetNode === this.rootMesh ? "model" : "part",
      snapKind: this.measurementSnapKind,
    });
  }

  exportMeasurements(): string {
    return createMeasurementMarkdown(this.createMeasurementRecords());
  }

  observeMeasurements(callback: () => void): () => void {
    this.measurementObservers.add(callback);
    callback();
    return () => {
      this.measurementObservers.delete(callback);
    };
  }

  updateMeasurementLabels(): void {
    if (this.measurementSegments.length === 0) return;
    const markerSize = this.getMeasurementMarkerSize() * 3.2;
    for (const segment of this.measurementSegments) {
      this.updateMeasurementLineGeometry(segment);
      const labelText = createMeasurementLabel(this.createMeasurementReading(segment.start, segment.end));
      segment.label.dispose(false, true);
      const layout = this.createBabylonMeasurementDraftingLayout(segment.start, segment.end);
      const labelPosition = layout?.labelPosition ?? Vector3.Center(
        this.toMeasurementDisplayPoint(segment.start),
        this.toMeasurementDisplayPoint(segment.end),
      );
      segment.label = this.createMeasurementLabelMesh(labelText, labelPosition, markerSize);
    }
  }

  private captureMeasurementBaseState(root: Mesh, rootBounds: PreviewBounds | null): void {
    this.measurementBaseRootScaling = root.scaling.clone();
    this.measurementBaseBounds = rootBounds ? createPreviewBounds(rootBounds.min, rootBounds.max) : null;
    this.measurementScale = { x: 1, y: 1, z: 1 };
  }

  private resetMeasurementCalibrationState(): void {
    this.measurementScale = { x: 1, y: 1, z: 1 };
    this.measurementBaseRootScaling = new Vector3(1, 1, 1);
    this.measurementBaseBounds = null;
    this.measurementMarkerPoints = [];
    this.invalidateMeasurementSnapInputCache();
  }

  private applyMeasurementModelScale(): void {
    if (!this.rootMesh) return;
    const scale = sanitizeMeasurementScale(this.measurementScale);
    this.rootMesh.scaling = new Vector3(
      this.measurementBaseRootScaling.x * scale.x,
      this.measurementBaseRootScaling.y * scale.y,
      this.measurementBaseRootScaling.z * scale.z,
    );
    this.rootMesh.computeWorldMatrix(true);
    for (const mesh of this.loadedMeshes) {
      mesh.computeWorldMatrix(true);
    }
    this.invalidateMeshCache();
    this.rebuildScaledSceneHelpers();
    this.refitCameraToModel();
    this.startRenderLoop();
  }

  private rebuildScaledSceneHelpers(): void {
    const hadBoundingBox = !!this.bboxMesh;
    const hadGround = !!this.groundMesh;
    const hadGrid = !!this.gridMesh;
    const hadAxis = this.axisMeshes.length > 0;
    this.bboxMesh?.dispose();
    this.bboxMesh = null;
    this.groundMesh?.dispose();
    this.groundMesh = null;
    this.gridMesh?.dispose();
    this.gridMesh = null;
    for (const axis of this.axisMeshes) axis.dispose();
    this.axisMeshes = [];
    if (hadBoundingBox && this.rootMesh) {
      const bounds = this.getRenderableBounds(this.rootMesh);
      const center = toBabylonVector3(getPreviewBoundsCenter(bounds));
      const size = toBabylonVector3(getPreviewBoundsSize(bounds));
      this.bboxMesh = MeshBuilder.CreateBox("bbox", { width: size.x, height: size.y, depth: size.z }, this.scene);
      this.bboxMesh.position = center;
      const mat = new StandardMaterial("bbox-mat", this.scene);
      mat.wireframe = true;
      mat.emissiveColor = new Color3(1, 1, 0);
      mat.disableLighting = true;
      mat.alpha = 0.6;
      this.bboxMesh.material = mat;
    }
    if (hadGround) this.createGround();
    if (hadGrid) this.createGrid();
    if (hadAxis) this.createAxis();
  }

  private refitCameraToModel(): void {
    if (!this.rootMesh) return;
    const fit = createPreviewOrbitCameraFit(this.getRenderableBounds(this.rootMesh));
    this.camera.target = toBabylonVector3(fit.target);
    this.camera.radius = fit.radius;
    this.camera.lowerRadiusLimit = fit.lowerRadiusLimit;
    this.camera.upperRadiusLimit = fit.upperRadiusLimit;
    this.camera.minZ = fit.near;
    this.camera.maxZ = fit.far;
    this.initialCamera = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
    this.notifyCameraZoomChanged();
  }

  private getMeasurementPivot(): Vector3 {
    return this.rootMesh?.getAbsolutePosition().clone() ?? Vector3.Zero();
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
    for (let i = 0; i < this.measurementMarkers.length; i++) {
      const basePoint = this.measurementMarkerPoints[i];
      if (basePoint) {
        this.measurementMarkers[i].position = this.toMeasurementDisplayPoint(basePoint);
      }
    }
    for (const segment of this.measurementSegments) {
      this.updateMeasurementLineGeometry(segment);
    }
    if (this.pendingPoint && this.previewLine) {
      this.updatePreviewLine();
    }
  }

  private updateMeasurementLineGeometry(segment: BabylonMeasurementSegment): void {
    const layout = this.createBabylonMeasurementDraftingLayout(segment.start, segment.end);
    const lines = layout?.lineSegments ?? [[
      this.toMeasurementDisplayPoint(segment.start),
      this.toMeasurementDisplayPoint(segment.end),
    ]];
    segment.line = MeshBuilder.CreateLineSystem("measure-line", {
      lines,
      instance: segment.line,
    }, this.scene);
    segment.line.isPickable = false;
    segment.line.renderingGroupId = 2;
    segment.line.color = MEASUREMENT_LINE_COLOR.clone();
    segment.line.alpha = 1;
    if (layout) {
      segment.label.position = layout.labelPosition;
    }
  }

  private notifyMeasurementsChanged(): void {
    for (const callback of Array.from(this.measurementObservers)) {
      callback();
    }
  }

  setAnimationSpeed(speed: number): void {
    for (const g of this.scene.animationGroups) {
      g.speedRatio = speed;
    }
  }

  captureSnapshot(): string | null {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return null;
    this.scene.render();
    return canvas.toDataURL("image/png");
  }

  toggleOrientationGizmo(): boolean {
    this.gizmoEnabled = !this.gizmoEnabled;
    if (this.gizmoEnabled && !this.gizmo) {
      this.gizmo = new OrientationGizmo(this.engine, this.camera);
    }
    return this.gizmoEnabled;
  }

  isOrientationGizmoEnabled(): boolean {
    return this.gizmoEnabled;
  }

  /**
   * Set render resolution scale directly (1.0 = native).
   * Returns the applied scale value.
   */
  setRenderScale(scale: number): number {
    const clamped = Math.max(0.25, Math.min(scale, 2.0));
    this.renderScale = clamped;
    const qualityScale = { low: 2, medium: 1.33, high: 1 }[this.currentQuality];
    const mobileBoost = isMobile() ? 1.5 : 1;
    this.engine.setHardwareScalingLevel(qualityScale * mobileBoost / clamped);
    return this.getRenderScale();
  }

  getRenderScale(): number {
    return Number(this.renderScale.toFixed(2));
  }

  getCameraZoomState(): CameraZoomState | null {
    const range = this.getCameraZoomRange();
    if (!range) return null;
    const value = (range.max - range.current) / (range.max - range.min);
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
    this.camera.radius = range.max - clamped * (range.max - range.min);
    this.startRenderLoop();
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
    return {
      backend: "babylon" as const,
      renderScale: Number((1 / this.engine.getHardwareScalingLevel()).toFixed(2)),
      quality: this.currentQuality,
      meshCount: this.rootMesh ? this.getRenderableMeshes(this.rootMesh).length : 0,
    };
  }

  toggleBoundingBox(): boolean {
    this.bboxEnabled = !this.bboxEnabled;
    if (this.bboxEnabled) {
      if (!this.rootMesh) return this.bboxEnabled;
      if (this.bboxMesh) this.bboxMesh.dispose();
      const bounds = this.getRenderableBounds(this.rootMesh);
      const center = toBabylonVector3(getPreviewBoundsCenter(bounds));
      const size = toBabylonVector3(getPreviewBoundsSize(bounds));

      this.bboxMesh = MeshBuilder.CreateBox("bbox", {
        width: size.x, height: size.y, depth: size.z,
      }, this.scene);
      this.bboxMesh.position = center;
      const mat = new StandardMaterial("bbox-mat", this.scene);
      mat.wireframe = true;
      mat.emissiveColor = new Color3(1, 1, 0);
      mat.disableLighting = true;
      mat.alpha = 0.6;
      this.bboxMesh.material = mat;
    } else {
      this.bboxMesh?.dispose();
      this.bboxMesh = null;
    }
    return this.bboxEnabled;
  }

  toggleSlice(): boolean {
    if (this.sliceActive) {
      this.deactivateSliceMode();
      return false;
    }
    this.disableDisassemblyAndReset();
    this.deactivateMeasurementMode();
    if (this.focusSelectionEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
      this.cleanupPicking?.clearHighlight();
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
    const bounds = this.rootMesh ? this.getRenderableBounds(this.rootMesh) : null;
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
      this.rootMesh ? this.getRenderableBounds(this.rootMesh) : null,
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

  toggleFocusSelection(): boolean {
    const nextEnabled = !this.focusSelectionEnabled;
    if (nextEnabled && this.isDisassemblyActive()) {
      this.disableDisassemblyAndReset();
    }
    if (nextEnabled) {
      this.deactivateMeasurementMode();
      this.deactivateSliceMode();
    }
    this.focusSelectionEnabled = nextEnabled;
    if (!this.focusSelectionEnabled) {
      this.clearFocusedMesh();
    } else if (this._lastPickResult.mesh) {
      this.setFocusedNode(this._lastPickResult.mesh as BabylonSelectablePartNode);
    }
    return this.focusSelectionEnabled;
  }

  isFocusSelectionEnabled(): boolean {
    return this.focusSelectionEnabled;
  }

  toggleDisassembly(): boolean {
    const controller = this.ensureDisassemblyController();
    if (!controller) return false;
    const nextEnabled = !controller.isEnabled();
    if (nextEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
      this.deactivateMeasurementMode();
      this.deactivateSliceMode();
    }
    const enabled = controller.setEnabled(nextEnabled);
    if (!enabled) controller.reset();
    return enabled;
  }

  resetDisassembly(): void {
    this.disassembly?.reset();
  }

  private disableDisassemblyAndReset(): void {
    if (!this.isDisassemblyActive()) return;
    this.disassembly?.setEnabled(false);
    this.resetDisassembly();
  }

  isDisassemblyEnabled(): boolean {
    return this.isDisassemblyActive();
  }

  // ── Existing API ─────────────────────────────────────────────────

  setExplode(factor: number, axis: PreviewAxis) {
    if (this.rootMesh) setExplode(this.rootMesh, factor, axis, this.loadedMeshes);
  }

  resetExplode() {
    if (this.rootMesh) resetExplode(this.rootMesh, this.loadedMeshes);
  }

  resetView(): void {
    if (this.rootMesh) resetExplode(this.rootMesh, this.loadedMeshes);
    this.resetDisassembly();
    this.clearFocusedMesh();
    this.camera.mode = 0; // perspective
    this.camera.alpha = this.initialCamera.alpha;
    this.camera.beta = this.initialCamera.beta;
    this.camera.radius = this.initialCamera.radius;
    this.camera.target = this.initialCamera.target.clone();
    this.startRenderLoop();
    this.notifyCameraZoomChanged();
  }

  exportModelInfo(modelPath?: string): string {
    if (!this.rootMesh) return "";
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const isSplat = isGaussianSplattingMesh(this.rootMesh);
    const summary = this.createModelSummary(this.rootMesh);
    const name = modelPath ? getPortableBasename(modelPath) || summary.rootName : summary.rootName;
    return createPreviewModelInfoMarkdown({
      title: name,
      format: this.loadedExt.toUpperCase(),
      summary,
      meshBreakdown: renderableMeshes.map((mesh) => createBabylonMeshInfoBreakdown(mesh, { isSplat })),
      materialNames: renderableMeshes.map((mesh) => mesh.material?.name),
    });
  }

  getModelEvidence(): ModelEvidence | null {
    if (!this.rootMesh) return null;
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const groupedPartCandidates = createBabylonGroupedPartCandidates(
      renderableMeshes,
      this.loadedTransformNodes,
      this.gltfComponentMetadata,
    );
    return createPreviewEvidence({
      summary: this.createModelSummary(this.rootMesh),
      renderableMeshes,
      groupedPartCandidates,
      createMeshPart: (mesh) => createBabylonPartPreviewSummary(mesh, this.gltfComponentMetadata),
      getMeshMaterialNames: (mesh) => [mesh.material?.name],
      resourceWarnings: this.resourceWarnings,
    });
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    if (!this.rootMesh) return null;
    const node = this.focusedNode ?? (isBabylonSelectablePartNode(this._lastPickResult.mesh) ? this._lastPickResult.mesh : null);
    if (!node || isBabylonNodeDisposed(node)) return null;
    return createBabylonNodePartPreviewSummary(node, this.getRenderableMeshes(this.rootMesh), this.gltfComponentMetadata);
  }

  exportSelectedPartInfo(): string {
    const part = this.getSelectedPartInfo();
    return part ? createPreviewPartInfoMarkdown(part) : "";
  }

  getPickWorldPoint(result: PreviewPickResult): PreviewWorldPoint | null {
    if (result.pickedPoint && typeof result.pickedPoint === "object") {
      return toPreviewWorldPoint(result.pickedPoint as { x: number; y: number; z: number });
    }

    if (this.rootMesh && isBabylonSelectablePartNode(result.mesh)) {
      const part = createBabylonNodePartPreviewSummary(result.mesh, this.getRenderableMeshes(this.rootMesh), this.gltfComponentMetadata);
      return part.center;
    }

    return null;
  }

  focusWorldPoint(point: PreviewWorldPoint): void {
    const target = new Vector3(point.x, point.y, point.z);
    const start = this.camera.target.clone();
    const startedAt = performance.now();

    if (this.focusWorldPointFrame) {
      window.cancelAnimationFrame(this.focusWorldPointFrame);
      this.focusWorldPointFrame = 0;
    }

    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startedAt) / FOCUS_WORLD_POINT_ANIMATION_MS));
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.target = Vector3.Lerp(start, target, ease);
      if (t < 1 && !this.scene.isDisposed) {
        this.focusWorldPointFrame = window.requestAnimationFrame(tick);
        return;
      }
      this.focusWorldPointFrame = 0;
    };
    this.focusWorldPointFrame = window.requestAnimationFrame(tick);
  }

  private getAnnotationCameraStateKey(): string {
    return formatAnnotationCameraStateKey([
      { value: this.camera.alpha, digits: 3 },
      { value: this.camera.beta, digits: 3 },
      { value: this.camera.radius, digits: 3 },
      { value: this.camera.target.x, digits: 2 },
      { value: this.camera.target.y, digits: 2 },
      { value: this.camera.target.z, digits: 2 },
    ]);
  }

  private projectAnnotationWorldPoint(point: PreviewWorldPoint, result: PreviewProjectionResult): boolean {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.scene.isDisposed) {
      return false;
    }

    const rw = this.engine.getRenderWidth();
    const rh = this.engine.getRenderHeight();
    if (rw === 0 || rh === 0 || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return false;
    }

    const worldPoint = BabylonModelPreview.annotationWorldPoint;
    worldPoint.set(point.x, point.y, point.z);

    Vector3.ProjectToRef(
      worldPoint,
      BabylonModelPreview.annotationIdentity,
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(rw, rh),
      BabylonModelPreview.annotationProjection,
    );
    return projectViewportPointToCanvas(
      BabylonModelPreview.annotationProjection,
      rw,
      rh,
      canvas,
      result,
    );
  }

  private isAnnotationWorldPointOccluded(point: PreviewWorldPoint): boolean {
    if (this.scene.isDisposed) {
      return false;
    }

    const lineOfSight = createPreviewLineOfSight(
      toPreviewWorldPoint(this.camera.position),
      point,
    );
    if (!lineOfSight) {
      return false;
    }
    const direction = BabylonModelPreview.annotationDirection;
    const ray = BabylonModelPreview.annotationRay;

    direction.set(lineOfSight.direction.x, lineOfSight.direction.y, lineOfSight.direction.z);
    ray.origin = this.camera.position;
    ray.direction = direction;
    ray.length = lineOfSight.distance;

    const pickInfo = this.scene.pickWithRay(ray);
    return !!pickInfo?.hit
      && isPreviewHitOccluded(pickInfo.distance, lineOfSight.distance, lineOfSight.epsilon);
  }

  getAnnotationProvider(): AnnotationViewportProvider {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) {
      throw new Error("Preview canvas is unavailable");
    }
    return createAnnotationViewportProvider({
      canvas,
      observeRender: (callback) => {
        const obs = this.scene.onAfterRenderCameraObservable.add((camera) => {
          if (camera === this.camera) {
            callback();
          }
        });
        return {
          remove: () => this.scene.onAfterRenderCameraObservable.remove(obs),
        };
      },
      getCameraStateKey: () => this.getAnnotationCameraStateKey(),
      projectWorldPoint: (point, result) => this.projectAnnotationWorldPoint(point, result),
      isWorldPointOccluded: (point) => this.isAnnotationWorldPointOccluded(point),
    });
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.engine.getRenderingCanvas();
  }

  getLastPickResult(): PreviewPickResult {
    return this._lastPickResult;
  }

  onPick(callback: (result: PreviewPickResult) => void): () => void {
    this._onPickCallbacks.push(callback);
    return () => {
      this._onPickCallbacks = this._onPickCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Apply render quality preset and optional resolution scale.
   * - low:    0.5x resolution, no shadow blur
   * - medium: 0.75x resolution, basic shadow blur
   * - high:   1.0x resolution, full shadow blur (default)
   * @param renderScale User-controlled resolution multiplier (1.0 = native).
   *   Lower values = less pixels = better performance.
   */
  setRenderQuality(quality: "low" | "medium" | "high", renderScale = this.renderScale): void {
    this.currentQuality = quality;
    this.renderScale = Math.max(0.25, Math.min(renderScale, 2.0));
    const scaleMap = { low: 2, medium: 1.33, high: 1 };
    const mobileBoost = isMobile() ? 1.5 : 1;
    // hardwareScalingLevel: higher = fewer pixels. renderScale < 1 = fewer pixels.
    const scale = scaleMap[quality] * mobileBoost / this.renderScale;
    this.engine.setHardwareScalingLevel(scale);

    if (this.shadowGenerator) {
      const blurMap = { low: 0, medium: 16, high: 32 };
      this.shadowGenerator.blurKernel = blurMap[quality];
      if (quality === "low") {
        this.shadowGenerator.useBlurExponentialShadowMap = false;
        this.shadowGenerator.useExponentialShadowMap = true;
      } else {
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.useExponentialShadowMap = false;
      }
    }
  }

  destroy() {
    this.engine.stopRenderLoop();
    if (this.focusWorldPointFrame) {
      window.cancelAnimationFrame(this.focusWorldPointFrame);
      this.focusWorldPointFrame = 0;
    }
    this._onPickCallbacks = [];
    this.cameraZoomObservers.clear();
    this.sliceObservers.clear();
    this.cleanupPicking?.();
    this.cleanupPicking = null;
    this.gizmo?.dispose();
    this.gizmo = null;
    this.disassembly?.dispose();
    this.disassembly = null;
    this.restoreSliceMaterialClipping();
    this.disposeSliceOverlay(false);
    this.disposeMeasurementOverlays(true);
    this.measurementObservers.clear();
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();
    this.bboxMesh?.dispose();
    this.bboxMesh = null;
    this.camera.detachControl();
    const canvas = this.engine.getRenderingCanvas();
    canvas?.classList.remove("ai3d-slice-active", "ai3d-slice-dragging", "ai3d-slice-rotate");
    canvas?.removeEventListener("wheel", this.preventCanvasWheelScroll);
    canvas?.removeEventListener("pointerdown", this.handlePointerDown, true);
    canvas?.removeEventListener("pointerup", this.handlePointerUp, true);
    canvas?.removeEventListener("pointermove", this.handlePointerMove, true);
    canvas?.removeEventListener("pointercancel", this.handlePointerCancel, true);
    canvas?.removeEventListener("lostpointercapture", this.handlePointerCaptureLost, true);
    canvas?.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas?.removeEventListener("webglcontextrestored", this.handleContextRestored);
    window.removeEventListener("keydown", this.handleMeasurementModifierKey);
    window.removeEventListener("keyup", this.handleMeasurementModifierKey);
    window.removeEventListener("blur", this.handleMeasurementModifierBlur);
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    this.resizeObs.disconnect();
    if (this.sliceMoveFrame) {
      window.cancelAnimationFrame(this.sliceMoveFrame);
      this.sliceMoveFrame = 0;
    }
    this.pendingSliceMove = null;
    this.invalidateMeshCache();
    this.rootMesh = null;
    this.loadedMeshes = [];
    this.loadedTransformNodes = [];
    if (this.autoRotateBehavior) {
      this.camera.removeBehavior(this.autoRotateBehavior);
      this.autoRotateBehavior = null;
    }
    for (const l of this.configLights) l.dispose();
    this.configLights = [];
    this.shadowGenerator?.dispose();
    this.shadowGenerator = null;
    this.groundMesh?.dispose();
    this.groundMesh = null;
    this.gridMesh?.dispose();
    this.gridMesh = null;
    for (const a of this.axisMeshes) a.dispose();
    this.axisMeshes = [];
    this.scene.dispose();
    this.engine.dispose();
  }

  private startRenderLoop() {
    if (this.rendering || !this.viewportVisible || this.contextLost) return;
    this.rendering = true;
    this.engine.runRenderLoop(() => {
      if (!this.canRender() || !this.viewportVisible || this.contextLost) {
        this.engine.stopRenderLoop();
        this.rendering = false;
        return;
      }
      this.scene.render();
      if (this.gizmo && this.gizmoEnabled) {
        this.gizmo.syncWith(this.camera);
        this.gizmo.render();
      }
    });
  }

  private readonly handleViewportIntersection = (entries: IntersectionObserverEntry[]) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible === this.viewportVisible) return;
    this.viewportVisible = visible;
    if (visible) {
      this.startRenderLoop();
    } else if (this.rendering) {
      this.engine.stopRenderLoop();
      this.rendering = false;
    }
  };

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    if (this.rendering) {
      this.engine.stopRenderLoop();
      this.rendering = false;
    }
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    this.engine.resize();
    this.startRenderLoop();
  };

  private getRenderableMeshes(root: Mesh): AbstractMesh[] {
    if (this.cachedRenderableMeshes && this.cachedRenderableRoot === root) {
      return this.cachedRenderableMeshes;
    }
    const renderableMeshes = getBabylonRenderableMeshes(root, this.loadedMeshes);
    this.cachedRenderableMeshes = renderableMeshes;
    this.cachedRenderableRoot = root;
    return renderableMeshes;
  }

  private getRenderableBounds(root: Mesh) {
    return getBabylonRenderablePreviewBounds(root, this.loadedMeshes);
  }

  private getSliceRange(): SliceRange | null {
    const range = createSliceRange(this.rootMesh ? this.getRenderableBounds(this.rootMesh) : null, {
      normal: toPreviewWorldPoint(this.sliceNormal),
      offset: this.sliceOffset,
    });
    if (!range || !this.sliceCenter) return range;
    const distance = Vector3.Dot(this.sliceCenter, this.sliceNormal);
    const offset = normalizeSliceOffset((distance - range.min) / range.span);
    this.sliceOffset = offset;
    return { ...range, offset, distance, point: toPreviewWorldPoint(this.sliceCenter) };
  }

  private setSliceCenterFromOffset(offset: number): void {
    if (!this.rootMesh) return;
    const range = createSliceRange(this.getRenderableBounds(this.rootMesh), {
      normal: toPreviewWorldPoint(this.sliceNormal),
      offset,
    });
    if (range) this.sliceCenter = new Vector3(range.point.x, range.point.y, range.point.z);
  }

  private alignSlicePlaneToWorld(): void {
    this.sliceNormal.set(DEFAULT_SLICE_NORMAL.x, DEFAULT_SLICE_NORMAL.y, DEFAULT_SLICE_NORMAL.z);
    this.rebuildSlicePlaneAxes(new Vector3(1, 0, 0));
    this.sliceReferenceNormal.copyFrom(this.sliceNormal);
    this.sliceCenter = null;
    this.setSliceCenterFromOffset(this.sliceOffset);
  }

  private rebuildSlicePlaneAxes(preferredX = this.slicePlaneX): void {
    const normal = this.sliceNormal.clone().normalize();
    const x = preferredX.clone().subtract(normal.scale(Vector3.Dot(preferredX, normal)));
    if (x.lengthSquared() <= 0.000001) {
      x.copyFrom(Math.abs(normal.y) < 0.92 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
      x.subtractInPlace(normal.scale(Vector3.Dot(x, normal)));
    }
    x.normalize();
    this.slicePlaneX.copyFrom(x);
    Vector3.CrossToRef(normal, x, this.slicePlaneY);
    this.slicePlaneY.normalize();
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
    if (!this.rootMesh || !this.sliceActive) return false;
    const target = this.getSlicePointerTarget(event);
    if (!target) return false;
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const mode = target.mode;
    this.sliceInteractionMode = mode;
    const commonState: BabylonSliceDragStateBase = {
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
    canvas.classList.add("ai3d-slice-dragging");
    this.stabilizeCameraForSliceDrag();
    this.camera.detachControl();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Programmatic or canceled touch sequences may not have a capturable pointer.
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.notifySliceChanged();
    this.startRenderLoop();
    return true;
  }

  private getSlicePointerPolar(
    event: Pick<PointerEvent, "clientX" | "clientY">,
    axis: PreviewAxis,
    frozenAxes?: { x: PreviewWorldPoint; y: PreviewWorldPoint; z: PreviewWorldPoint },
    frozenCenter?: PreviewWorldPoint,
  ): { angle: number; radiusRatio: number; rayPlaneAlignment: number } | null {
    const canvas = this.engine.getRenderingCanvas();
    const range = this.getSliceRange();
    if (!canvas || !this.rootMesh || !range) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ray = this.scene.createPickingRay(
      event.clientX - rect.left,
      event.clientY - rect.top,
      Matrix.Identity(),
      this.camera,
    );
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
    const denominator = Vector3.Dot(axisVector, ray.direction);
    if (Math.abs(denominator) <= 0.000001) return null;
    const distance = Vector3.Dot(center.subtract(ray.origin), axisVector) / denominator;
    const hit = ray.origin.add(ray.direction.scale(distance));
    const local = hit.subtract(center);
    const bounds = this.getRenderableBounds(this.rootMesh);
    const radius = Math.max(getPreviewBoundsRadius(bounds) * 0.62, range.span * 0.16, Number.EPSILON);
    return {
      angle: Math.atan2(Vector3.Dot(local, second), Vector3.Dot(local, first)),
      radiusRatio: local.length() / radius,
      rayPlaneAlignment: Math.abs(denominator),
    };
  }

  private getSlicePointerTarget(event: PointerEvent): BabylonSlicePointerTarget | null {
    if (event.altKey || !this.rootMesh) return null;
    const canvas = this.engine.getRenderingCanvas();
    const range = this.getSliceRange();
    if (!canvas || !range) return null;
    const bounds = this.getRenderableBounds(this.rootMesh);
    const rect = canvas.getBoundingClientRect();
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    if (rect.width <= 0 || rect.height <= 0 || renderWidth <= 0 || renderHeight <= 0) return null;
    const viewport = this.camera.viewport.toGlobal(renderWidth, renderHeight);
    const project = (point: PreviewWorldPoint) => {
      const projected = Vector3.Project(
        new Vector3(point.x, point.y, point.z),
        Matrix.Identity(),
        this.scene.getTransformMatrix(),
        viewport,
      );
      return {
        x: rect.left + (projected.x / renderWidth) * rect.width,
        y: rect.top + (projected.y / renderHeight) * rect.height,
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

    let best: BabylonSlicePointerTarget & { mode: "rotate" } | null = null;
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
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length <= Number.EPSILON) continue;
        bestDistance = distance;
        best = {
          mode: "rotate",
          axis,
          screenTangent: { x: (end.x - start.x) / length, y: (end.y - start.y) / length },
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
    event.preventDefault();
    event.stopImmediatePropagation();
    this.pendingSliceMove = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (!this.sliceMoveFrame) {
      this.sliceMoveFrame = window.requestAnimationFrame(() => {
        this.sliceMoveFrame = 0;
        this.flushSliceDragUpdate();
      });
    }
    return true;
  }

  private flushSliceDragUpdate(): void {
    if (this.sliceMoveFrame) {
      window.cancelAnimationFrame(this.sliceMoveFrame);
      this.sliceMoveFrame = 0;
    }
    const sample = this.pendingSliceMove;
    this.pendingSliceMove = null;
    const state = this.sliceDragState;
    if (!sample || !state || state.pointerId !== sample.pointerId) return;
    const dx = sample.clientX - state.startX;
    const dy = sample.clientY - state.startY;
    state.moved = state.moved || Math.hypot(dx, dy) > 2;
    if (state.mode === "rotate") {
      const pointerPolar = this.getSlicePointerPolar(sample, state.axis, {
        x: state.startPlaneX,
        y: state.startPlaneY,
        z: state.startNormal,
      }, state.anchorPoint);
      if (!pointerPolar) return;
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
      const normalDelta = Vector3.DistanceSquared(this.sliceNormal, new Vector3(nextNormal.x, nextNormal.y, nextNormal.z));
      const planeAxesDelta = Vector3.DistanceSquared(this.slicePlaneX, new Vector3(nextPlaneX.x, nextPlaneX.y, nextPlaneX.z))
        + Vector3.DistanceSquared(this.slicePlaneY, new Vector3(nextPlaneY.x, nextPlaneY.y, nextPlaneY.z));
      if (normalDelta <= 0.000001 && planeAxesDelta <= 0.000001) return;
      if (normalDelta > 0.000001) {
        const bounds = this.rootMesh ? this.getRenderableBounds(this.rootMesh) : null;
        this.sliceNormal.set(nextNormal.x, nextNormal.y, nextNormal.z);
        this.sliceCenter = new Vector3(state.anchorPoint.x, state.anchorPoint.y, state.anchorPoint.z);
        this.sliceOffset = createSliceOffsetForPoint(bounds, nextNormal, state.anchorPoint);
      }
      this.slicePlaneX.set(nextPlaneX.x, nextPlaneX.y, nextPlaneX.z);
      this.slicePlaneY.set(nextPlaneY.x, nextPlaneY.y, nextPlaneY.z);
      this.syncSliceClipping();
      this.notifySliceChanged();
      return;
    }
    const delta = dx * state.screenAxis.x + dy * state.screenAxis.y;
    const nextOffset = normalizeSliceOffset(state.startOffset + delta * state.pixelsToOffset);
    if (Math.abs(nextOffset - this.sliceOffset) <= 0.0005) return;
    this.sliceOffset = nextOffset;
    this.setSliceCenterFromOffset(nextOffset);
    this.syncSliceClipping();
    this.notifySliceChanged();
  }

  private endSliceDrag(event: PointerEvent | null, cancelled = false): boolean {
    const state = this.sliceDragState;
    if (!state) return false;
    if (event && state.pointerId !== event.pointerId) return false;
    this.flushSliceDragUpdate();
    const canvas = this.engine.getRenderingCanvas();
    this.sliceDragState = null;
    canvas?.classList.remove("ai3d-slice-dragging");
    this.syncSliceClipping();
    this.camera.attachControl(canvas, true);
    this.resumeCameraAfterSliceDrag();
    if (event && canvas) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be gone after canceled touch/pointer sequences.
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (!cancelled || state.moved) {
      this.notifySliceChanged();
    }
    this.startRenderLoop();
    return true;
  }

  private stabilizeCameraForSliceDrag(): void {
    if (this.focusWorldPointFrame) {
      window.cancelAnimationFrame(this.focusWorldPointFrame);
      this.focusWorldPointFrame = 0;
    }
    this.camera.inertialAlphaOffset = 0;
    this.camera.inertialBetaOffset = 0;
    this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = 0;
    this.camera.inertialPanningY = 0;
    if (this.autoRotateBehavior && !this.sliceAutoRotatePaused) {
      this.camera.removeBehavior(this.autoRotateBehavior);
      this.sliceAutoRotatePaused = true;
    }
  }

  private resumeCameraAfterSliceDrag(): void {
    if (!this.autoRotateBehavior || !this.sliceAutoRotatePaused) return;
    this.camera.addBehavior(this.autoRotateBehavior);
    this.sliceAutoRotatePaused = false;
  }

  private getSliceScreenAxis(): { x: number; y: number } {
    const range = this.getSliceRange();
    if (!this.rootMesh || !range) return { x: 0, y: -1 };
    const bounds = this.getRenderableBounds(this.rootMesh);
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return { x: 0, y: -1 };
    const radius = Math.max(getPreviewBoundsRadius(bounds), range.span * 0.25, Number.EPSILON);
    const center = new Vector3(range.point.x, range.point.y, range.point.z);
    const end = center.add(new Vector3(range.normal.x, range.normal.y, range.normal.z).normalize().scale(radius * 0.35));
    const rw = this.engine.getRenderWidth();
    const rh = this.engine.getRenderHeight();
    if (rw === 0 || rh === 0 || canvas.clientWidth === 0 || canvas.clientHeight === 0) return { x: 0, y: -1 };
    const viewport = this.camera.viewport.toGlobal(rw, rh);
    const projectedCenter = Vector3.Project(center, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    const projectedEnd = Vector3.Project(end, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    const axis = {
      x: projectedEnd.x - projectedCenter.x,
      y: projectedEnd.y - projectedCenter.y,
    };
    const length = Math.hypot(axis.x, axis.y);
    if (!Number.isFinite(length) || length <= 0.000001) return { x: 0, y: -1 };
    return { x: axis.x / length, y: axis.y / length };
  }

  private updateBabylonSlicePlane(range: SliceRange | null): Plane | null {
    const planes = createSliceClipPlanes(range, "babylon");
    if (!planes?.length) return null;
    const source = planes[0];
    if (!this.slicePlane) {
      this.slicePlane = new Plane(source.normal.x, source.normal.y, source.normal.z, source.constant);
    } else {
      this.slicePlane.normal.set(source.normal.x, source.normal.y, source.normal.z);
      this.slicePlane.d = source.constant;
    }
    return this.slicePlane;
  }

  private syncSliceClipping(): void {
    const canvas = this.engine.getRenderingCanvas();
    canvas?.classList.toggle("ai3d-slice-active", this.sliceActive);
    canvas?.classList.toggle("ai3d-slice-rotate", this.sliceActive && this.sliceInteractionMode === "rotate");
    if (!this.rootMesh || !this.sliceActive) {
      this.restoreSliceMaterialClipping();
      this.disposeSliceOverlay(false);
      this.slicePlane = null;
      canvas?.classList.remove("ai3d-slice-dragging");
      canvas?.classList.remove("ai3d-slice-rotate");
      this.startRenderLoop();
      return;
    }

    const range = this.getSliceRange();
    const plane = this.updateBabylonSlicePlane(range);
    if (!plane) {
      this.restoreSliceMaterialClipping();
      this.disposeSliceOverlay(false);
      this.startRenderLoop();
      return;
    }

    this.syncSliceOverlay(range);
    const activeMaterialIds = new Set<number>();
    for (const mesh of this.getRenderableMeshes(this.rootMesh)) {
      const material = mesh.material;
      if (!material) continue;
      activeMaterialIds.add(material.uniqueId);
      const firstBinding = !this.sliceOriginalMaterialClipping.has(material.uniqueId);
      if (firstBinding) {
        this.sliceOriginalMaterialClipping.set(material.uniqueId, {
          material,
          clipPlane: material.clipPlane,
          clipPlane2: material.clipPlane2,
        });
      }
      if (firstBinding || material.clipPlane !== plane) {
        material.clipPlane = plane;
        material.markDirty(true);
      }
    }

    for (const [id, snapshot] of Array.from(this.sliceOriginalMaterialClipping.entries())) {
      if (!activeMaterialIds.has(id)) {
        snapshot.material.clipPlane = snapshot.clipPlane;
        snapshot.material.clipPlane2 = snapshot.clipPlane2;
        snapshot.material.markDirty(true);
        this.sliceOriginalMaterialClipping.delete(id);
      }
    }
    this.startRenderLoop();
  }

  private restoreSliceMaterialClipping(): void {
    for (const snapshot of this.sliceOriginalMaterialClipping.values()) {
      snapshot.material.clipPlane = snapshot.clipPlane;
      snapshot.material.clipPlane2 = snapshot.clipPlane2;
      snapshot.material.markDirty(true);
    }
    this.sliceOriginalMaterialClipping.clear();
  }

  private syncSliceOverlay(range: SliceRange | null): void {
    this.disposeSliceOverlay(false, true);
    const bounds = this.rootMesh ? this.getRenderableBounds(this.rootMesh) : null;
    if (!bounds || !range) return;

    const sliceAxes = {
      x: toPreviewWorldPoint(this.slicePlaneX),
      y: toPreviewWorldPoint(this.slicePlaneY),
      z: toPreviewWorldPoint(this.sliceNormal),
    };
    const planeGeometry = createSlicePlaneGeometry(bounds, range, 0.12, sliceAxes);
    const plane = this.createSliceOverlayPlane(planeGeometry);
    const frameColor = this.sliceInteractionMode === "rotate" ? SLICE_ROTATE_FRAME_COLOR : SLICE_FRAME_COLOR;
    const frame = this.createSliceOverlayLines(planeGeometry.segments, frameColor);
    const normalGuide = this.createSliceOverlayLines(this.createSliceNormalGuide(bounds, range), SLICE_CENTER_FRAME_COLOR);
    const rotationAngles = this.sliceDragState?.mode === "rotate"
      ? { [this.sliceDragState.axis]: this.sliceDragState.currentPointerAngle }
      : undefined;
    const gizmoAxes = this.sliceDragState?.mode === "rotate"
      ? { x: this.sliceDragState.startPlaneX, y: this.sliceDragState.startPlaneY, z: this.sliceDragState.startNormal }
      : sliceAxes;
    const gizmo = createSliceGizmoGeometry(bounds, range, 64, gizmoAxes, rotationAngles);
    const activeAxis = this.sliceDragState?.mode === "rotate" ? this.sliceDragState.axis : null;
    const moveActive = this.sliceDragState?.mode === "move";
    const ringStyle = (axis: PreviewAxis, color: Color3) => ({
      color: activeAxis === axis ? SLICE_GIZMO_ACTIVE_COLOR : color,
      alpha: activeAxis ? (activeAxis === axis ? 0.98 : 0) : moveActive ? 0.1 : 0.34,
      tickAlpha: activeAxis ? (activeAxis === axis ? 0.82 : 0) : moveActive ? 0.04 : 0.14,
    });
    const styleX = ringStyle("x", SLICE_GIZMO_X_COLOR);
    const styleY = ringStyle("y", SLICE_GIZMO_Y_COLOR);
    const styleZ = ringStyle("z", SLICE_GIZMO_Z_COLOR);
    const ringX = this.createSliceOverlayLines(gizmo.rotationRings.x, styleX.color, styleX.alpha);
    const ringY = this.createSliceOverlayLines(gizmo.rotationRings.y, styleY.color, styleY.alpha);
    const ringZ = this.createSliceOverlayLines(gizmo.rotationRings.z, styleZ.color, styleZ.alpha);
    const ticksX = this.createSliceOverlayLines(gizmo.rotationTicks.x, styleX.color, styleX.tickAlpha);
    const ticksY = this.createSliceOverlayLines(gizmo.rotationTicks.y, styleY.color, styleY.tickAlpha);
    const ticksZ = this.createSliceOverlayLines(gizmo.rotationTicks.z, styleZ.color, styleZ.tickAlpha);
    const moveGuide = this.createSliceOverlayLines(gizmo.moveGuide, SLICE_MOVE_COLOR, activeAxis ? 0.22 : 0.96);
    const activeColor = activeAxis === "x"
      ? SLICE_GIZMO_X_COLOR
      : activeAxis === "y" ? SLICE_GIZMO_Y_COLOR : SLICE_GIZMO_Z_COLOR;
    const activeArc = activeAxis ? this.createSliceOverlayLines(gizmo.rotationArcs[activeAxis], activeColor, 1) : null;
    const activeArrowheads = activeAxis
      ? this.createSliceOverlayLines(gizmo.rotationArrowheads[activeAxis], activeColor, 1)
      : null;
    this.sliceOverlayPlanes.push(plane);
    this.sliceOverlayLines.push(frame, normalGuide, ringX, ringY, ringZ, ticksX, ticksY, ticksZ, moveGuide);
    if (activeAxis && activeArc && activeArrowheads) {
      this.sliceOverlayLines.push(activeArc, activeArrowheads);
      const drag = this.sliceDragState;
      if (drag?.mode === "rotate") {
        const degrees = ((drag.currentPointerAngle * 180 / Math.PI) % 360 + 360) % 360;
        const arc = gizmo.rotationArcs[activeAxis];
        const labelPoint = arc[arc.length - 1]?.[1] ?? drag.labelPoint;
        this.updateSliceRotationLabel(
          `${activeAxis.toUpperCase()}: ${degrees.toFixed(1)}°`,
          new Vector3(labelPoint.x, labelPoint.y, labelPoint.z),
          this.getMeasurementMarkerSize() * 2.5,
        );
      }
    } else {
      this.disposeSliceRotationLabel();
    }
  }

  private createSliceOverlayPlane(plane: SlicePlaneGeometry): Mesh {
    const mesh = new Mesh("ai3d-slice-plane", this.scene);
    const corners = plane.corners;
    const positions = [
      corners[0].x, corners[0].y, corners[0].z,
      corners[1].x, corners[1].y, corners[1].z,
      corners[2].x, corners[2].y, corners[2].z,
      corners[3].x, corners[3].y, corners[3].z,
    ];
    const indices = [0, 1, 2, 0, 2, 3];
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.applyToMesh(mesh);

    const material = new StandardMaterial("slice-plane-mat", this.scene);
    const planeColor = this.sliceInteractionMode === "rotate" ? SLICE_ROTATE_PLANE_COLOR : SLICE_PLANE_COLOR;
    material.diffuseColor = planeColor.clone();
    material.emissiveColor = planeColor.scale(0.75);
    material.specularColor = new Color3(0, 0, 0);
    material.alpha = SLICE_PLANE_ALPHA;
    material.backFaceCulling = false;
    material.disableLighting = true;
    material.zOffset = -2;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.renderingGroupId = 2;
    return mesh;
  }

  private createSliceOverlayLines(
    segments: Array<[PreviewWorldPoint, PreviewWorldPoint]>,
    color: Color3,
    alpha = 0.88,
  ): LinesMesh {
    const line = MeshBuilder.CreateLineSystem("ai3d-slice-frame", {
      lines: segments.map(([start, end]) => [
        new Vector3(start.x, start.y, start.z),
        new Vector3(end.x, end.y, end.z),
      ]),
      updatable: false,
    }, this.scene);
    line.color = color.clone();
    line.alpha = alpha;
    line.isPickable = false;
    line.renderingGroupId = 2;
    return line;
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

  private disposeSliceOverlay(startLoop = true, preserveRotationLabel = false): void {
    for (const plane of this.sliceOverlayPlanes) {
      plane.dispose(false, true);
    }
    for (const line of this.sliceOverlayLines) {
      line.dispose(false, true);
    }
    for (const label of this.sliceOverlayLabels) {
      label.dispose(false, true);
    }
    this.sliceOverlayPlanes = [];
    this.sliceOverlayLines = [];
    this.sliceOverlayLabels = [];
    if (!preserveRotationLabel) this.disposeSliceRotationLabel();
    if (startLoop) {
      this.startRenderLoop();
    }
  }

  private updateSliceRotationLabel(text: string, position: Vector3, scale: number): void {
    if (!this.sliceRotationLabel) {
      this.sliceRotationLabel = this.createMeasurementLabelMesh(
        { primary: text, secondary: "" },
        position,
        scale,
      );
      this.sliceRotationLabelText = text;
      return;
    }
    this.sliceRotationLabel.position.copyFrom(position);
    if (text === this.sliceRotationLabelText) return;
    const material = this.sliceRotationLabel.material;
    const texture = material instanceof StandardMaterial && material.diffuseTexture instanceof DynamicTexture
      ? material.diffuseTexture
      : null;
    if (!texture) {
      this.disposeSliceRotationLabel();
      this.updateSliceRotationLabel(text, position, scale);
      return;
    }
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    drawMeasurementLabelCanvas(
      ctx,
      { primary: text, secondary: "" },
      MEASUREMENT_LABEL_CANVAS.width,
      MEASUREMENT_LABEL_CANVAS.height,
    );
    texture.update();
    this.sliceRotationLabelText = text;
  }

  private disposeSliceRotationLabel(): void {
    this.sliceRotationLabel?.dispose(false, true);
    this.sliceRotationLabel = null;
    this.sliceRotationLabelText = "";
  }

  private notifySliceChanged(): void {
    for (const callback of this.sliceObservers) {
      callback();
    }
  }

  private invalidateMeshCache(): void {
    this.cachedRenderableMeshes = null;
    this.cachedRenderableRoot = null;
  }

  private resolvePickHighlightMeshes(mesh: AbstractMesh): AbstractMesh[] {
    if (!this.rootMesh) return [mesh];
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const selectable = findBabylonSelectablePartNode(
      this.rootMesh,
      mesh,
      renderableMeshes,
      this.gltfComponentMetadata,
    );
    const selectedMeshes = renderableMeshes.filter((candidate) => isBabylonNodeOrDescendant(candidate, selectable));
    return selectedMeshes.length > 0 ? selectedMeshes : [mesh];
  }

  private setFocusedNode(node: BabylonSelectablePartNode | null): void {
    if (!this.rootMesh) return;
    const target = node ? this.findSelectableNode(node) : null;
    if (!target || isBabylonNodeDisposed(target)) {
      this.clearFocusedMesh();
      return;
    }
    if (this.focusedNode === target) return;

    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const selectedMeshes = renderableMeshes.filter((candidate) => isBabylonNodeOrDescendant(candidate, target));
    if (selectedMeshes.length === 0) {
      this.clearFocusedMesh();
      return;
    }
    const selectedMeshSet = new Set(selectedMeshes);
    for (const candidate of renderableMeshes) {
      if (!this.originalMeshVisibility.has(candidate.uniqueId)) {
        this.originalMeshVisibility.set(candidate.uniqueId, candidate.visibility);
      }
      const selected = selectedMeshSet.has(candidate);
      candidate.visibility = selected ? 1 : FOCUS_DIM_VISIBILITY;
      candidate.renderOutline = selected;
      candidate.outlineColor = new Color3(0.18, 0.76, 1);
      candidate.outlineWidth = selected ? 0.045 : 0;
    }
    this.focusedNode = target;
  }

  private clearFocusedMesh(): void {
    if (!this.rootMesh) {
      this.focusedNode = null;
      return;
    }

    for (const mesh of this.getRenderableMeshes(this.rootMesh)) {
      const originalVisibility = this.originalMeshVisibility.get(mesh.uniqueId);
      if (originalVisibility !== undefined) {
        mesh.visibility = originalVisibility;
      }
      mesh.renderOutline = false;
      mesh.outlineWidth = 0;
    }
    this.originalMeshVisibility.clear();
    this.focusedNode = null;
    this.applyMeasurementTargetVisual(this.measurementTargetMeshes);
  }

  private findSelectableNode(node: BabylonSelectablePartNode): BabylonSelectablePartNode | null {
    if (!this.rootMesh) return null;
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    if (renderableMeshes.includes(node as AbstractMesh)) return node;
    if (renderableMeshes.some((mesh) => isBabylonNodeOrDescendant(mesh, node))) return node;
    if (!isBabylonMesh(node)) return null;

    let parent = node.parent;
    while (parent && "uniqueId" in parent) {
      const parentNode = parent as BabylonSelectablePartNode;
      if (renderableMeshes.includes(parentNode as AbstractMesh)) return parentNode;
      if (renderableMeshes.some((mesh) => isBabylonNodeOrDescendant(mesh, parentNode))) return parentNode;
      parent = parent.parent;
    }

    return null;
  }

  private getCurrentMeasurementTargetNode(): BabylonSelectablePartNode | null {
    if (
      this.focusSelectionEnabled &&
      this.focusedNode &&
      !isBabylonNodeDisposed(this.focusedNode)
    ) {
      return this.findSelectableNode(this.focusedNode);
    }
    return this.rootMesh && !this.rootMesh.isDisposed() ? this.rootMesh : null;
  }

  private setMeasurementTargetNode(node: BabylonSelectablePartNode | null, notify = true): void {
    this.clearMeasurementTargetVisual(false);
    this.invalidateMeasurementSnapInputCache();
    const target = node && !isBabylonNodeDisposed(node) ? this.findSelectableNode(node) : null;
    if (!target || isBabylonNodeDisposed(target)) {
      this.measurementTargetNode = null;
      this.measurementTargetMeshes = [];
      this.setMeasurementSnapKind(null, false);
      if (notify) {
        this.notifyMeasurementsChanged();
      }
      return;
    }

    const selectedMeshes = this.getMeasurementTargetMeshes(target);
    if (selectedMeshes.length === 0) {
      this.measurementTargetNode = null;
      this.measurementTargetMeshes = [];
      this.setMeasurementSnapKind(null, false);
      if (notify) {
        this.notifyMeasurementsChanged();
      }
      return;
    }

    this.measurementTargetNode = target;
    this.measurementTargetMeshes = selectedMeshes;
    this.setMeasurementSnapKind(null, false);
    this.applyMeasurementTargetVisual(selectedMeshes);
    this.scene.render();
    if (notify) {
      this.notifyMeasurementsChanged();
    }
  }

  private clearMeasurementTargetVisual(render = true): void {
    for (const mesh of this.measurementTargetMeshes) {
      if (mesh.isDisposed()) continue;
      mesh.renderOutline = false;
      mesh.outlineWidth = 0;
    }
    this.measurementTargetMeshes = [];
    if (render && !this.scene.isDisposed) {
      this.scene.render();
    }
  }

  private applyMeasurementTargetVisual(meshes: readonly AbstractMesh[]): void {
    if (!this.measurementActive || meshes.length === 0) return;
    for (const mesh of meshes) {
      if (mesh.isDisposed()) continue;
      mesh.renderOutline = true;
      mesh.outlineColor = new Color3(0.38, 0.65, 0.98);
      mesh.outlineWidth = 0.045;
    }
  }

  private setMeasurementSnapKind(kind: MeasurementSnapKind | null, notify = true): void {
    if (this.measurementSnapKind === kind) return;
    this.measurementSnapKind = kind;
    if (notify) {
      this.notifyMeasurementsChanged();
    }
  }

  private updateMeasurementModifierAltKey(altKey: boolean): void {
    if (this.lastPointerClient.altKey === altKey) return;
    this.lastPointerClient = { ...this.lastPointerClient, altKey };
    if (this.measurementActive && this.pendingPoint) {
      this.updatePreviewLine();
    }
  }

  private invalidateMeasurementSnapInputCache(): void {
    this.measurementSnapInputCache = null;
    this.measurementSnapInputCacheTargetId = null;
    this.measurementSnapInputCacheSignature = null;
  }

  private getMeasurementTargetName(): string | null {
    const target = this.measurementTargetNode;
    if (!target || isBabylonNodeDisposed(target)) return null;
    return getBabylonNodeDisplayName(target, target.name || `node-${target.uniqueId}`);
  }

  private getMeasurementTargetBounds(): PreviewBounds | null {
    if (!this.rootMesh || !this.measurementTargetNode || isBabylonNodeDisposed(this.measurementTargetNode)) {
      return null;
    }
    const target = this.findSelectableNode(this.measurementTargetNode);
    if (!target) return null;
    this.measurementTargetNode = target;
    const selectedMeshes = this.getRenderableMeshes(this.rootMesh)
      .filter((candidate) => isBabylonNodeOrDescendant(candidate, target));
    return getBabylonMeshesPreviewBounds(selectedMeshes);
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
    return toBabylonVector3(snapped.point);
  }

  private createMeasurementGeometrySnapInput(): MeasurementGeometrySnapInput | null {
    const target = this.measurementTargetNode;
    if (!this.rootMesh || !target || isBabylonNodeDisposed(target)) return null;
    const meshes = this.getMeasurementTargetMeshes(target);
    if (meshes.length === 0) return null;
    const signature = this.createMeasurementSnapInputSignature(meshes);
    if (
      this.measurementSnapInputCache &&
      this.measurementSnapInputCacheTargetId === target.uniqueId &&
      this.measurementSnapInputCacheSignature === signature
    ) {
      return this.measurementSnapInputCache;
    }

    const vertices: MeasurementSnapVertexCandidate[] = [];
    const edges: MeasurementSnapEdgeCandidate[] = [];
    const targetId = `babylon:${target.uniqueId}`;

    for (const mesh of meshes) {
      if (mesh.isDisposed()) continue;
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 3) continue;
      const matrix = mesh.computeWorldMatrix(true);
      const objectVertices: PreviewWorldPoint[] = [];
      const vertexCount = Math.floor(positions.length / 3);
      for (let i = 0; i < vertexCount; i++) {
        const local = new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const world = Vector3.TransformCoordinates(local, matrix);
        const previewPoint = this.toMeasurementPoint(world);
        objectVertices.push(previewPoint);
        vertices.push({ point: previewPoint, targetId });
      }
      const triangles = createMeasurementTrianglesFromIndices(vertexCount, mesh.getIndices() ?? null);
      edges.push(...createMeasurementGeometryEdgesFromTriangles(objectVertices, triangles, targetId));
    }

    if (vertices.length === 0 && edges.length === 0) return null;
    const bounds = this.getMeasurementTargetBounds();
    const size = bounds ? getPreviewBoundsSize(bounds) : { x: 1, y: 1, z: 1 };
    const input = {
      vertices,
      edges,
      targetId,
      vertexRadius: createMeasurementVertexSnapRadius(size, edges),
    };
    this.measurementSnapInputCache = input;
    this.measurementSnapInputCacheTargetId = target.uniqueId;
    this.measurementSnapInputCacheSignature = signature;
    return input;
  }

  private createMeasurementSnapInputSignature(meshes: readonly AbstractMesh[]): string {
    return meshes.map((mesh) => {
      const geometryId = "geometry" in mesh && mesh.geometry
        ? (mesh.geometry as { uniqueId?: number }).uniqueId ?? "geometry"
        : "none";
      return [
        mesh.uniqueId,
        geometryId,
        mesh.getTotalVertices(),
        mesh.getTotalIndices(),
        mesh.computeWorldMatrix(true).asArray().map(formatMeasurementSnapSignatureNumber).join(","),
      ].join(":");
    }).join("|");
  }

  private getMeasurementTargetMeshes(target = this.measurementTargetNode): AbstractMesh[] {
    if (!this.rootMesh || !target || isBabylonNodeDisposed(target)) return [];
    return this.getRenderableMeshes(this.rootMesh)
      .filter((candidate) => !candidate.isDisposed() && isBabylonNodeOrDescendant(candidate, target));
  }

  private getMeasurementTargetPickPoint(mesh: AbstractMesh | null | undefined, point: Vector3 | null | undefined): Vector3 | null {
    if (!mesh || mesh.isDisposed() || !point) return null;
    return this.measurementTargetMeshes.includes(mesh) ? point.clone() : null;
  }

  private pickFrontmostMeasurementTargetPoint(clientX: number, clientY: number): Vector3 | null {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || this.measurementTargetMeshes.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pickResult = this.scene.pick(x, y, (mesh) =>
      mesh !== this.previewLine && !this.measurementMarkers.includes(mesh as Mesh));
    return pickResult?.hit
      ? this.getMeasurementTargetPickPoint(pickResult.pickedMesh, pickResult.pickedPoint)
      : null;
  }

  private createBabylonMeasurementDraftingLayout(start: Vector3, end: Vector3): {
    lineSegments: Vector3[][];
    labelPosition: Vector3;
  } | null {
    const displayStart = this.toMeasurementDisplayPoint(start);
    const displayEnd = this.toMeasurementDisplayPoint(end);
    const markerSize = this.getMeasurementMarkerSize();
    const viewUp = this.camera.upVector?.clone?.() ?? new Vector3(0, 1, 0);
    viewUp.normalize();
    const layout = createMeasurementDraftingLayout(
      this.toMeasurementPoint(displayStart),
      this.toMeasurementPoint(displayEnd),
      {
        viewPosition: this.toMeasurementPoint(this.camera.position),
        viewUp: this.toMeasurementPoint(viewUp),
        offset: markerSize * 4.2,
        extensionGap: markerSize * 0.55,
        extensionOvershoot: markerSize * 0.8,
        arrowLength: markerSize * 2.35,
        arrowWidth: markerSize * 0.78,
        labelGap: markerSize * 1.05,
      },
    );
    if (!layout) return null;
    return {
      lineSegments: layout.lineSegments.map(([left, right]) => [
        toBabylonVector3(left),
        toBabylonVector3(right),
      ]),
      labelPosition: toBabylonVector3(layout.labelPoint),
    };
  }

  private getMeasurementMarkerSize(): number {
    if (!this.rootMesh) return 0.02;
    const bounds = this.getRenderableBounds(this.rootMesh);
    if (!bounds) return 0.02;
    const maxSpan = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z, 0.001);
    return maxSpan * 0.018;
  }

  private cancelPendingMeasurement(markDirty = true): void {
    const pendingMarker = this.pendingMarker;
    const pendingPoint = this.pendingPoint?.clone() ?? null;
    this.pendingPoint = null;
    this.pendingMarker = null;
    this.hoveredMarkerIndex = -1;
    if (pendingPoint) {
      this.setMeasurementSnapKind(null, false);
    }
    this.removePreviewLine();

    if (pendingMarker && pendingPoint && !this.isMeasurementPointUsed(pendingPoint)) {
      const index = this.measurementMarkers.indexOf(pendingMarker);
      if (index >= 0) {
        this.measurementMarkers.splice(index, 1);
        this.measurementMarkerPoints.splice(index, 1);
      }
      pendingMarker.dispose(false, true);
    } else if (pendingMarker) {
      pendingMarker.scaling.setAll(1);
      setMeasurementMarkerColor(pendingMarker, MEASUREMENT_MARKER_COLOR);
    }

    if (markDirty) {
      this.scene.render();
    }
  }

  private isMeasurementPointUsed(point: Vector3): boolean {
    return this.measurementSegments.some((segment) =>
      Vector3.Distance(segment.start, point) < 0.0001 || Vector3.Distance(segment.end, point) < 0.0001);
  }

  private findNearestMarkerIndex(point: Vector3): number {
    const threshold = this.getMeasurementMarkerSize() * 2.5;
    const displayPoint = this.toMeasurementDisplayPoint(point);
    for (let i = 0; i < this.measurementMarkers.length; i++) {
      const candidate = this.measurementMarkerPoints[i]
        ? this.toMeasurementDisplayPoint(this.measurementMarkerPoints[i])
        : this.measurementMarkers[i].position;
      if (Vector3.Distance(candidate, displayPoint) < threshold) {
        return i;
      }
    }
    return -1;
  }

  private addMeasurementPoint(point: Vector3): void {
    const basePoint = this.toMeasurementBasePoint(point);
    const existingIndex = this.findNearestMarkerIndex(basePoint);
    const usePoint = existingIndex >= 0
      ? this.measurementMarkerPoints[existingIndex].clone()
      : basePoint;

    if (this.pendingPoint) {
      if (Vector3.Distance(usePoint, this.pendingPoint) < 0.0001) {
        return;
      }
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const marker = MeshBuilder.CreateSphere("measure-marker", { diameter: size * 0.76, segments: 12 }, this.scene);
        marker.position = this.toMeasurementDisplayPoint(usePoint);
        marker.isPickable = false;
        marker.material = createMeasurementMarkerMaterial(this.scene);
        marker.renderingGroupId = 2;
        this.measurementMarkers.push(marker);
        this.measurementMarkerPoints.push(usePoint.clone());
      }
      this.createMeasurementSegment(this.pendingPoint, usePoint);
      if (this.pendingMarker) {
        this.pendingMarker.scaling.setAll(1);
        setMeasurementMarkerColor(this.pendingMarker, MEASUREMENT_MARKER_COLOR);
      }
      this.pendingPoint = null;
      this.pendingMarker = null;
      this.removePreviewLine();
    } else {
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const marker = MeshBuilder.CreateSphere("measure-marker", { diameter: size * 0.76, segments: 12 }, this.scene);
        marker.position = this.toMeasurementDisplayPoint(usePoint);
        marker.isPickable = false;
        marker.material = createMeasurementMarkerMaterial(this.scene);
        marker.renderingGroupId = 2;
        this.measurementMarkers.push(marker);
        this.measurementMarkerPoints.push(usePoint.clone());
        this.pendingMarker = marker;
      } else {
        this.pendingMarker = this.measurementMarkers[existingIndex];
      }
      this.pendingMarker.scaling.setAll(1.6);
      setMeasurementMarkerColor(this.pendingMarker, MEASUREMENT_PENDING_COLOR);
      this.pendingPoint = usePoint;
      this.ensurePreviewLine();
    }
    this.notifyMeasurementsChanged();
  }

  private createMeasurementSegment(start: Vector3, end: Vector3): void {
    const displayStart = this.toMeasurementDisplayPoint(start);
    const displayEnd = this.toMeasurementDisplayPoint(end);
    const layout = this.createBabylonMeasurementDraftingLayout(start, end);
    const line = MeshBuilder.CreateLineSystem("measure-line", {
      lines: layout?.lineSegments ?? [[displayStart, displayEnd]],
    }, this.scene);
    line.color = MEASUREMENT_LINE_COLOR.clone();
    line.alpha = 1;
    line.isPickable = false;
    line.renderingGroupId = 2;

    const labelText = createMeasurementLabel(this.createMeasurementReading(start, end));
    const mid = layout?.labelPosition ?? Vector3.Center(displayStart, displayEnd);
    const label = this.createMeasurementLabelMesh(labelText, mid, this.getMeasurementMarkerSize() * 3.2);

    this.measurementSegments.push({ start: start.clone(), end: end.clone(), line, label });
  }

  private createMeasurementLabelMesh(text: { primary: string; secondary: string }, position: Vector3, scale: number): Mesh {
    const plane = MeshBuilder.CreatePlane("measure-label", { width: scale * 3.7, height: scale * 1.08 }, this.scene);
    plane.position = position;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.renderingGroupId = 2;

    const texture = new DynamicTexture("measure-label-tex", { ...MEASUREMENT_LABEL_CANVAS }, this.scene);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    drawMeasurementLabelCanvas(ctx, text, MEASUREMENT_LABEL_CANVAS.width, MEASUREMENT_LABEL_CANVAS.height);
    texture.update();

    const mat = new StandardMaterial("measure-label-mat", this.scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.opacityTexture = texture;
    mat.useAlphaFromDiffuseTexture = true;
    plane.material = mat;
    return plane;
  }

  private ensurePreviewLine(): void {
    if (this.previewLine) return;
    this.previewLine = MeshBuilder.CreateLineSystem("measure-preview", {
      lines: Array.from({ length: 7 }, () => [Vector3.Zero(), Vector3.Zero()]),
      updatable: true,
    }, this.scene);
    this.previewLine.color = MEASUREMENT_PREVIEW_COLOR.clone();
    this.previewLine.alpha = 0.82;
    this.previewLine.isPickable = false;
    this.previewLine.renderingGroupId = 2;
  }

  private updatePreviewLine(): void {
    if (!this.pendingPoint || !this.previewLine || !this.rootMesh) return;
    const displayStart = this.toMeasurementDisplayPoint(this.pendingPoint);
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = this.lastPointerClient.x - rect.left;
    const y = this.lastPointerClient.y - rect.top;
    let endPoint: Vector3 | null = null;
    if (this.lastPointerClient.altKey) {
      this.setMeasurementSnapKind("free");
      const pickResult = this.scene.pick(x, y, (mesh) => mesh !== this.previewLine && !this.measurementMarkers.includes(mesh as Mesh));
      endPoint = pickResult.hit && pickResult.pickedPoint
        ? this.resolveMeasurementPickPoint(pickResult.pickedPoint, true)
        : displayStart.add(this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera).direction.scale(5));
    } else {
      const targetPoint = this.pickFrontmostMeasurementTargetPoint(this.lastPointerClient.x, this.lastPointerClient.y);
      if (targetPoint) {
        endPoint = this.resolveMeasurementPickPoint(targetPoint, false);
      } else {
        this.setMeasurementSnapKind(null);
      }
    }
    const previewLayout = endPoint
      ? this.createBabylonMeasurementDraftingLayout(this.pendingPoint, this.toMeasurementBasePoint(endPoint))
      : null;
    this.previewLine = MeshBuilder.CreateLineSystem("measure-preview", {
      lines: previewLayout?.lineSegments ?? [[displayStart, displayStart]],
      instance: this.previewLine,
    }, this.scene);
    this.previewLine.color = MEASUREMENT_PREVIEW_COLOR.clone();
    this.previewLine.alpha = 0.82;
    this.previewLine.isPickable = false;
    this.previewLine.renderingGroupId = 2;
  }

  private removePreviewLine(): void {
    if (!this.previewLine) return;
    this.previewLine.dispose();
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

  private createModelSummary(root: Mesh): ModelPreviewSummary {
    const allMeshes = this.getRenderableMeshes(root);
    const isSplat = isGaussianSplattingMesh(root);
    const vertexCount = allMeshes.reduce((total, mesh) => total + getBabylonVertexCount(mesh), 0);
    return createBabylonModelPreviewSummary(
      root.name,
      this.getRenderableBounds(root),
      allMeshes,
      { splatCount: isSplat ? vertexCount : undefined, resourceWarnings: this.resourceWarnings },
    );
  }
}

function formatMeasurementSnapSignatureNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(10) : String(value);
}

export function createBabylonModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new BabylonModelPreview(canvas);
}
