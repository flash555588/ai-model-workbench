import esbuild from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, ".tmp", "settings-migration");
const entryPath = join(outDir, "entry.ts");
const bundlePath = join(outDir, "bundle.mjs");
const obsidianShimPath = join(outDir, "obsidian-shim.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(obsidianShimPath, [
  "export class Plugin {}",
  "export class TFile {}",
  "export class TFolder {}",
].join("\n"));

await writeFile(entryPath, `
  import { createPluginStore } from "../../src/store/plugin-store";
  import { DEFAULT_SETTINGS } from "../../src/domain/constants";

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const oldData = {
    settings: {
      sourceModelFolder: "Legacy/Models",
      renderQuality: "medium",
      enabledConverterIds: ["obj2gltf"],
    },
    modelAssetProfiles: {
      "models/legacy.glb": {
        tags: ["legacy"],
        reportNotePath: "Analysis/3D Reports/legacy Report.md",
        analysisSidecarPath: "Analysis/3D Reports/legacy Analysis.json",
        knowledgeIndexPath: "Analysis/3D Reports/legacy Index.md",
        annotations: [{ id: "pin-1", position: [0, 0, 0], label: "Legacy", color: "#fff", createdAt: "2026-01-01T00:00:00.000Z" }],
      },
    },
    lastKnowledgeGeneration: {
      modelPath: "models/legacy.glb",
      reportNotePath: "Analysis/3D Reports/legacy Report.md",
      analysisSidecarPath: "Analysis/3D Reports/legacy Analysis.json",
      knowledgeIndexPath: "Analysis/3D Reports/legacy Index.md",
      partNoteCount: 2,
      previewImageCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      status: "success",
      warningCount: 0,
    },
  };

  let saved = oldData;
  const plugin = {
    async loadData() { return saved; },
    async saveData(next) { saved = next; },
  };

  const ps = createPluginStore(plugin);
  await ps.load();
  const state = ps.store.getState();

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  assert(state.settings.sourceModelFolder === "Legacy/Models", "Legacy setting was not preserved");
  assert(state.settings.experimentalThreeWorkbench === DEFAULT_SETTINGS.experimentalThreeWorkbench, "New boolean setting was not defaulted");
  assert(state.settings.analysisMode === DEFAULT_SETTINGS.analysisMode, "Analysis mode was not defaulted");
  assert(state.settings.sendRawModelToRemote === false, "Raw model remote upload should default off");
  assert(state.settings.previewRendererRollout === DEFAULT_SETTINGS.previewRendererRollout, "New rollout setting was not defaulted");
  assert(state.settings.useThreeForConvertedDirectView === DEFAULT_SETTINGS.useThreeForConvertedDirectView, "Converted GLB fast path setting was not defaulted");
  assert(state.settings.snapshotFolder === DEFAULT_SETTINGS.snapshotFolder, "New folder setting was not defaulted");
  assert(state.settings.partFolder === DEFAULT_SETTINGS.partFolder, "Part folder setting was not defaulted");
  assert(state.settings.enabledConverterIds.includes("obj2gltf"), "Legacy converter setting was not preserved");
  assert(state.modelAssetProfiles["models/legacy.glb"].notes === "", "Legacy profile notes were not normalized");
  assert(state.modelAssetProfiles["models/legacy.glb"].annotations.length === 1, "Legacy annotations were not preserved");
  assert(state.modelAssetProfiles["models/legacy.glb"].knowledgeIndexPath === "Analysis/3D Reports/legacy Index.md", "Knowledge index path was not preserved");
  assert(state.lastKnowledgeGeneration?.knowledgeIndexPath === "Analysis/3D Reports/legacy Index.md", "Last generation index path was not preserved");

  await ps.save();
  assert(saved.settings.experimentalThreeWorkbench === DEFAULT_SETTINGS.experimentalThreeWorkbench, "Saved data did not include defaulted setting");
  assert(saved.settings.useThreeForConvertedDirectView === DEFAULT_SETTINGS.useThreeForConvertedDirectView, "Saved data did not include converted GLB fast path setting");
  assert(saved.lastKnowledgeGeneration?.partNoteCount === 2, "Saved data did not preserve last generation summary");
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
console.log("Settings migration verification passed");
