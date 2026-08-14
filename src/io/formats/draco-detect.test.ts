import { describe, expect, it } from "vitest";

import { detectDracoCompression } from "./draco-detect";

function encodeAscii(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function createGlb(json: Record<string, unknown>, bin?: Uint8Array): ArrayBuffer {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4);
  padded.set(jsonBytes);

  const binLength = bin?.length ?? 0;
  const buffer = new ArrayBuffer(12 + 8 + padded.length + 8 + binLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, padded.length).set(padded);
  if (bin) {
    const binStart = 20 + padded.length;
    view.setUint32(binStart, binLength, true);
    view.setUint32(binStart + 4, 0x004e4942, true);
    new Uint8Array(buffer, binStart + 8, binLength).set(bin);
  }
  return buffer;
}

describe("detectDracoCompression", () => {
  it("detects KHR_draco_mesh_compression in a GLB JSON chunk", () => {
    const glb = createGlb({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"] });
    expect(detectDracoCompression(glb)).toBe(true);
  });

  it("returns false for plain GLB files", () => {
    const glb = createGlb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }] });
    expect(detectDracoCompression(glb)).toBe(false);
  });

  it("detects Draco in text .gltf JSON", () => {
    const gltf = encodeAscii(JSON.stringify({
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_draco_mesh_compression"],
    }));
    expect(detectDracoCompression(gltf)).toBe(true);
  });

  it("returns false for non-glTF payloads", () => {
    expect(detectDracoCompression(encodeAscii("not a model"))).toBe(false);
    expect(detectDracoCompression(new ArrayBuffer(4))).toBe(false);
  });
});
