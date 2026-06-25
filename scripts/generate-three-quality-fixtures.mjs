import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

globalThis.FileReader = class FileReader {
  result = null;
  onloadend = null;

  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }

  async readAsDataURL(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
    this.onloadend?.();
  }
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = resolve(rootDir, "models", "quality-fixtures");

function addBox(scene, name, size, position, material) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  scene.add(mesh);
}

function createColorScene() {
  const scene = new Scene();
  scene.name = "three_color_fidelity_fixture";
  const materials = {
    red: new MeshStandardMaterial({ name: "color_red_srgb", color: 0xff0000, roughness: 0.72, metalness: 0 }),
    green: new MeshStandardMaterial({ name: "color_green_srgb", color: 0x00ff00, roughness: 0.72, metalness: 0 }),
    blue: new MeshStandardMaterial({ name: "color_blue_srgb", color: 0x0066ff, roughness: 0.72, metalness: 0 }),
    gray: new MeshStandardMaterial({ name: "color_gray_neutral", color: 0x808080, roughness: 0.72, metalness: 0 }),
  };
  addBox(scene, "color_red_panel", [0.7, 0.7, 0.05], [-1.2, 0.45, 0], materials.red);
  addBox(scene, "color_green_panel", [0.7, 0.7, 0.05], [-0.4, -0.45, 0], materials.green);
  addBox(scene, "color_blue_panel", [0.7, 0.7, 0.05], [0.4, 0.45, 0], materials.blue);
  addBox(scene, "color_gray_panel", [0.7, 0.7, 0.05], [1.2, -0.45, 0], materials.gray);
  return scene;
}

function createSmallPartsScene() {
  const scene = new Scene();
  scene.name = "three_small_parts_fixture";
  const body = new MeshStandardMaterial({ name: "mat_body_neutral", color: 0x62748a, roughness: 0.62, metalness: 0.02 });
  const small = new MeshStandardMaterial({ name: "mat_tiny_parts", color: 0xfacc15, roughness: 0.45, metalness: 0.12 });
  addBox(scene, "main_plate", [1.2, 0.08, 0.75], [0, 0, 0], body);
  const positions = [
    [-0.54, 0.075, -0.31],
    [-0.42, 0.075, 0.28],
    [0.48, 0.075, -0.24],
    [0.56, 0.075, 0.32],
    [-0.05, 0.075, 0.0],
    [0.12, 0.075, 0.18],
  ];
  positions.forEach((position, index) => {
    addBox(scene, `tiny_screw_${String(index + 1).padStart(2, "0")}`, [0.018, 0.018, 0.018], position, small);
  });
  addBox(scene, "thin_alignment_pin", [0.012, 0.12, 0.012], [0.33, 0.13, 0.0], small);
  return scene;
}

async function exportGlb(scene, filename) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(scene, { binary: true });
  await writeFile(resolve(outDir, filename), Buffer.from(arrayBuffer));
}

await mkdir(outDir, { recursive: true });
await exportGlb(createColorScene(), "three-color-fidelity.glb");
await exportGlb(createSmallPartsScene(), "three-small-parts.glb");
console.log(`Wrote Three quality fixtures to ${outDir}`);
