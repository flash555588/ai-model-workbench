import type { Object3D, AnimationClip } from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BufferGeometry, LoadingManager, Material, Mesh, MeshStandardMaterial, PointsMaterial, Points } from "three";
import { getPortableBasename, getPortableDirname, getPortableStem, joinPortablePath } from "../../utils/resolve-path";
import { arrayBufferToBase64 } from "../../utils/base64";
import {
  getAdaptivePointSize,
  prepareThreeMaterialForColorAccuracy,
} from "./material-quality";
import { createThreeRemoteUrlError, guardThreeUrl, isThreeRemoteUrl } from "./network-guard";
import { throwIfPreviewLoadInterrupted, type PreviewLoadOptions } from "../preview/load-control";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  bmp: "image/bmp", tga: "image/x-tga", webp: "image/webp",
  tif: "image/tiff", tiff: "image/tiff",
};

const IMG_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];
const MTL_TEXTURE_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/i;
const GLTF_EXTERNAL_RESOURCE_CONCURRENCY = 4;

interface GltfExternalResource {
  uri?: string;
}

interface GltfJson {
  buffers?: GltfExternalResource[];
  images?: GltfExternalResource[];
}

interface GltfExternalResourceTask {
  uri: string;
  mimeType?: string;
  aliases: string[];
}

interface GltfBlobResourceResolver {
  manager: LoadingManager;
  dispose: () => void;
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  return IMAGE_MIME[ext] ?? `image/${ext}`;
}

function stripUriSuffix(uri: string): string {
  return uri.split(/[?#]/, 1)[0] ?? uri;
}

function normalizeResourceLookupKey(uri: string): string {
  return joinPortablePath("", uri);
}

function addResourceLookupKey(
  lookup: Map<string, string>,
  key: string | undefined,
  objectUrl: string,
): void {
  if (!key) return;
  lookup.set(normalizeResourceLookupKey(key), objectUrl);
}

function addGltfResourceLookupKeys(
  lookup: Map<string, string>,
  modelDir: string,
  uri: string,
  resolvedPath: string,
  objectUrl: string,
): void {
  const rawUri = stripUriSuffix(uri);
  addResourceLookupKey(lookup, rawUri, objectUrl);
  addResourceLookupKey(lookup, joinPortablePath("", rawUri), objectUrl);
  addResourceLookupKey(lookup, resolvedPath, objectUrl);
  if (modelDir) {
    addResourceLookupKey(lookup, `${modelDir}/${rawUri}`, objectUrl);
  }
}

function collectGltfExternalResourceTasks(gltfJson: GltfJson): GltfExternalResourceTask[] {
  const tasksByKey = new Map<string, GltfExternalResourceTask>();
  const add = (uri: string | undefined, mimeType?: string): void => {
    if (!uri || uri.startsWith("data:")) {
      return;
    }
    guardThreeUrl(uri, "glTF resource loading");
    const key = normalizeResourceLookupKey(uri);
    if (!key) {
      return;
    }
    const existing = tasksByKey.get(key);
    if (existing) {
      existing.aliases.push(uri);
      existing.mimeType ??= mimeType;
      return;
    }
    tasksByKey.set(key, { uri, mimeType, aliases: [uri] });
  };

  for (const buffer of gltfJson.buffers ?? []) {
    add(buffer.uri, "application/octet-stream");
  }
  for (const image of gltfJson.images ?? []) {
    add(image.uri);
  }

  return [...tasksByKey.values()];
}

async function runLimited<T>(
  tasks: readonly T[],
  concurrency: number,
  worker: (task: T) => Promise<void>,
  options?: PreviewLoadOptions,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      throwIfPreviewLoadInterrupted(options);
      const task = tasks[nextIndex++];
      await worker(task);
      throwIfPreviewLoadInterrupted(options);
    }
  }));
}

async function createGltfBlobResourceResolver(
  readFile: (path: string) => Promise<ArrayBuffer>,
  modelDir: string,
  gltfJson: GltfJson,
  options?: PreviewLoadOptions,
): Promise<GltfBlobResourceResolver> {
  const lookup = new Map<string, string>();
  const objectUrls: string[] = [];
  const manager = new LoadingManager();

  const register = async (task: GltfExternalResourceTask): Promise<void> => {
    throwIfPreviewLoadInterrupted(options);
    const resource = await readRelativeResource(readFile, modelDir, task.uri);
    throwIfPreviewLoadInterrupted(options);
    const objectUrl = URL.createObjectURL(new Blob([resource.data], { type: task.mimeType ?? guessMime(resource.path) }));
    objectUrls.push(objectUrl);
    for (const alias of task.aliases) {
      addGltfResourceLookupKeys(lookup, modelDir, alias, resource.path, objectUrl);
    }
  };

  try {
    await runLimited(
      collectGltfExternalResourceTasks(gltfJson),
      GLTF_EXTERNAL_RESOURCE_CONCURRENCY,
      register,
      options,
    );
  } catch (error) {
    for (const objectUrl of objectUrls) {
      URL.revokeObjectURL(objectUrl);
    }
    throw error;
  }

  manager.setURLModifier((url) => {
    const key = normalizeResourceLookupKey(url);
    const resolved = lookup.get(key) ?? lookup.get(joinPortablePath("", key));
    if (resolved) return resolved;
    // Nothing local matched. Returning `url` here would hand a remote address to
    // the default loader and cause a real network fetch, so refuse it instead.
    if (isThreeRemoteUrl(url)) {
      throw createThreeRemoteUrlError(url, "glTF resource loading");
    }
    return url;
  });

  return {
    manager,
    dispose: () => {
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
    },
  };
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

function formatLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readRelativeResource(
  readFile: (path: string) => Promise<ArrayBuffer>,
  modelDir: string,
  uri: string,
): Promise<{ data: ArrayBuffer; path: string }> {
  const path = joinPortablePath(modelDir, uri);
  try {
    return { data: await readFile(path), path };
  } catch (error) {
    throw new Error(`Missing external model resource: ${path} (${formatLoadError(error)})`);
  }
}

function buildTextureCandidates(modelDir: string, rawPath: string, modelPath: string): string[] {
  const texFilename = getPortableBasename(rawPath);
  const texBase = texFilename.replace(/\.[^.]+$/, "");
  const objBasename = getPortableStem(modelPath);
  const candidates: string[] = [
    joinPortablePath(modelDir, rawPath),
    joinPortablePath(modelDir, texFilename),
  ];
  if (objBasename) {
    for (const ext of IMG_EXTS) {
      candidates.push(joinPortablePath(modelDir, `${objBasename}.${ext}`));
    }
  }
  for (const ext of IMG_EXTS) {
    const alt = `${texBase}.${ext}`;
    if (alt !== texFilename) {
      candidates.push(joinPortablePath(modelDir, alt));
    }
  }
  return candidates;
}

/**
 * Load a GLTF/GLB model. Handles both .glb (binary) and .gltf (JSON).
 * readFile is needed for .gltf to resolve external .bin/.texture references.
 */
export async function loadThreeGLTF(
  data: ArrayBuffer,
  ext: string,
  readFile?: (path: string) => Promise<ArrayBuffer>,
  modelPath?: string,
  options?: PreviewLoadOptions,
): Promise<{ scene: Object3D; animations: AnimationClip[]; warnings: string[] }> {
  const warnings: string[] = [];
  throwIfPreviewLoadInterrupted(options);

  if (ext === "gltf" && readFile && modelPath) {
    // GLTF JSON may reference external .bin and textures. Keep the original JSON
    // intact and resolve vault resources through temporary Blob URLs to avoid
    // base64-expanding large buffers/textures during model load.
    const gltfText = new TextDecoder().decode(new Uint8Array(data));
    const gltfJson = JSON.parse(gltfText) as GltfJson;
    const modelDir = getPortableDirname(modelPath);
    const resolver = await createGltfBlobResourceResolver(readFile, modelDir, gltfJson, options);
    throwIfPreviewLoadInterrupted(options);
    const loader = new GLTFLoader(resolver.manager);
    try {
      throwIfPreviewLoadInterrupted(options);
      const gltf = await loader.parseAsync(data, modelDir ? `${modelDir}/` : "");
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error("GLTF did not contain a scene");
      return { scene: root, animations: gltf.animations, warnings };
    } finally {
      resolver.dispose();
    }
  }

  // .glb binary path
  throwIfPreviewLoadInterrupted(options);
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(data, "");
  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new Error("GLB did not contain a scene");
  return { scene: root, animations: gltf.animations, warnings };
}

/**
 * Load an STL model. Three.js STLLoader handles both binary and ASCII.
 */
export async function loadThreeSTL(data: ArrayBuffer): Promise<Object3D> {
  const loader = new STLLoader();
  const geometry = loader.parse(data);
  const material = geometry.hasAttribute("color")
    ? new MeshStandardMaterial({ color: 0xffffff, vertexColors: true })
    : new MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new Mesh(geometry, material);
  mesh.name = getPortableBasename("") || "stl-model";
  return mesh;
}

/**
 * Load a PLY model. Three.js PLYLoader handles binary/ASCII with vertex colors.
 * Point clouds (no face indices) are rendered as Points.
 */
export async function loadThreePLY(data: ArrayBuffer): Promise<Object3D> {
  const loader = new PLYLoader();
  const geometry = loader.parse(data);
  const hasFaces = !!geometry.index || geometry.hasAttribute("normal");

  if (geometry.hasAttribute("color")) {
    if (hasFaces) {
      if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
      const material = new MeshStandardMaterial({ vertexColors: true });
      return new Mesh(geometry, material);
    }
    const material = new PointsMaterial({ size: getAdaptivePointSize(geometry), vertexColors: true });
    return new Points(geometry, material);
  }

  if (hasFaces) {
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({ color: 0xcccccc });
    return new Mesh(geometry, material);
  }
  const material = new PointsMaterial({ size: getAdaptivePointSize(geometry), color: 0xcccccc });
  return new Points(geometry, material);
}

function materialList(material: Material | Material[] | undefined | null): Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function prepareObjectMaterials(object: Object3D): void {
  object.traverse((entry) => {
    if (!(entry instanceof Mesh)) return;
    const mesh = entry as Mesh<BufferGeometry, Material | Material[]>;
    for (const material of materialList(mesh.material)) {
      prepareThreeMaterialForColorAccuracy(material, 1);
    }
  });
}

/**
 * Load an OBJ model with vault-based MTL resolution.
 * Reads MTL and texture files from the Obsidian vault via readFile.
 */
export async function loadThreeOBJ(
  data: ArrayBuffer,
  readFile?: (path: string) => Promise<ArrayBuffer>,
  modelPath?: string,
): Promise<{ object: Object3D; warnings: string[] }> {
  const objText = new TextDecoder().decode(new Uint8Array(data));
  const warnings: string[] = [];

  // Try to resolve MTL from vault
  let materials: MTLLoader.MaterialCreator | null = null;
  const mtlMatch = objText.match(/mtllib\s+(.+)/);
  if (mtlMatch && readFile && modelPath) {
    const mtlFilename = firstMtlPath(mtlMatch[1]);
    const modelDir = getPortableDirname(modelPath);
    const mtlPath = joinPortablePath(modelDir, mtlFilename);

    let mtlText: string;
    try {
      const mtlData = await readFile(mtlPath);
      mtlText = new TextDecoder().decode(new Uint8Array(mtlData));
    } catch (error) {
      warnings.push(`OBJ material library read failed: ${mtlPath} (${formatLoadError(error)})`);
      mtlText = "";
    }

    if (mtlText) {
      try {
        // Resolve texture references in MTL
        const lines = mtlText.split("\n");
        const texCache = new Map<string, string>();

        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(MTL_TEXTURE_RE);
          if (!m) continue;
          const rawPath = firstTexturePath(m[2]);
          const candidates = buildTextureCandidates(modelDir, rawPath, modelPath);

          let resolved = false;
          let lastError: unknown = null;
          for (const cand of candidates) {
            if (texCache.has(cand)) {
              lines[i] = `${m[1]} ${texCache.get(cand)}`;
              resolved = true;
              break;
            }
            try {
              const texBuf = await readFile(cand);
              const dataUrl = `data:${guessMime(cand)};base64,${arrayBufferToBase64(texBuf)}`;
              texCache.set(cand, dataUrl);
              lines[i] = `${m[1]} ${dataUrl}`;
              resolved = true;
              break;
            } catch (error) {
              lastError = error;
              /* try next candidate */
            }
          }
          if (!resolved) {
            const reason = lastError ? ` (${formatLoadError(lastError)})` : "";
            warnings.push(`OBJ material texture not found: ${rawPath}${reason}`);
            lines[i] = "";
          }
        }

        // Ensure diffuse color exists
        const filtered = lines.filter(l => l !== "");
        const hasKd = filtered.some(l => /^\s*Kd\s+/i.test(l));
        if (!hasKd) {
          const nmIdx = filtered.findIndex(l => /^\s*newmtl\s+/i.test(l));
          filtered.splice(nmIdx >= 0 ? nmIdx + 1 : 0, 0, "Kd 0.80 0.80 0.80");
        }

        const mtlLoader = new MTLLoader();
        const mtlResult = mtlLoader.parse(filtered.join("\n"), modelDir ? `${modelDir}/` : "");
        mtlResult.preload();
        materials = mtlResult;
      } catch (error) {
        warnings.push(`OBJ material library parse failed: ${mtlPath} (${formatLoadError(error)})`);
      }
    }
  } else if (mtlMatch && (!readFile || !modelPath)) {
    warnings.push("OBJ material library could not be resolved without a model path.");
  }

  const objLoader = new OBJLoader();
  if (materials) {
    objLoader.setMaterials(materials);
  }
  const object = objLoader.parse(objText);
  prepareObjectMaterials(object);
  return { object, warnings };
}

/** Check if a format extension is supported by the Three.js path. */
export function isThreeSupportedFormat(ext: string): boolean {
  const normalized = ext.trim().toLowerCase();
  return normalized === "glb" || normalized === "gltf" || normalized === "stl"
    || normalized === "ply" || normalized === "obj";
}
