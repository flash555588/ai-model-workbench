import esbuild from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, ".tmp", "diagnostics");
const entryPath = join(outDir, "entry.ts");
const bundlePath = join(outDir, "bundle.mjs");
const obsidianShimPath = join(outDir, "obsidian-shim.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(obsidianShimPath, `
  export const apiVersion = "1.12.7";
  export const Platform = { isMobile: false };
`, "utf8");

await writeFile(entryPath, `
  import { buildDiagnosticsReport } from "../../src/diagnostics/report";
  import { DEFAULT_SETTINGS } from "../../src/domain/constants";
  import type { PluginState } from "../../src/domain/models";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const state: PluginState = {
    settings: {
      ...DEFAULT_SETTINGS,
      analysisMode: "hybrid",
      serviceBaseUrl: "https://secret.example.invalid/draft?token=leak",
      sendGeometrySummaryToRemote: true,
      sendPreviewImagesToRemote: true,
      freecadCommand: "/private/freecad",
      obj2gltfCommand: "/private/obj2gltf",
      fbx2gltfCommand: "/private/fbx2gltf",
      assimpCommand: "/private/python",
      freecadcmdCommand: "/private/freecadcmd",
    },
    currentModelPath: "models/example.glb",
    convertedAssetRecords: [],
    modelAssetProfiles: {
      "models/example.glb": {
        tags: ["demo"],
        notes: "",
        annotations: [{ id: "pin-1", position: [0, 0, 0], label: "Pin", color: "#fff", createdAt: "2026-01-01T00:00:00.000Z" }],
        reportNotePath: "Analysis/3D Reports/example Report.md",
        analysisSidecarPath: "Analysis/3D Reports/example Analysis.json",
        knowledgeIndexPath: "Analysis/3D Reports/example Index.md",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    agentDraft: "",
    agentPlan: null,
    modelPreview: {
      meshCount: 2,
      triangleCount: 100,
      vertexCount: 80,
      materialCount: 1,
      boundingSize: { x: 1, y: 2, z: 3 },
      rootName: "example",
    },
    selectedPart: null,
    lastKnowledgeGeneration: {
      modelPath: "models/example.glb",
      reportNotePath: "Analysis/3D Reports/example Report.md",
      analysisSidecarPath: "Analysis/3D Reports/example Analysis.json",
      knowledgeIndexPath: "Analysis/3D Reports/example Index.md",
      partNoteCount: 2,
      previewImageCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "success",
      warningCount: 0,
    },
  };

  const report = buildDiagnosticsReport({
    manifest: {
      id: "ai-model-workbench",
      name: "AI Model Workbench",
      version: "0.4.1",
      minAppVersion: "1.5.0",
      description: "Turn 3D models into linked knowledge assets.",
      author: "flash",
    },
    state,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  assert(report.includes("Plugin version: 0.4.1"), "Plugin version missing");
  assert(report.includes("Obsidian API version: 1.12.7"), "Obsidian API version missing");
  assert(report.includes("Current route: three"), "Route summary missing");
  assert(report.includes("Knowledge index: set (Analysis/3D Reports/example Index.md)"), "Knowledge index status missing");
  assert(report.includes("Last part notes: 2"), "Last generation part count missing");
  assert(report.includes("service configured"), "Remote service configured status missing");
  assert(!report.includes("secret.example.invalid"), "Diagnostics leaked service host");
  assert(!report.includes("token=leak"), "Diagnostics leaked service token");
  assert(!report.includes("/private/"), "Diagnostics leaked command path");

  console.log("Diagnostics verification passed");
`, "utf8");

await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundlePath,
  logLevel: "silent",
  plugins: [
    {
      name: "obsidian-shim",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianShimPath }));
      },
    },
  ],
});

await import(`file://${bundlePath}`);
