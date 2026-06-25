import { Mesh, MeshStandardMaterial, Points, PointsMaterial } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

let loadThreePLY: typeof import("./loaders").loadThreePLY;
let loadThreeSTL: typeof import("./loaders").loadThreeSTL;

beforeAll(async () => {
  (globalThis as unknown as Record<string, unknown>).activeWindow = {};
  const loaders = await import("./loaders");
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

describe("Three loaders", () => {
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
