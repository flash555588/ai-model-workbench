import type { Object3D, Scene, AnimationClip } from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Mesh, MeshStandardMaterial, BufferGeometry, PointsMaterial, Points } from "three";
import { getPortableBasename, getPortableDirname, getPortableStem } from "../../utils/resolve-path";
import { arrayBufferToBase64 } from "../../utils/base64";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  bmp: "image/bmp", tga: "image/x-tga", webp: "image/webp",
  tif: "image/tiff", tiff: "image/tiff",
};

const IMG_EXTS = ["jpg", "jpeg", "png", "bmp", "tga", "webp", "tif", "tiff"];

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  return IMAGE_MIME[ext] ?? `image/${ext}`;
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
): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  const loader = new GLTFLoader();

  if (ext === "gltf" && readFile && modelPath) {
    // GLTF JSON may reference external .bin and textures.
    // Use a custom loader manager that resolves from the vault.
    const gltfText = new TextDecoder().decode(new Uint8Array(data));
    const gltfJson = JSON.parse(gltfText);
    const modelDir = getPortableDirname(modelPath);

    // Pre-load all external buffers and images as data URLs
    if (gltfJson.buffers) {
      for (const buf of gltfJson.buffers) {
        if (buf.uri && !buf.uri.startsWith("data:")) {
          const bufPath = modelDir ? `${modelDir}/${buf.uri}` : buf.uri;
          try {
            const bufData = await readFile(bufPath);
            buf.uri = `data:application/octet-stream;base64,${arrayBufferToBase64(bufData)}`;
          } catch { /* buffer not found, loader will report error */ }
        }
      }
    }

    if (gltfJson.images) {
      for (const img of gltfJson.images) {
        if (img.uri && !img.uri.startsWith("data:")) {
          const imgPath = modelDir ? `${modelDir}/${img.uri}` : img.uri;
          try {
            const imgData = await readFile(imgPath);
            img.uri = `data:${guessMime(imgPath)};base64,${arrayBufferToBase64(imgData)}`;
          } catch { /* image not found */ }
        }
      }
    }

    const resolvedText = JSON.stringify(gltfJson);
    const resolvedBuffer = new TextEncoder().encode(resolvedText);
    const gltf = await loader.parseAsync(resolvedBuffer.buffer, modelDir ? `${modelDir}/` : "");
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error("GLTF did not contain a scene");
    return { scene: root, animations: gltf.animations };
  }

  // .glb binary path
  const gltf = await loader.parseAsync(data.slice(0), "");
  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new Error("GLB did not contain a scene");
  return { scene: root, animations: gltf.animations };
}

/**
 * Load an STL model. Three.js STLLoader handles both binary and ASCII.
 */
export async function loadThreeSTL(data: ArrayBuffer): Promise<Object3D> {
  const loader = new STLLoader();
  const geometry = loader.parse(data);
  const material = new MeshStandardMaterial({ color: 0xcccccc });
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

  if (geometry.hasAttribute("color")) {
    // Vertex-colored mesh or point cloud
    if (geometry.index) {
      const material = new MeshStandardMaterial({ vertexColors: true });
      return new Mesh(geometry, material);
    }
    // Point cloud (no faces)
    const material = new PointsMaterial({ size: 0.02, vertexColors: true });
    return new Points(geometry, material);
  }

  // No vertex color
  if (geometry.index) {
    const material = new MeshStandardMaterial({ color: 0xcccccc });
    return new Mesh(geometry, material);
  }
  const material = new PointsMaterial({ size: 0.02, color: 0xcccccc });
  return new Points(geometry, material);
}

/**
 * Load an OBJ model with vault-based MTL resolution.
 * Reads MTL and texture files from the Obsidian vault via readFile.
 */
export async function loadThreeOBJ(
  data: ArrayBuffer,
  readFile?: (path: string) => Promise<ArrayBuffer>,
  modelPath?: string,
): Promise<Object3D> {
  const objText = new TextDecoder().decode(new Uint8Array(data));

  // Try to resolve MTL from vault
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let materials: any = null;
  const mtlMatch = objText.match(/mtllib\s+(.+)/);
  if (mtlMatch && readFile && modelPath) {
    const mtlFilename = mtlMatch[1].trim().split(/\s+/)[0];
    const modelDir = getPortableDirname(modelPath);
    const mtlPath = modelDir ? `${modelDir}/${mtlFilename}` : mtlFilename;

    try {
      const mtlData = await readFile(mtlPath);
      let mtlText = new TextDecoder().decode(new Uint8Array(mtlData));

      // Resolve texture references in MTL
      const TEX_RE = /^\s*(map_Kd|map_Ka|map_Ks|map_Ns|map_d|map_bump|bump|disp|decal)\s+(.+)/im;
      const lines = mtlText.split("\n");
      const objBasename = getPortableStem(modelPath);
      let texCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(TEX_RE);
        if (!m) continue;
        const rawPath = m[2].trim();
        const texFilename = getPortableBasename(rawPath);
        const texBase = texFilename.replace(/\.[^.]+$/, "");

        const candidates: string[] = [
          ...(modelDir ? [`${modelDir}/${rawPath}`, `${modelDir}/${texFilename}`] : [rawPath, texFilename]),
        ];
        if (objBasename) {
          for (const ext of IMG_EXTS) {
            candidates.push(modelDir ? `${modelDir}/${objBasename}.${ext}` : `${objBasename}.${ext}`);
          }
        }
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
            const dataUrl = `data:${guessMime(cand)};base64,${arrayBufferToBase64(texBuf)}`;
            lines[i] = `${m[1]} ${dataUrl}`;
            texCount++;
            resolved = true;
            break;
          } catch { /* try next candidate */ }
        }
        if (!resolved) {
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
      materials = mtlResult.materials;
    } catch {
      // No MTL found — OBJ will use default material
    }
  }

  const objLoader = new OBJLoader();
  if (materials) {
    objLoader.setMaterials(materials as Parameters<OBJLoader["setMaterials"]>[0]);
  }
  return objLoader.parse(objText);
}

/** Check if a format extension is supported by the Three.js path. */
export function isThreeSupportedFormat(ext: string): boolean {
  const normalized = ext.trim().toLowerCase();
  return normalized === "glb" || normalized === "gltf" || normalized === "stl"
    || normalized === "ply" || normalized === "obj";
}
