import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
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
import { setupPicking, type PickResult } from "./picking";
import { arrayBufferToBase64 } from "../../utils/base64";
import { isMobile } from "../../utils/device";
import { getPortableBasename, getPortableDirname, getPortableStem, joinPortablePath } from "../../utils/resolve-path";
import { OrientationGizmo } from "./orientation-gizmo";
import { createBabylonDisassemblyController } from "./disassembly";
import {
  createBabylonModelPreviewSummary,
  createBabylonPartPreviewSummary,
  getBabylonMeshesPreviewBounds,
  getBabylonRenderableMeshes,
  getBabylonRenderablePreviewBounds,
  getBabylonTriangleCount,
  getBabylonVertexCount,
} from "./mesh-preview";
import {
  getPreviewBoundsCenter,
  getPreviewBoundsMaxSpan,
  getPreviewBoundsRadius,
  getPreviewBoundsSize,
} from "../preview/bounds";
import { createPreviewOrbitCameraFit } from "../preview/camera-fit";
import type { PreviewDisassemblyController } from "../preview/disassembly";
import {
  createPreviewLineOfSight,
  isPreviewHitOccluded,
  toPreviewWorldPoint,
} from "../preview/geometry";
import {
  createPreviewModelInfoMarkdown,
  createPreviewPartInfoMarkdown,
} from "../preview/report";
import { createPreviewPartSummary } from "../preview/summary";
import { extractPreviewComponentIdentity, type PreviewComponentIdentity } from "../preview/component-identity";
import type {
  AnnotationViewportProvider,
  PreviewAxis,
  PreviewPickResult,
  PreviewProjectionResult,
  PreviewWorldPoint,
  MeasurementScale,
  WorkbenchPreview,
} from "../preview/types";

/** Guard against concurrent OBJ loads monkey-patching the same prototype. */
let objMtlLock: Promise<void> | null = null;
const OBJ_IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];
const OBJ_TEXTURE_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/i;
const FOCUS_DIM_VISIBILITY = 0.242;
const FOCUS_WORLD_POINT_ANIMATION_MS = 320;

function isShadowLight(light: Light): light is IShadowLight {
  const className = light.getClassName();
  return className === "DirectionalLight" || className === "PointLight" || className === "SpotLight";
}

function isGaussianSplattingMesh(mesh: AbstractMesh): boolean {
  return mesh.getClassName() === "GaussianSplattingMesh";
}

function getBabylonNodeDisplayName(node: { name?: string; metadata?: unknown }, fallback: string): string {
  const identity = extractPreviewComponentIdentity(node.metadata, { name: node.name });
  return identity.displayName?.trim() || node.name || fallback;
}

function getBabylonComponentPath(node: { name?: string; parent?: unknown; metadata?: unknown }): string {
  const names: string[] = [];
  let current: unknown = node;
  while (current && typeof current === "object" && "name" in current) {
    const currentNode = current as { name?: string; parent?: unknown; metadata?: unknown };
    const name = getBabylonNodeDisplayName(currentNode, "node");
    if (name.trim()) names.push(name);
    current = currentNode.parent;
  }
  return names.reverse().join("/");
}

function getPartDisplayName(identity: PreviewComponentIdentity, fallback: string): string {
  return identity.displayName?.trim() || identity.partNumber || identity.componentId || fallback;
}

function parseGltfJson(data: ArrayBuffer, extLower: string): Record<string, unknown> | null {
  try {
    if (extLower === "gltf") {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as Record<string, unknown>;
    }
    if (extLower !== "glb") {
      return null;
    }
    const view = new DataView(data);
    if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
      return null;
    }
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    if (jsonChunkType !== 0x4e4f534a || 20 + jsonChunkLength > view.byteLength) {
      return null;
    }
    const jsonBytes = new Uint8Array(data, 20, jsonChunkLength);
    return JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectGltfComponentMetadata(data: ArrayBuffer, extLower: string): Map<string, unknown> {
  const json = parseGltfJson(data, extLower);
  const metadata = new Map<string, unknown>();
  if (!json) return metadata;

  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name && record.extras) {
      metadata.set(`node:${name}`, record.extras);
    }
  }

  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  for (const mesh of meshes) {
    if (!mesh || typeof mesh !== "object") continue;
    const record = mesh as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name && record.extras) {
      metadata.set(`mesh:${name}`, record.extras);
    }
  }

  return metadata;
}

function mergeMetadataFallback(primary: unknown, fallback: unknown): unknown {
  if (fallback === undefined) return primary;
  if (primary === undefined || primary === null) return fallback;
  return { metadata: primary, extras: fallback };
}

function isBabylonMesh(value: unknown): value is AbstractMesh {
  return !!value && typeof value === "object" && "getBoundingInfo" in value;
}

function toBabylonVector3(value: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(value.x, value.y, value.z);
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
  private loadedExt: string = "";
  private rendering = false;
  private contextLost = false;
  private viewportVisible = true;
  private viewportObserver: IntersectionObserver | null = null;
  private cleanupPicking: (() => void) | null = null;
  private resizeObs: ResizeObserver;
  private configLights: Light[] = [];
  private shadowGenerator: ShadowGenerator | null = null;
  private groundMesh: Mesh | null = null;
  private gridMesh: Mesh | null = null;
  private axisMeshes: Mesh[] = [];
  private autoRotateBehavior: AutoRotationBehavior | null = null;
  private wireframeEnabled = false;
  private gizmo: OrientationGizmo | null = null;
  private gizmoEnabled = false;
  private disassembly: PreviewDisassemblyController | null = null;
  private focusSelectionEnabled = false;
  private focusedMesh: AbstractMesh | null = null;
  private readonly originalMeshVisibility = new Map<number, number>();
  private bboxMesh: Mesh | null = null;
  private bboxEnabled = false;
  private currentQuality: "low" | "medium" | "high" = "high";
  private resourceWarnings: string[] = [];
  private gltfComponentMetadata = new Map<string, unknown>();
  private animPlaying = false;
  private initialCamera = { alpha: Math.PI / 4, beta: Math.PI / 3, radius: 5, target: Vector3.Zero() };
  private focusWorldPointFrame = 0;
  private _lastPickResult: PickResult = { mesh: null, pickedPoint: null, screenX: 0, screenY: 0 };
  private _onPickCallbacks: Array<(result: PreviewPickResult) => void> = [];
  private measurementActive = false;
  private measurementScale: MeasurementScale = { x: 1, y: 1, z: 1 };
  private measurementUnit = "mm";
  private measurementSegments: Array<{ start: Vector3; end: Vector3; line: Mesh; label: Mesh }> = [];
  private measurementMarkers: Mesh[] = [];
  private pendingPoint: Vector3 | null = null;
  private pendingMarker: Mesh | null = null;
  private hoveredMarkerIndex = -1;
  private lastPointerClient = { x: 0, y: 0 };
  private previewLine: Mesh | null = null;
  private readonly handlePointerMove = (event: PointerEvent) => {
    this.lastPointerClient = { x: event.clientX, y: event.clientY };
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
          (prev.material as StandardMaterial).diffuseColor = new Color3(1, 0.42, 0.42);
          (prev.material as StandardMaterial).emissiveColor = new Color3(1, 0.42, 0.42);
        }
      }
      if (newHover >= 0 && newHover < this.measurementMarkers.length) {
        const next = this.measurementMarkers[newHover];
        next.scaling.setAll(1.6);
        (next.material as StandardMaterial).diffuseColor = new Color3(1, 0.83, 0.23);
        (next.material as StandardMaterial).emissiveColor = new Color3(1, 0.83, 0.23);
      }
      this.hoveredMarkerIndex = newHover;
    }
  };
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  private canRender(): boolean {
    const canvas = this.engine.getRenderingCanvas();
    return !!canvas?.isConnected && canvas.clientWidth > 0 && canvas.clientHeight > 0;
  }

  private ensureDisassemblyController(): PreviewDisassemblyController | null {
    if (!this.rootMesh) {
      return null;
    }
    if (!this.disassembly) {
      this.disassembly = createBabylonDisassemblyController(
        this.scene,
        this.camera,
        this.getRenderableMeshes(this.rootMesh),
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
    this.camera.wheelPrecision = 30;
    canvas.addEventListener("wheel", this.preventCanvasWheelScroll, { passive: false });
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

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
  ): Promise<ModelPreviewSummary> {
    await ensureLoadersRegistered();

    if (this.rootMesh) {
      const previousRoot = this.rootMesh;
      previousRoot.dispose(true, true);
      for (const mesh of this.loadedMeshes) {
        if (mesh !== previousRoot && !mesh.isDisposed()) {
          mesh.dispose(true, true);
        }
      }
      this.rootMesh = null;
    }
    this.loadedMeshes = [];
    this.loadedTransformNodes = [];
    this.clearMeasurements();
    this.disassembly?.dispose();
    this.disassembly = null;
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();

    const extLower = ext.toLowerCase().replace(".", "");
    this.loadedExt = extLower;
    this.resourceWarnings = [];
    this.gltfComponentMetadata = collectGltfComponentMetadata(data, extLower);
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
    const dataUrl = `data:application/octet-stream;base64,${arrayBufferToBase64(data)}`;

    // OBJ: override _loadMTL to read MTL from vault instead of network fetch.
    // Serialized via objMtlLock to prevent concurrent loads from clobbering the prototype.
    if (extLower === "obj" && readFile && modelPath) {
      if (objMtlLock) await objMtlLock;
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
                  const texBuf = await readFile(cand);
                  const dataUrl = `data:${guessTextureMime(cand)};base64,${arrayBufferToBase64(texBuf)}`;
                  lines[i] = `${m[1]} ${dataUrl}`;
                  resolved = true;
                  break;
                } catch { /* try next candidate */ }
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
          } catch {
            this.resourceWarnings.push(`OBJ material library not found: ${mtlPath}`);
          }
        }

        // Override _loadMTL to use vault content or skip (prevents network fetch)
        proto._loadMTL = function(_url: string, _rootUrl: string, onSuccess: (data: string) => void) {
          const content = mtlContent ?? "";
          onSuccess(content);
        };

        const result = await ImportMeshAsync(dataUrl, scene, { meshNames: "", pluginExtension: fileExt });
        this.loadedMeshes = result.meshes;
        this.loadedTransformNodes = result.transformNodes;
        if (result.meshes.length > 0) this.rootMesh = result.meshes[0] as Mesh;

        // Restore original _loadMTL
        proto._loadMTL = originalLoadMTL;
      } catch (e) {
        console.error("[AI3D] OBJ load error:", e);
        throw e;
      } finally {
        resolveLock();
        objMtlLock = null;
      }
    } else if (extLower === "stl") {
      // Direct parse — Babylon v9 SceneLoader mishandles data URLs for custom plugins
      this.rootMesh = loadSTLBuffer(scene, data);
      if (this.rootMesh) this.loadedMeshes = [this.rootMesh];
    } else if (extLower === "ply") {
      // Direct parse — same Babylon v9 data-URL issue as STL
      this.rootMesh = loadPLYBuffer(scene, data);
      if (this.rootMesh) this.loadedMeshes = [this.rootMesh];
    } else {
      const result = await ImportMeshAsync(dataUrl, scene, { meshNames: "", pluginExtension: fileExt });
      this.loadedMeshes = result.meshes;
      this.loadedTransformNodes = result.transformNodes;
      if (result.meshes.length > 0) this.rootMesh = result.meshes[0] as Mesh;
    }

    if (!this.rootMesh) {
      throw new Error("No mesh found in model file");
    }

    // Disable backface culling on all materials to prevent invisible faces
    // (CAD-converted models often have inconsistent face normals)
    for (const m of this.getRenderableMeshes(this.rootMesh)) {
      if (m.material) {
        m.material.backFaceCulling = false;
      }
    }

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

    this.startRenderLoop();
    this.engine.resize();

    this.cleanupPicking?.();
    this.cleanupPicking = setupPicking(this.scene, (result) => {
      if (this.isDisassemblyActive()) return;
      if (this.measurementActive && result.pickedPoint) {
        this.addMeasurementPoint(toBabylonVector3(result.pickedPoint));
        return;
      }
      this._lastPickResult = result;
      if (this.focusSelectionEnabled && result.mesh) {
        this.setFocusedMesh(result.mesh);
      }
      this._onPickCallbacks.forEach(cb => cb(result));
    }, () => !this.focusSelectionEnabled);
    this.ensureDisassemblyController();

    return this.computeSummary(this.rootMesh);
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

    if (config.autoRotate) {
      if (!this.autoRotateBehavior) {
        this.autoRotateBehavior = new AutoRotationBehavior();
        this.autoRotateBehavior.idleRotationSpeed = config.autoRotateSpeed ?? 0.5;
        this.autoRotateBehavior.idleRotationWaitTime = 1000;
        this.autoRotateBehavior.idleRotationSpinupTime = 500;
        this.camera.addBehavior(this.autoRotateBehavior);
      } else {
        this.autoRotateBehavior.idleRotationSpeed = config.autoRotateSpeed ?? 0.5;
      }
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
    this.measurementActive = !this.measurementActive;
    if (!this.measurementActive) {
      this.clearMeasurements();
    }
    return this.measurementActive;
  }

  isMeasurementActive(): boolean {
    return this.measurementActive;
  }

  clearMeasurements(): void {
    this.measurementActive = false;
    this.pendingPoint = null;
    this.pendingMarker = null;
    this.hoveredMarkerIndex = -1;
    this.removePreviewLine();
    for (const segment of this.measurementSegments) {
      segment.line.dispose();
      segment.label.dispose();
    }
    this.measurementSegments = [];
    for (const marker of this.measurementMarkers) {
      marker.dispose();
    }
    this.measurementMarkers = [];
  }


  setMeasurementScale(scale: MeasurementScale): void {
    this.measurementScale = { ...scale };
    this.updateMeasurementLabels();
  }

  getMeasurementScale(): MeasurementScale {
    return { ...this.measurementScale };
  }

  getMeasurementBounds(): { x: number; y: number; z: number } | null {
    if (!this.rootMesh) return null;
    const bounds = this.getRenderableBounds(this.rootMesh);
    if (!bounds) return null;
    return {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    };
  }

  private getRealDistance(start: Vector3, end: Vector3): number {
    const dx = (end.x - start.x) * this.measurementScale.x;
    const dy = (end.y - start.y) * this.measurementScale.y;
    const dz = (end.z - start.z) * this.measurementScale.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private formatMeasurementDistance(distance: number): string {
    const unit = this.measurementUnit;
    if (unit === "um" || unit === "μm") {
      return distance < 1000 ? `${distance.toFixed(2)} μm` : `${(distance / 1000).toFixed(2)} mm`;
    }
    if (unit === "mm") {
      return distance < 1 ? `${(distance * 1000).toFixed(2)} μm` : distance < 1000 ? `${distance.toFixed(2)} mm` : `${(distance / 1000).toFixed(3)} m`;
    }
    if (unit === "cm") {
      return distance < 1 ? `${(distance * 10).toFixed(2)} mm` : distance < 100 ? `${distance.toFixed(2)} cm` : `${(distance / 100).toFixed(3)} m`;
    }
    if (unit === "m") {
      return distance < 0.01 ? `${(distance * 1000).toFixed(2)} mm` : distance < 1 ? `${distance.toFixed(3)} m` : `${distance.toFixed(2)} m`;
    }
    return `${distance.toFixed(3)} ${unit}`;
  }

  updateMeasurementLabels(): void {
    if (this.measurementSegments.length === 0) return;
    const markerSize = this.getMeasurementMarkerSize() * 4;
    for (const segment of this.measurementSegments) {
      const distance = this.getRealDistance(segment.start, segment.end);
      const labelText = this.formatMeasurementDistance(distance);
      segment.label.dispose(false, true);
      const mid = Vector3.Center(segment.start, segment.end);
      segment.label = this.createMeasurementLabelMesh(labelText, mid, markerSize);
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
    const qualityScale = { low: 2, medium: 1.33, high: 1 }[this.currentQuality];
    const mobileBoost = isMobile() ? 1.5 : 1;
    this.engine.setHardwareScalingLevel(qualityScale * mobileBoost / clamped);
    return clamped;
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

  toggleFocusSelection(): boolean {
    const nextEnabled = !this.focusSelectionEnabled;
    if (nextEnabled && this.isDisassemblyActive()) {
      this.disassembly?.setEnabled(false);
    }
    this.focusSelectionEnabled = nextEnabled;
    if (!this.focusSelectionEnabled) {
      this.clearFocusedMesh();
    } else if (this._lastPickResult.mesh) {
      this.setFocusedMesh(this._lastPickResult.mesh);
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
    }
    return controller.setEnabled(nextEnabled);
  }

  resetDisassembly(): void {
    this.disassembly?.reset();
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
  }

  exportModelInfo(modelPath?: string): string {
    if (!this.rootMesh) return "";
    const summary = this.computeSummary(this.rootMesh);
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const isSplat = isGaussianSplattingMesh(this.rootMesh);
    const name = modelPath ? getPortableBasename(modelPath) || summary.rootName : summary.rootName;
    return createPreviewModelInfoMarkdown({
      title: name,
      format: this.loadedExt.toUpperCase(),
      summary,
      meshBreakdown: renderableMeshes.map((mesh) => ({
        name: mesh.name,
        triangleCount: isSplat ? null : getBabylonTriangleCount(mesh),
        vertexCount: getBabylonVertexCount(mesh),
        materialName: mesh.material?.name ?? null,
      })),
      materialNames: renderableMeshes.map((mesh) => mesh.material?.name),
    });
  }

  getModelEvidence(): ModelEvidence | null {
    if (!this.rootMesh) return null;
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    const groupedPartCandidates = this.computeComponentPartSummaries(renderableMeshes);
    const meshParts = renderableMeshes
      .filter((mesh) => !groupedPartCandidates.groupedMeshes.has(mesh))
      .map((mesh) => this.computePartSummary(mesh));
    const parts = groupedPartCandidates.parts.length > 0 ? [...groupedPartCandidates.parts, ...meshParts] : meshParts;
    const materialNames = new Set<string>();
    for (const mesh of renderableMeshes) {
      if (mesh.material?.name) materialNames.add(mesh.material.name);
    }
    return {
      summary: this.computeSummary(this.rootMesh),
      parts,
      materialNames: Array.from(materialNames).sort((left, right) => left.localeCompare(right)),
      resourceWarnings: [...this.resourceWarnings],
      capturedAt: new Date().toISOString(),
    };
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    const mesh = this.focusedMesh ?? this._lastPickResult.mesh;
    const renderable = mesh ? this.findRenderableMesh(mesh) : null;
    if (!renderable || renderable.isDisposed()) return null;
    return this.computePartSummary(renderable);
  }

  exportSelectedPartInfo(): string {
    const part = this.getSelectedPartInfo();
    return part ? createPreviewPartInfoMarkdown(part) : "";
  }

  getPickWorldPoint(result: PreviewPickResult): PreviewWorldPoint | null {
    if (result.pickedPoint && typeof result.pickedPoint === "object") {
      return toPreviewWorldPoint(result.pickedPoint as { x: number; y: number; z: number });
    }

    if (isBabylonMesh(result.mesh)) {
      const center = result.mesh.getBoundingInfo().boundingBox.centerWorld;
      return toPreviewWorldPoint(center);
    }

    return null;
  }

  focusWorldPoint(point: PreviewWorldPoint): void {
    const target = new Vector3(point.x, point.y, point.z);
    const start = this.camera.target.clone();
    const startedAt = performance.now();

    if (this.focusWorldPointFrame) {
      activeWindow.cancelAnimationFrame(this.focusWorldPointFrame);
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
    return `${this.camera.alpha.toFixed(3)}_${this.camera.beta.toFixed(3)}_${this.camera.radius.toFixed(3)}_${this.camera.target.x.toFixed(2)}_${this.camera.target.y.toFixed(2)}_${this.camera.target.z.toFixed(2)}`;
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

    const scaleX = canvas.clientWidth / rw;
    const scaleY = canvas.clientHeight / rh;
    result.screenX = BabylonModelPreview.annotationProjection.x * scaleX;
    result.screenY = BabylonModelPreview.annotationProjection.y * scaleY;
    result.depth = BabylonModelPreview.annotationProjection.z;
    return true;
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
    return {
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
    };
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
  setRenderQuality(quality: "low" | "medium" | "high", renderScale = 1.0): void {
    this.currentQuality = quality;
    const scaleMap = { low: 2, medium: 1.33, high: 1 };
    const mobileBoost = isMobile() ? 1.5 : 1;
    // hardwareScalingLevel: higher = fewer pixels. renderScale < 1 = fewer pixels.
    const scale = scaleMap[quality] * mobileBoost / Math.max(renderScale, 0.25);
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
      activeWindow.cancelAnimationFrame(this.focusWorldPointFrame);
      this.focusWorldPointFrame = 0;
    }
    this._onPickCallbacks = [];
    this.cleanupPicking?.();
    this.cleanupPicking = null;
    this.gizmo?.dispose();
    this.gizmo = null;
    this.disassembly?.dispose();
    this.disassembly = null;
    this.clearMeasurements();
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();
    this.bboxMesh?.dispose();
    this.bboxMesh = null;
    this.camera.detachControl();
    const canvas = this.engine.getRenderingCanvas();
    canvas?.removeEventListener("wheel", this.preventCanvasWheelScroll);
    canvas?.removeEventListener("pointermove", this.handlePointerMove);
    canvas?.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas?.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    this.resizeObs.disconnect();
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
    return getBabylonRenderableMeshes(root, this.loadedMeshes);
  }

  private getRenderableBounds(root: Mesh) {
    return getBabylonRenderablePreviewBounds(root, this.loadedMeshes);
  }

  private setFocusedMesh(mesh: AbstractMesh | null): void {
    if (!this.rootMesh) return;
    const target = mesh ? this.findRenderableMesh(mesh) : null;
    if (!target || target.isDisposed()) {
      this.clearFocusedMesh();
      return;
    }
    if (this.focusedMesh === target) return;

    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    for (const candidate of renderableMeshes) {
      if (!this.originalMeshVisibility.has(candidate.uniqueId)) {
        this.originalMeshVisibility.set(candidate.uniqueId, candidate.visibility);
      }
      const selected = candidate === target;
      candidate.visibility = selected ? 1 : FOCUS_DIM_VISIBILITY;
      candidate.renderOutline = selected;
      candidate.outlineColor = new Color3(0.18, 0.76, 1);
      candidate.outlineWidth = selected ? 0.045 : 0;
    }
    this.focusedMesh = target;
  }

  private clearFocusedMesh(): void {
    if (!this.rootMesh) {
      this.focusedMesh = null;
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
    this.focusedMesh = null;
  }

  private findRenderableMesh(mesh: AbstractMesh): AbstractMesh | null {
    if (!this.rootMesh) return null;
    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    if (renderableMeshes.includes(mesh)) return mesh;

    let parent = mesh.parent;
    while (parent && "uniqueId" in parent) {
      const parentMesh = parent as AbstractMesh;
      if (renderableMeshes.includes(parentMesh)) return parentMesh;
      parent = parent.parent;
    }

    return null;
  }

  private computePartSummary(mesh: AbstractMesh): ModelPartSummary {
    const name = mesh.name || `mesh-${mesh.uniqueId}`;
    const metadata = mergeMetadataFallback(
      mesh.metadata,
      this.gltfComponentMetadata.get(`node:${name}`) ?? this.gltfComponentMetadata.get(`mesh:${name}`),
    );
    const identity = extractPreviewComponentIdentity(metadata, {
      name,
      path: getBabylonComponentPath(mesh),
    });
    return {
      ...createBabylonPartPreviewSummary(mesh),
      name: getPartDisplayName(identity, name),
      source: identity.hasExplicitIdentity ? "component" : "mesh",
      meshNames: [name],
      childCount: 1,
      componentId: identity.componentId,
      occurrenceId: identity.occurrenceId,
      partNumber: identity.partNumber,
      componentPath: identity.componentPath,
    };
  }

  private computeComponentPartSummaries(renderableMeshes: readonly AbstractMesh[]): {
    parts: ModelPartSummary[];
    groupedMeshes: Set<AbstractMesh>;
  } {
    const renderableSet = new Set(renderableMeshes);
    const parts: ModelPartSummary[] = [];
    const groupedMeshes = new Set<AbstractMesh>();
    const candidates: Array<{
      node: TransformNode;
      childMeshes: AbstractMesh[];
      identity: PreviewComponentIdentity;
    }> = [];
    for (const node of this.loadedTransformNodes) {
      const childMeshes = node.getChildMeshes(false).filter((mesh) => renderableSet.has(mesh));
      const nodeName = getBabylonNodeDisplayName(node, `component-${node.uniqueId}`);
      const metadata = mergeMetadataFallback(node.metadata, this.gltfComponentMetadata.get(`node:${nodeName}`));
      const identity = extractPreviewComponentIdentity(metadata, {
        name: getBabylonNodeDisplayName(node, `component-${node.uniqueId}`),
        path: getBabylonComponentPath(node),
      });
      if (childMeshes.length < 1 || childMeshes.length === renderableMeshes.length) {
        continue;
      }
      if (!identity.hasExplicitIdentity && (!node.name.trim() || childMeshes.length < 2)) {
        continue;
      }
      candidates.push({ node, childMeshes, identity });
    }

    candidates
      .sort((left, right) => left.childMeshes.length - right.childMeshes.length)
      .forEach(({ node, childMeshes, identity }) => {
      const availableMeshes = childMeshes.filter((mesh) => !groupedMeshes.has(mesh));
      if (availableMeshes.length < 1) return;
      if (!identity.hasExplicitIdentity && availableMeshes.length < 2) return;
      for (const mesh of availableMeshes) {
        groupedMeshes.add(mesh);
      }
      const bounds = getBabylonMeshesPreviewBounds(availableMeshes);
      if (!bounds) return;
      const materialNames = new Set<string>();
      let triangleCount = 0;
      let vertexCount = 0;
      for (const mesh of availableMeshes) {
        triangleCount += getBabylonTriangleCount(mesh);
        vertexCount += getBabylonVertexCount(mesh);
        if (mesh.material?.name) {
          materialNames.add(mesh.material.name);
        }
      }
      parts.push(createPreviewPartSummary({
        name: getPartDisplayName(identity, getBabylonNodeDisplayName(node, `component-${node.uniqueId}`)),
        triangleCount,
        vertexCount,
        materialName: materialNames.size === 0
          ? null
          : materialNames.size === 1
            ? Array.from(materialNames)[0]
            : `${materialNames.size} materials`,
        boundingSize: getPreviewBoundsSize(bounds),
        center: getPreviewBoundsCenter(bounds),
        source: identity.hasExplicitIdentity ? "component" : "group",
        meshNames: availableMeshes.map((mesh) => mesh.name || `mesh-${mesh.uniqueId}`),
        childCount: availableMeshes.length,
        componentId: identity.componentId,
        occurrenceId: identity.occurrenceId,
        partNumber: identity.partNumber,
        componentPath: identity.componentPath,
      }));
      });
    return { parts, groupedMeshes };
  }

  private getMeasurementMarkerSize(): number {
    if (!this.rootMesh) return 0.02;
    const bounds = this.getRenderableBounds(this.rootMesh);
    if (!bounds) return 0.02;
    const maxSpan = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z, 0.001);
    return maxSpan * 0.015;
  }

  private findNearestMarkerIndex(point: Vector3): number {
    const threshold = this.getMeasurementMarkerSize() * 2.5;
    for (let i = 0; i < this.measurementMarkers.length; i++) {
      if (Vector3.Distance(this.measurementMarkers[i].position, point) < threshold) {
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
      if (Vector3.Distance(usePoint, this.pendingPoint) < 0.0001) {
        return;
      }
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const marker = MeshBuilder.CreateSphere("measure-marker", { diameter: size }, this.scene);
        marker.position = usePoint;
        marker.isPickable = false;
        const mat = new StandardMaterial("measure-marker-mat", this.scene);
        mat.diffuseColor = new Color3(1, 0.42, 0.42);
        mat.emissiveColor = new Color3(1, 0.42, 0.42);
        marker.material = mat;
        marker.renderingGroupId = 2;
        this.measurementMarkers.push(marker);
      }
      this.createMeasurementSegment(this.pendingPoint, usePoint);
      if (this.pendingMarker) {
        this.pendingMarker.scaling.setAll(1);
        (this.pendingMarker.material as StandardMaterial).diffuseColor = new Color3(1, 0.42, 0.42);
        (this.pendingMarker.material as StandardMaterial).emissiveColor = new Color3(1, 0.42, 0.42);
      }
      this.pendingPoint = null;
      this.pendingMarker = null;
      this.removePreviewLine();
    } else {
      if (existingIndex < 0) {
        const size = this.getMeasurementMarkerSize();
        const marker = MeshBuilder.CreateSphere("measure-marker", { diameter: size }, this.scene);
        marker.position = usePoint;
        marker.isPickable = false;
        const mat = new StandardMaterial("measure-marker-mat", this.scene);
        mat.diffuseColor = new Color3(1, 0.42, 0.42);
        mat.emissiveColor = new Color3(1, 0.42, 0.42);
        marker.material = mat;
        marker.renderingGroupId = 2;
        this.measurementMarkers.push(marker);
        this.pendingMarker = marker;
      } else {
        this.pendingMarker = this.measurementMarkers[existingIndex];
      }
      this.pendingMarker.scaling.setAll(1.6);
      (this.pendingMarker.material as StandardMaterial).diffuseColor = new Color3(0.32, 0.81, 0.4);
      (this.pendingMarker.material as StandardMaterial).emissiveColor = new Color3(0.32, 0.81, 0.4);
      this.pendingPoint = usePoint;
      this.ensurePreviewLine();
    }
  }

  private createMeasurementSegment(start: Vector3, end: Vector3): void {
    const line = MeshBuilder.CreateLines("measure-line", { points: [start, end] }, this.scene);
    line.color = new Color3(1, 0.42, 0.42);
    line.isPickable = false;
    line.renderingGroupId = 2;

    const distance = this.getRealDistance(start, end);
    const labelText = this.formatMeasurementDistance(distance);
    const mid = Vector3.Center(start, end);
    const label = this.createMeasurementLabelMesh(labelText, mid, this.getMeasurementMarkerSize() * 4);

    this.measurementSegments.push({ start, end, line, label });
  }

  private createMeasurementLabelMesh(text: string, position: Vector3, scale: number): Mesh {
    const plane = MeshBuilder.CreatePlane("measure-label", { width: scale * 4, height: scale }, this.scene);
    plane.position = position;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.renderingGroupId = 2;

    const texture = new DynamicTexture("measure-label-tex", { width: 512, height: 128 }, this.scene);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "rgba(32, 36, 46, 0.9)";
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 512, 128);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);
    texture.update();

    const mat = new StandardMaterial("measure-label-mat", this.scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.opacityTexture = texture;
    plane.material = mat;
    return plane;
  }

  private ensurePreviewLine(): void {
    if (this.previewLine) return;
    this.previewLine = MeshBuilder.CreateLines("measure-preview", { points: [Vector3.Zero(), Vector3.Zero()] }, this.scene);
    (this.previewLine as LinesMesh).color = new Color3(1, 1, 1);
    (this.previewLine as LinesMesh).alpha = 0.5;
    this.previewLine.isPickable = false;
    this.previewLine.renderingGroupId = 2;
  }

  private updatePreviewLine(): void {
    if (!this.pendingPoint || !this.previewLine || !this.rootMesh) return;
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = this.lastPointerClient.x - rect.left;
    const y = this.lastPointerClient.y - rect.top;
    const pickResult = this.scene.pick(x, y, (mesh) => mesh !== this.previewLine && !this.measurementMarkers.includes(mesh as Mesh));
    let endPoint: Vector3;
    if (pickResult.hit && pickResult.pickedPoint) {
      endPoint = pickResult.pickedPoint;
    } else {
      const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
      endPoint = this.pendingPoint.add(ray.direction.scale(5));
    }
    this.previewLine.dispose();
    this.previewLine = MeshBuilder.CreateLines("measure-preview", { points: [this.pendingPoint, endPoint] }, this.scene);
    (this.previewLine as LinesMesh).color = new Color3(1, 1, 1);
    (this.previewLine as LinesMesh).alpha = 0.5;
    this.previewLine.isPickable = false;
    this.previewLine.renderingGroupId = 2;
  }

  private removePreviewLine(): void {
    if (!this.previewLine) return;
    this.previewLine.dispose();
    this.previewLine = null;
  }

  private computeSummary(root: Mesh): ModelPreviewSummary {
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

export function createBabylonModelPreview(canvas: HTMLCanvasElement): WorkbenchPreview {
  return new BabylonModelPreview(canvas);
}
