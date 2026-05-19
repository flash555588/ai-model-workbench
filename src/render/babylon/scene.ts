import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import { AutoRotationBehavior } from "@babylonjs/core/Behaviors/Cameras/autoRotationBehavior.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Light } from "@babylonjs/core/Lights/light.js";
import type { IShadowLight } from "@babylonjs/core/Lights/shadowLight.js";
import type {
  ModelPreviewSummary,
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
import { getPortableBasename, getPortableDirname, getPortableStem } from "../../utils/resolve-path";
import { OrientationGizmo } from "./orientation-gizmo";
import { DisassemblyController } from "./disassembly";

/** Guard against concurrent OBJ loads monkey-patching the same prototype. */
let objMtlLock: Promise<void> | null = null;

function isShadowLight(light: Light): light is IShadowLight {
  const className = light.getClassName();
  return className === "DirectionalLight" || className === "PointLight" || className === "SpotLight";
}

function isGaussianSplattingMesh(mesh: AbstractMesh): boolean {
  return mesh.getClassName() === "GaussianSplattingMesh";
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export class BabylonModelPreview {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private rootMesh: Mesh | null = null;
  private loadedMeshes: AbstractMesh[] = [];
  private loadedExt: string = "";
  private rendering = false;
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
  private disassembly: DisassemblyController | null = null;
  private disassemblyEnabled = false;
  private focusSelectionEnabled = false;
  private focusedMesh: AbstractMesh | null = null;
  private readonly originalMeshVisibility = new Map<number, number>();
  private bboxMesh: Mesh | null = null;
  private bboxEnabled = false;
  private currentQuality: "low" | "medium" | "high" = "high";
  private animPlaying = false;
  private initialCamera = { alpha: Math.PI / 4, beta: Math.PI / 3, radius: 5, target: Vector3.Zero() };
  private _lastPickResult: PickResult = { mesh: null, pickedPoint: null, screenX: 0, screenY: 0 };
  private _onPickCallbacks: ((result: PickResult) => void)[] = [];
  private readonly preventCanvasWheelScroll = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  private canRender(): boolean {
    const canvas = this.engine.getRenderingCanvas();
    return !!canvas?.isConnected && canvas.clientWidth > 0 && canvas.clientHeight > 0;
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

    this.scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    const hemi = new HemisphericLight("default-light", new Vector3(0, 1, 0.5), this.scene);
    hemi.intensity = 1.2;

    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas);
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
      this.rootMesh.dispose(true, true);
      this.rootMesh = null;
    }
    this.loadedMeshes = [];
    this.disassembly?.dispose();
    this.disassembly = null;
    this.disassemblyEnabled = false;
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();

    const extLower = ext.toLowerCase().replace(".", "");
    this.loadedExt = extLower;
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
        let texCount = 0;
        let texMissing = 0;
        if (mtlMatch && readFile && modelPath) {
          const mtlFilename = mtlMatch[1].trim().split(/\s+/)[0];
          const modelDir = getPortableDirname(modelPath);
          const mtlPath = modelDir ? `${modelDir}/${mtlFilename}` : mtlFilename;
          try {
            const mtlData = await readFile(mtlPath);
            const raw = new TextDecoder().decode(new Uint8Array(mtlData));
            const lines = raw.split("\n");

            // Resolve texture files referenced in MTL from vault.
            // Try: 1) full relative path, 2) same-dir filename,
            //      3) OBJ-name with image extensions (e.g. bat.jpeg),
            //      4) common basecolor/texture names in same dir
            const TEX_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/i;
            const objBasename = getPortableStem(modelPath);
            const IMG_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];
            for (let i = 0; i < lines.length; i++) {
              const m = lines[i].match(TEX_RE);
              if (!m) continue;
              const rawPath = m[2].trim();
              const texFilename = getPortableBasename(rawPath);
              const texBase = texFilename.replace(/\.[^.]+$/, "");
              // Build candidate paths
              const candidates: string[] = [
                // 1) full relative path
                ...(modelDir ? [`${modelDir}/${rawPath}`] : [rawPath]),
                // 2) same-dir exact filename
                ...(modelDir ? [`${modelDir}/${texFilename}`] : [texFilename]),
              ];
              // 3) OBJ-name with image extensions
              if (objBasename) {
                for (const ext of IMG_EXTS) {
                  candidates.push(modelDir ? `${modelDir}/${objBasename}.${ext}` : `${objBasename}.${ext}`);
                }
              }
              // 4) original texture basename with different extensions
              for (const ext of IMG_EXTS) {
                const alt = `${texBase}.${ext}`;
                if (alt !== texFilename) {
                  candidates.push(modelDir ? `${modelDir}/${alt}` : alt);
                }
              }
              let resolved = false;
              for (const cand of candidates) {
                try {
                  const texBuf = await readFile(cand);
                  const ext = cand.split(".").pop()?.toLowerCase() ?? "png";
                  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
                    : ext === "png" ? "image/png"
                    : ext === "bmp" ? "image/bmp"
                    : ext === "tga" ? "image/x-tga"
                    : ext === "webp" ? "image/webp"
                    : `image/${ext}`;
                  const dataUrl = `data:${mime};base64,${arrayBufferToBase64(texBuf)}`;
                  lines[i] = `${m[1]} ${dataUrl}`;
                  texCount++;
                  resolved = true;
                  console.debug(`[AI3D] Texture resolved: ${cand}`);
                  break;
                } catch { /* try next candidate */ }
              }
              if (!resolved) {
                lines[i] = ""; // strip — prevents red-black checkerboard
                texMissing++;
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
            console.debug(`[AI3D] MTL: ${mtlPath} | textures: ${texCount} loaded, ${texMissing} missing`);
          } catch {
            console.debug(`[AI3D] No MTL in vault: ${mtlPath}`);
          }
        }

        // Override _loadMTL to use vault content or skip (prevents network fetch)
        proto._loadMTL = function(_url: string, _rootUrl: string, onSuccess: (data: string) => void) {
          const content = mtlContent ?? "";
          console.debug(`[AI3D] _loadMTL called: url=${_url}, content_len=${content.length}, has_Kd=${content.includes("Kd")}, has_map=${content.includes("map_")}`);
          onSuccess(content);
        };

        const result = await ImportMeshAsync(dataUrl, scene, { meshNames: "", pluginExtension: fileExt });
        this.loadedMeshes = result.meshes;
        if (result.meshes.length > 0) this.rootMesh = result.meshes[0] as Mesh;
        // Log material state after OBJ load
        for (const m of result.meshes) {
          const mat = m.material;
          console.debug(`[AI3D] OBJ mesh "${m.name}" material:`, mat ? `${mat.name} diffuse=${String((mat as unknown as Record<string, unknown>)?.diffuseColor)}` : "NONE");
        }

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

    this.rootMesh.computeWorldMatrix(true);
    const bbox = this.rootMesh.getHierarchyBoundingVectors();
    const diag = bbox.max.subtract(bbox.min);
    const radius = diag.length() / 2;
    const center = bbox.min.add(diag.scale(0.5));

    this.camera.target = center;
    this.camera.radius = radius * 2.5;
    this.camera.lowerRadiusLimit = radius * 0.05;
    this.camera.upperRadiusLimit = radius * 10;
    this.camera.minZ = radius * 0.001;
    this.camera.maxZ = radius * 20;

    this.initialCamera = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: center.clone(),
    };

    this.startRenderLoop();
    this.engine.resize();

    this.cleanupPicking?.();
    this.cleanupPicking = setupPicking(this.scene, (result) => {
      if (this.disassemblyEnabled) return;
      this._lastPickResult = result;
      if (this.focusSelectionEnabled) {
        this.setFocusedMesh(result.mesh);
      }
      this._onPickCallbacks.forEach(cb => cb(result));
    }, () => !this.focusSelectionEnabled);
    this.disassembly = new DisassemblyController(this.scene, this.camera, this.getRenderableMeshes(this.rootMesh));

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
    const children = this.rootMesh.getChildMeshes(true);
    for (const m of children) {
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
    const bbox = this.rootMesh.getHierarchyBoundingVectors();
    const diag = bbox.max.subtract(bbox.min);
    const size = Math.max(diag.x, diag.z) * 3;
    const y = bbox.min.y;

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
    const bbox = this.rootMesh.getHierarchyBoundingVectors();
    const diag = bbox.max.subtract(bbox.min);
    const size = Math.max(diag.x, diag.z) * 2;
    const y = bbox.min.y - 0.01;

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
    const bbox = this.rootMesh.getHierarchyBoundingVectors();
    const diag = bbox.max.subtract(bbox.min);
    const len = Math.max(diag.x, diag.y, diag.z) * 1.5;
    const origin = bbox.min;

    const axes: [string, Color3, Vector3][] = [
      ["x", Color3.Red(), new Vector3(len, 0, 0)],
      ["y", Color3.Green(), new Vector3(0, len, 0)],
      ["z", Color3.Blue(), new Vector3(0, 0, len)],
    ];

    for (const [name, color, dir] of axes) {
      const tube = MeshBuilder.CreateTube(`axis-${name}`, {
        path: [origin, origin.add(dir)],
        radius: diag.length() * 0.005,
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
    const children = this.rootMesh.getChildMeshes(true);
    for (const m of children) {
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

  toggleBoundingBox(): boolean {
    this.bboxEnabled = !this.bboxEnabled;
    if (this.bboxEnabled) {
      if (!this.rootMesh) return this.bboxEnabled;
      if (this.bboxMesh) this.bboxMesh.dispose();
      this.rootMesh.computeWorldMatrix(true);
      const bb = this.rootMesh.getHierarchyBoundingVectors();
      const center = bb.min.add(bb.max.subtract(bb.min).scale(0.5));
      const size = bb.max.subtract(bb.min);

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
    this.focusSelectionEnabled = !this.focusSelectionEnabled;
    if (!this.focusSelectionEnabled) {
      this.clearFocusedMesh();
    } else if (this._lastPickResult.mesh) {
      this.setFocusedMesh(this._lastPickResult.mesh);
    }
    return this.focusSelectionEnabled;
  }

  toggleDisassembly(): boolean {
    if (!this.rootMesh) return false;
    if (!this.disassembly) {
      this.disassembly = new DisassemblyController(this.scene, this.camera, this.getRenderableMeshes(this.rootMesh));
    }
    if (!this.disassemblyEnabled) {
      this.focusSelectionEnabled = false;
      this.clearFocusedMesh();
    }
    this.disassemblyEnabled = this.disassembly.toggle();
    return this.disassemblyEnabled;
  }

  resetDisassembly(): void {
    this.disassembly?.reset();
  }

  // ── Existing API ─────────────────────────────────────────────────

  setExplode(factor: number, axis: "x" | "y" | "z") {
    if (this.rootMesh) setExplode(this.rootMesh, factor, axis);
  }

  resetExplode() {
    if (this.rootMesh) resetExplode(this.rootMesh);
  }

  resetView(): void {
    if (this.rootMesh) resetExplode(this.rootMesh);
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
    const ext = this.loadedExt.toUpperCase();

    const name = modelPath ? getPortableBasename(modelPath) || summary.rootName : summary.rootName;
    const countLabel = isSplat ? "Splats" : "Triangles";

    const lines: string[] = [];
    lines.push(`## ${name} — Model Info`);
    lines.push("");
    lines.push("| Property | Value |");
    lines.push("|----------|-------|");
    lines.push(`| Format | ${ext} |`);
    lines.push(`| Meshes | ${summary.meshCount} |`);
    lines.push(`| ${countLabel} | ${(summary.splatCount ?? summary.triangleCount).toLocaleString()} |`);
    lines.push(`| Vertices | ${summary.vertexCount.toLocaleString()} |`);
    lines.push(`| Materials | ${summary.materialCount} |`);
    lines.push(`| Bounding Size | ${summary.boundingSize.x.toFixed(3)} x ${summary.boundingSize.y.toFixed(3)} x ${summary.boundingSize.z.toFixed(3)} |`);
    lines.push("");

    // Per-mesh breakdown (skip if > 50 meshes to avoid noise)
    if (renderableMeshes.length > 1 && renderableMeshes.length <= 50) {
      lines.push("### Mesh Breakdown");
      lines.push("");
      lines.push("| # | Name | Triangles | Vertices | Material |");
      lines.push("|---|------|-----------|----------|----------|");
      for (let i = 0; i < renderableMeshes.length; i++) {
        const m = renderableMeshes[i];
        const tris = isSplat ? "—" : Math.floor(m.getTotalIndices() / 3).toLocaleString();
        const verts = m.getTotalVertices().toLocaleString();
        const mat = m.material?.name ?? "—";
        lines.push(`| ${i + 1} | ${escapeTableCell(m.name)} | ${tris} | ${verts} | ${escapeTableCell(mat)} |`);
      }
      lines.push("");
    }

    // Material list
    const matNames = new Set<string>();
    for (const m of renderableMeshes) {
      if (m.material) matNames.add(m.material.name);
    }
    if (matNames.size > 0) {
      lines.push("### Materials");
      lines.push("");
      for (const name of matNames) {
        lines.push(`- ${name}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  getSelectedPartInfo(): ModelPartSummary | null {
    const mesh = this.focusedMesh ?? this._lastPickResult.mesh;
    const renderable = mesh ? this.findRenderableMesh(mesh) : null;
    if (!renderable || renderable.isDisposed()) return null;
    return this.computePartSummary(renderable);
  }

  exportSelectedPartInfo(): string {
    const part = this.getSelectedPartInfo();
    if (!part) return "";

    const lines: string[] = [];
    lines.push(`## ${part.name || "Selected Part"} — Part Info`);
    lines.push("");
    lines.push("| Property | Value |");
    lines.push("|----------|-------|");
    lines.push(`| Mesh | ${escapeTableCell(part.name || "—")} |`);
    lines.push(`| Triangles | ${part.triangleCount.toLocaleString()} |`);
    lines.push(`| Vertices | ${part.vertexCount.toLocaleString()} |`);
    lines.push(`| Material | ${escapeTableCell(part.materialName ?? "—")} |`);
    lines.push(`| Bounding Size | ${part.boundingSize.x.toFixed(3)} x ${part.boundingSize.y.toFixed(3)} x ${part.boundingSize.z.toFixed(3)} |`);
    lines.push(`| Center | ${part.center.x.toFixed(3)}, ${part.center.y.toFixed(3)}, ${part.center.z.toFixed(3)} |`);
    lines.push("");
    return lines.join("\n");
  }

  getRootMesh(): Mesh | null {
    return this.rootMesh;
  }

  getScene(): Scene {
    return this.scene;
  }

  getEngine(): Engine {
    return this.engine;
  }

  getCamera(): ArcRotateCamera {
    return this.camera;
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.engine.getRenderingCanvas();
  }

  getLastPickResult(): PickResult {
    return this._lastPickResult;
  }

  onPick(callback: (result: PickResult) => void): () => void {
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
    this._onPickCallbacks = [];
    this.cleanupPicking?.();
    this.cleanupPicking = null;
    this.gizmo?.dispose();
    this.gizmo = null;
    this.disassembly?.dispose();
    this.disassembly = null;
    this.clearFocusedMesh();
    this.originalMeshVisibility.clear();
    this.bboxMesh?.dispose();
    this.bboxMesh = null;
    this.camera.detachControl();
    const canvas = this.engine.getRenderingCanvas();
    canvas?.removeEventListener("wheel", this.preventCanvasWheelScroll);
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
    if (this.rendering) return;
    this.rendering = true;
    this.engine.runRenderLoop(() => {
      if (!this.canRender()) return;
      this.scene.render();
      if (this.gizmo && this.gizmoEnabled) {
        this.gizmo.syncWith(this.camera);
        this.gizmo.render();
      }
    });
  }

  private getRenderableMeshes(root: Mesh): AbstractMesh[] {
    const candidates = [root, ...this.loadedMeshes, ...root.getChildMeshes(true)];
    const seen = new Set<AbstractMesh>();
    return candidates.filter((mesh) => {
      if (!mesh || seen.has(mesh) || mesh.isDisposed()) return false;
      seen.add(mesh);
      return mesh.getTotalVertices() > 0 || mesh.getTotalIndices() > 0;
    });
  }

  private setFocusedMesh(mesh: AbstractMesh | null): void {
    if (!this.rootMesh) return;
    const target = mesh ? this.findRenderableMesh(mesh) : null;
    if (!target || target.isDisposed()) {
      this.clearFocusedMesh();
      return;
    }

    const renderableMeshes = this.getRenderableMeshes(this.rootMesh);
    for (const candidate of renderableMeshes) {
      if (!this.originalMeshVisibility.has(candidate.uniqueId)) {
        this.originalMeshVisibility.set(candidate.uniqueId, candidate.visibility);
      }
      const selected = candidate === target;
      candidate.visibility = selected ? 1 : 0.22;
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
    mesh.computeWorldMatrix(true);
    const bbox = mesh.getBoundingInfo().boundingBox;
    const size = bbox.maximumWorld.subtract(bbox.minimumWorld);
    const center = bbox.centerWorld;
    return {
      name: mesh.name || `mesh-${mesh.uniqueId}`,
      triangleCount: Math.floor(mesh.getTotalIndices() / 3),
      vertexCount: mesh.getTotalVertices(),
      materialName: mesh.material?.name ?? null,
      boundingSize: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
    };
  }

  private computeSummary(root: Mesh): ModelPreviewSummary {
    const allMeshes = this.getRenderableMeshes(root);
    let triangleCount = 0;
    let vertexCount = 0;
    const materials = new Set<string>();

    const isSplat = isGaussianSplattingMesh(root);

    for (const m of allMeshes) {
      const indices = m.getTotalIndices();
      const verts = m.getTotalVertices();
      triangleCount += Math.floor(indices / 3);
      vertexCount += verts;
      if (m.material) materials.add(m.material.name);
    }

    // SPLAT has no index buffer — report splat count separately
    const splatCount = isSplat ? vertexCount : undefined;

    const bbox = root.getHierarchyBoundingVectors();
    const size = bbox.max.subtract(bbox.min);

    return {
      meshCount: allMeshes.length,
      triangleCount,
      splatCount,
      vertexCount,
      materialCount: materials.size,
      boundingSize: { x: size.x, y: size.y, z: size.z },
      rootName: root.name,
    };
  }
}
