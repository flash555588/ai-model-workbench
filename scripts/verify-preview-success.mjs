import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifyScriptPath = join(rootDir, "scripts", "verify-preview.mjs");

const cases = [
  // GLB format tests
  {
    label: "Default simple GLB preview",
    args: [],
  },
  {
    label: "Default direct-edit GLB preview",
    args: ["--mode", "direct-edit"],
  },
  {
    label: "Default readonly-pin GLB preview",
    args: ["--mode", "readonly-pin"],
  },
  {
    label: "Reading-surfaces rollout readonly-pin GLB preview",
    args: ["--mode", "readonly-pin", "--rollout", "three-readonly-glb"],
  },
  {
    label: "Reading-surfaces rollout direct-edit GLB preview",
    args: ["--mode", "direct-edit", "--rollout", "three-readonly-glb"],
  },
  {
    label: "Rollback simple GLB preview",
    args: ["--rollout", "babylon-safe"],
  },
  {
    label: "Rollback direct-edit GLB preview",
    args: ["--mode", "direct-edit", "--rollout", "babylon-safe"],
  },
  {
    label: "Rollback readonly-pin GLB preview",
    args: ["--mode", "readonly-pin", "--rollout", "babylon-safe"],
  },
  {
    label: "Workbench GLB fallback preview",
    args: ["--mode", "workbench"],
  },
  {
    label: "Workbench GLB Three.js capability probe",
    args: ["--mode", "workbench", "--allow-workbench-three", "--rollout", "three-direct-glb"],
  },
  {
    label: "3dgrid multi-block WebGL lifecycle preview",
    args: ["--mode", "grid"],
  },
  {
    label: "Workbench STL remains Babylon with experimental Three enabled",
    args: [
      "--mode",
      "workbench",
      "--allow-workbench-three",
      "--model",
      join(rootDir, "models", "test.stl"),
      "--expect-backend",
      "babylon",
      "--route-only",
    ],
  },
  // STL format test
  {
    label: "STL preview (Three.js)",
    args: ["--model", join(rootDir, "models", "test.stl"), "--rollout", "three-direct-glb"],
  },
  // PLY format test
  {
    label: "PLY preview (Three.js)",
    args: ["--model", join(rootDir, "models", "test.ply"), "--rollout", "three-direct-glb"],
  },
  // OBJ format test
  {
    label: "OBJ preview (Three.js)",
    args: ["--model", join(rootDir, "models", "test.obj"), "--rollout", "three-direct-glb"],
  },
  {
    label: "External GLTF resources with spaces and Chinese paths",
    args: [
      "--model",
      join(rootDir, "models", "resource-fixtures", "gltf-external", "外部 资源.gltf"),
      "--rollout",
      "three-direct-glb",
    ],
  },
  {
    label: "GLTF named groups register as part candidates",
    args: [
      "--model",
      join(rootDir, "models", "resource-fixtures", "grouped-parts", "grouped parts.gltf"),
      "--rollout",
      "three-direct-glb",
      "--expect-group-parts",
    ],
  },
  {
    label: "OBJ/MTL texture resolves with case-insensitive texture path",
    args: [
      "--model",
      join(rootDir, "models", "resource-fixtures", "obj-mtl", "case texture.obj"),
      "--rollout",
      "three-direct-glb",
      "--expect-no-warnings",
    ],
  },
  {
    label: "OBJ/MTL missing texture reports non-blocking warning",
    args: [
      "--model",
      join(rootDir, "models", "resource-fixtures", "obj-missing-texture", "missing texture.obj"),
      "--rollout",
      "three-direct-glb",
      "--expect-warning",
      "OBJ material texture not found",
    ],
  },
  {
    label: "Three color fidelity fixture",
    args: [
      "--model",
      join(rootDir, "models", "quality-fixtures", "three-color-fidelity.glb"),
      "--rollout",
      "three-direct-glb",
      "--expect-color-fidelity",
      "--route-only",
    ],
  },
  {
    label: "Three small-parts precision fixture",
    args: [
      "--model",
      join(rootDir, "models", "quality-fixtures", "three-small-parts.glb"),
      "--rollout",
      "three-direct-glb",
      "--expect-small-parts",
      "--route-only",
    ],
  },
  // GLB alternate path (confirms path resolution works)
  {
    label: "GLB alternate path (Three.js)",
    args: ["--model", join(rootDir, "models", "test-model.glb"), "--rollout", "three-direct-glb"],
  },
];

function runCase(label, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[verify:preview:success] ${label}`);
    const child = spawn(process.execPath, [verifyScriptPath, ...args], {
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`));
    });
  });
}

for (const testCase of cases) {
  await runCase(testCase.label, testCase.args);
}

console.log("\nPreview success verification suite passed");
