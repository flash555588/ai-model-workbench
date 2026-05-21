import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const verifyScriptPath = fileURLToPath(new URL("./verify-preview.mjs", import.meta.url));

const cases = [
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
