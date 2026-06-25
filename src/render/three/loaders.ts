import type { Object3D, AnimationClip } from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Material, Mesh, MeshStandardMaterial, PointsMaterial, Points } from "three";
import { getPortableBasename, getPortableDirname, getPortableStem, joinPortablePath } from "../../utils/resolve-path";
import { arrayBufferToBase64 } from "../../utils/base64";
import {
  getAdaptivePointSize,
  prepareThreeMaterialForColorAccuracy,
} from "./material-quality";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  bmp: "image/bmp", tga: "image/x-tga", webp: "image/webp",
  tif: "image/tiff", tiff: "image/tiff",
};

const IMG_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];
const MTL_TEXTURE_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/i;

interface GltfExternalResource {
  uri?: string;
}

interface GltfJson {
  buffers?: GltfExternalResource[];
  images?: GltfExternalResource[];
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  return IMAGE_MIME[ext] ?? `image/${ext}`;
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

async function readRelativeResource(
  readFile: (path: string) => Promise<ArrayBuffer>,
  modelDir: string,
  uri: string,
): Promise<{ data: ArrayBuffer; path: string }> {
  const path = joinPortablePath(modelDir, uri);
  try {
    return { data: await readFile(path), path };
  } catch {
    throw new Error(`Missing external model resource: ${path}`);
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
): Promise<{ scene: Object3D; animations: AnimationClip[]; warnings: string[] }> {
  const loader = new GLTFLoader();
  const warnings: string[] = [];

  if (ext === "gltf" && readFile && modelPath) {
    // GLTF JSON may reference external .bin and textures.
    // Use a custom loader manager that resolves from the vault.
    const gltfText = new TextDecoder().decode(new Uint8Array(data));
    const gltfJson = JSON.parse(gltfText) as GltfJson;
    const modelDir = getPortableDirname(modelPath);

    // Pre-load all external buffers and images as data URLs
    if (gltfJson.buffers) {
      for (const buf of gltfJson.buffers) {
        if (buf.uri && !buf.uri.startsWith("data:")) {
          const resource = await readRelativeResource(readFile, modelDir, buf.uri);
          buf.uri = `data:application/octet-stream;base64,${arrayBufferToBase64(resource.data)}`;
        }
      }
    }

    if (gltfJson.images) {
      for (const img of gltfJson.images) {
        if (img.uri && !img.uri.startsWith("data:")) {
          const resource = await readRelativeResource(readFile, modelDir, img.uri);
          img.uri = `data:${guessMime(resource.path)};base64,${arrayBufferToBase64(resource.data)}`;
        }
      }
    }

    const resolvedText = JSON.stringify(gltfJson);
    const resolvedBuffer = new TextEncoder().encode(resolvedText);
    const gltf = await loader.parseAsync(resolvedBuffer.buffer, modelDir ? `${modelDir}/` : "");
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error("GLTF did not contain a scene");
    return { scene: root, animations: gltf.animations, warnings };
  }

  // .glb binary path
  const gltf = await loader.parseAsync(data.slice(0), "");
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
    for (const material of materialList(entry.material)) {
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

    try {
      const mtlData = await readFile(mtlPath);
      let mtlText = new TextDecoder().decode(new Uint8Array(mtlData));

      // Resolve texture references in MTL
      const lines = mtlText.split("\n");
      const texCache = new Map<string, string>();

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(MTL_TEXTURE_RE);
        if (!m) continue;
        const rawPath = firstTexturePath(m[2]);
        const candidates = buildTextureCandidates(modelDir, rawPath, modelPath);

        let resolved = false;
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
          } catch { /* try next candidate */ }
        }
        if (!resolved) {
          warnings.push(`OBJ material texture not found: ${rawPath}`);
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
    } catch {
      warnings.push(`OBJ material library not found: ${mtlPath}`);
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
