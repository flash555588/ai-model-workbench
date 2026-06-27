import { Mesh, MeshStandardMaterial, Points, PointsMaterial } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

let loadThreePLY: typeof import("./loaders").loadThreePLY;
let loadThreeSTL: typeof import("./loaders").loadThreeSTL;
let loadThreeGLTF: typeof import("./loaders").loadThreeGLTF;

beforeAll(async () => {
  vi.stubGlobal("activeWindow", {});
  vi.stubGlobal("ProgressEvent", class ProgressEvent extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;

    constructor(type: string, eventInitDict: ProgressEventInit = {}) {
      super(type, eventInitDict);
      this.lengthComputable = eventInitDict.lengthComputable ?? false;
      this.loaded = eventInitDict.loaded ?? 0;
      this.total = eventInitDict.total ?? 0;
    }
  });
  const loaders = await import("./loaders");
  loadThreeGLTF = loaders.loadThreeGLTF;
  loadThreePLY = loaders.loadThreePLY;
  loadThreeSTL = loaders.loadThreeSTL;
});

function encodeAscii(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function createColoredBinaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("COLOR="), 0);
  bytes[6] = 255;
  bytes[7] = 0;
  bytes[8] = 0;
  bytes[9] = 255;
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  let offset = 84;
  view.setFloat32(offset, 0, true);
  view.setFloat32(offset + 4, 0, true);
  view.setFloat32(offset + 8, 1, true);
  offset += 12;
  for (const point of [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
    view.setFloat32(offset, point[0], true);
    view.setFloat32(offset + 4, point[1], true);
    view.setFloat32(offset + 8, point[2], true);
    offset += 12;
  }
  view.setUint16(offset, 0x8000, true);
  return buffer;
}

function createExternalBufferGltf(): { gltf: ArrayBuffer; bin: ArrayBuffer } {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "external-buffer-triangle" }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        mode: 4,
      }],
    }],
    buffers: [{ uri: "Geometry%20Data.BIN", byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
  };
  return {
    gltf: encodeAscii(JSON.stringify(gltf)),
    bin: positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.byteLength) as ArrayBuffer,
  };
}

function withExternalBuffers(fixture: { gltf: ArrayBuffer; bin: ArrayBuffer }, buffers: Array<{ uri: string; byteLength: number }>): { gltf: ArrayBuffer; bin: ArrayBuffer } {
  const text = new TextDecoder().decode(new Uint8Array(fixture.gltf));
  const gltf = JSON.parse(text);
  gltf.buffers = buffers;
  return {
    gltf: encodeAscii(JSON.stringify(gltf)),
    bin: fixture.bin,
  };
}

describe("Three loaders", () => {
  it("loads GLTF external buffers through Blob URLs without rewriting the JSON", async () => {
    const fixture = createExternalBufferGltf();
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => createObjectURL(blob));
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revokeObjectURL(url));
    const readFile = vi.fn(async (path: string) => {
      if (path === "fixtures/Geometry Data.BIN") {
        return fixture.bin;
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    try {
      const result = await loadThreeGLTF(fixture.gltf, "gltf", readFile, "fixtures/model.gltf");

      expect(readFile).toHaveBeenCalledWith("fixtures/Geometry Data.BIN");
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(result.scene.getObjectByName("external-buffer-triangle")).toBeTruthy();
    } finally {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("deduplicates repeated GLTF external resource reads", async () => {
    const base = createExternalBufferGltf();
    const fixture = withExternalBuffers(base, [
      { uri: "Geometry%20Data.BIN", byteLength: base.bin.byteLength },
      { uri: "./Geometry%20Data.BIN", byteLength: base.bin.byteLength },
    ]);
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => createObjectURL(blob));
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revokeObjectURL(url));
    const readFile = vi.fn(async (path: string) => {
      if (path === "fixtures/Geometry Data.BIN") {
        return fixture.bin;
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    try {
      const result = await loadThreeGLTF(fixture.gltf, "gltf", readFile, "fixtures/model.gltf");

      expect(readFile).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(result.scene.getObjectByName("external-buffer-triangle")).toBeTruthy();
    } finally {
      createSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("limits parallel GLTF external resource reads", async () => {
    const base = createExternalBufferGltf();
    const fixture = withExternalBuffers(base, [
      { uri: "Geometry%20Data.BIN", byteLength: base.bin.byteLength },
      ...Array.from({ length: 8 }, (_, index) => ({
        uri: `extra-${index}.bin`,
        byteLength: base.bin.byteLength,
      })),
    ]);
    let activeReads = 0;
    let maxActiveReads = 0;
    const readFile = vi.fn(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 2));
      activeReads -= 1;
      return fixture.bin;
    });

    const result = await loadThreeGLTF(fixture.gltf, "gltf", readFile, "fixtures/model.gltf");

    expect(readFile).toHaveBeenCalledTimes(9);
    expect(maxActiveReads).toBeLessThanOrEqual(4);
    expect(result.scene.getObjectByName("external-buffer-triangle")).toBeTruthy();
  });

  it("enables vertex colors for colored STL", async () => {
    const object = await loadThreeSTL(createColoredBinaryStl());

    expect(object).toBeInstanceOf(Mesh);
    expect((object as Mesh).geometry.hasAttribute("color")).toBe(true);
    expect(((object as Mesh).material as MeshStandardMaterial).vertexColors).toBe(true);
  });

  it("loads vertex-colored PLY faces as a mesh", async () => {
    const ply = [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "element face 1",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0 255 0 0",
      "1 0 0 0 255 0",
      "0 1 0 0 0 255",
      "3 0 1 2",
    ].join("\n");

    const object = await loadThreePLY(encodeAscii(ply));

    expect(object).toBeInstanceOf(Mesh);
    expect((object as Mesh).geometry.hasAttribute("color")).toBe(true);
    expect(((object as Mesh).material as MeshStandardMaterial).vertexColors).toBe(true);
  });

  it("loads vertex-colored PLY point clouds with adaptive point material", async () => {
    const ply = [
      "ply",
      "format ascii 1.0",
      "element vertex 2",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "0 0 0 255 0 0",
      "0.01 0 0 0 255 0",
    ].join("\n");

    const object = await loadThreePLY(encodeAscii(ply));

    expect(object).toBeInstanceOf(Points);
    expect(((object as Points).material as PointsMaterial).vertexColors).toBe(true);
    expect(((object as Points).material as PointsMaterial).size).toBeLessThan(0.01);
  });
});
