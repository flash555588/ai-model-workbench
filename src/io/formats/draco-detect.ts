/**
 * Detect whether a GLB/GLTF payload uses KHR_draco_mesh_compression.
 *
 * The Babylon.js GLTF loader ships its own Draco decoder, but the Three.js
 * GLTFLoader path does not, so Draco-compressed assets fail there with a
 * cryptic "No DRACOLoader instance provided". Callers use this probe to turn
 * that failure into an actionable message.
 */

const GLTF_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
const DRACO_EXTENSION = "KHR_draco_mesh_compression";

export function detectDracoCompression(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);

  let jsonText: string | null = null;
  if (bytes.length >= 12 && view.getUint32(0, true) === GLTF_MAGIC) {
    // GLB: walk chunks to locate the JSON chunk (spec places it first, but
    // scanning keeps the probe robust to non-conforming writers).
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + chunkLength;
      if (end > bytes.length) break;
      if (chunkType === JSON_CHUNK_TYPE) {
        jsonText = new TextDecoder().decode(bytes.subarray(start, end));
        break;
      }
      offset = end;
    }
  }

  if (jsonText === null) {
    jsonText = new TextDecoder().decode(bytes);
  }
  return hasDracoExtension(jsonText);
}

function hasDracoExtension(jsonText: string): boolean {
  if (!jsonText.includes(DRACO_EXTENSION)) {
    return false;
  }
  // GLB JSON chunks are padded (spaces or null bytes), so a strict JSON.parse
  // can fail on the padding. Match the extensionsUsed array text directly.
  const match = jsonText.match(/"extensionsUsed"\s*:\s*\[([^\]]*)\]/);
  return !!match && match[1].includes(DRACO_EXTENSION);
}
