import esbuild from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, ".tmp", "knowledge-index");
const entryPath = join(outDir, "entry.ts");
const bundlePath = join(outDir, "bundle.mjs");
const obsidianShimPath = join(outDir, "obsidian-shim.ts");
const nodeShimPath = join(outDir, "node-shim.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(obsidianShimPath, `
  export class Notice {
    constructor(message) {
      globalThis.__knowledgeIndexNotices = [...(globalThis.__knowledgeIndexNotices ?? []), String(message)];
    }
  }

  export class TFile {}

  export class TFolder {}

  export async function requestUrl() {
    throw new Error("requestUrl should not be called during knowledge index verification");
  }
`, "utf8");

await writeFile(nodeShimPath, `
  import { readFile as nodeReadFile } from "node:fs/promises";
  import { isAbsolute, join, normalize } from "node:path";

  export const F_OK = 0;
  export const X_OK = 1;
  export const pathDelimiter = ":";
  export function getRuntimeProcess() { return undefined; }
  export function readFile(path) { return nodeReadFile(path); }
  export function pathIsAbsolute(path) { return isAbsolute(path); }
  export function pathJoin(...segments) { return join(...segments); }
  export function pathNormalize(path) { return normalize(path); }
  export function pathDirname(path) { return path.split("/").slice(0, -1).join("/") || "."; }
  export function pathBasename(path) { return path.split("/").pop() ?? path; }
  export function pathExtname(path) {
    const basename = pathBasename(path);
    const index = basename.lastIndexOf(".");
    return index >= 0 ? basename.slice(index) : "";
  }
  export async function access() {}
  export async function writeFile() { throw new Error("writeFile should not be called"); }
  export async function mkdir() { throw new Error("mkdir should not be called"); }
  export async function rm() { throw new Error("rm should not be called"); }
  export function execFile() { throw new Error("execFile should not be called"); }
  export function osTmpdir() { return "/tmp"; }
`, "utf8");

await writeFile(entryPath, `
  import type { AnalysisResult, ModelAssetProfile, ModelPreviewSummary } from "../../src/domain/models";
  import {
    buildKnowledgeIndexContent,
    buildKnowledgeIndexManagedSection,
    replaceManagedSection,
  } from "../../src/view/workbench/knowledge-note";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  function countOccurrences(value: string, pattern: string): number {
    return value.split(pattern).length - 1;
  }

  const preview: ModelPreviewSummary = {
    meshCount: 3,
    triangleCount: 4200,
    vertexCount: 2300,
    materialCount: 2,
    boundingSize: { x: 1.2, y: 1.1, z: 1.0 },
    rootName: "rubiks-cube-3x3",
  };

  const profile: ModelAssetProfile = {
    tags: ["mechanical", "puzzle"],
    notes: "manual profile note",
    annotations: [
      {
        id: "pin-1",
        position: [0.1, 0.2, 0.3],
        label: "Corner cubie",
        color: "#f97316",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const analysis: AnalysisResult = {
    asset: {
      assetId: "models/rubiks-cube-3x3.glb",
      title: "rubiks-cube-3x3",
      sourcePath: "models/rubiks-cube-3x3.glb",
      format: "glb",
      importedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "ready",
    },
    parts: [
      {
        partId: "rubiks-cube-3x3:part:1",
        assetId: "models/rubiks-cube-3x3.glb",
        name: "corner cubie",
        category: "mechanical",
        meshRefs: ["corner_cubie"],
        materialRefs: ["red"],
        bbox: [0.4, 0.4, 0.4],
        center: [0.1, 0.2, 0.3],
        triangleCount: 1200,
        vertexCount: 700,
        materialName: "red",
        confidence: 0.75,
        observations: ["Corner part evidence."],
        inferredFunctions: [],
        knowledgeTags: [],
        notePath: "Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md",
        reviewed: false,
      },
      {
        partId: "rubiks-cube-3x3:part:2",
        assetId: "models/rubiks-cube-3x3.glb",
        name: "center cubie",
        category: "unclassified",
        meshRefs: ["center_cubie"],
        materialRefs: ["blue"],
        bbox: [0.3, 0.3, 0.3],
        center: [0, 0, 0],
        triangleCount: 900,
        vertexCount: 500,
        materialName: "blue",
        confidence: 0.55,
        observations: ["Center part evidence."],
        inferredFunctions: [],
        knowledgeTags: [],
        reviewed: false,
      },
    ],
    knowledgeNodes: [
      {
        id: "models/rubiks-cube-3x3.glb:geometry",
        title: "Geometry overview",
        domain: "geometry",
        summary: "3 meshes, 4,200 triangles.",
        relatedPartIds: ["rubiks-cube-3x3:part:1"],
        relatedAssetIds: ["models/rubiks-cube-3x3.glb"],
        confidence: 0.72,
        source: "rule",
      },
    ],
    previewImages: ["Media/3D Previews/rubiks-cube-3x3_evidence.png"],
    partNotePaths: ["Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md"],
    annotationLinks: [
      {
        annotationId: "pin-1",
        label: "Corner cubie",
        position: [0.1, 0.2, 0.3],
        nearestPartId: "rubiks-cube-3x3:part:1",
        nearestPartName: "corner cubie",
        notePath: "Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md",
        confidence: 0.8,
      },
    ],
    localDraft: {
      title: "rubiks-cube-3x3",
      summary: "Local evidence draft.",
      sections: [],
      suggestedTags: ["rubiks-cube-3x3"],
      nextActions: ["Review generated part drafts."],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    warnings: [],
    pipeline: [],
  };

  const options = {
    baseName: "rubiks-cube-3x3",
    notePath: "Analysis/3D Reports/rubiks-cube-3x3 Report.md",
    sourcePath: "models/rubiks-cube-3x3.glb",
    analysisSidecarPath: "Analysis/3D Reports/rubiks-cube-3x3 Analysis.json",
    analysis,
    preview,
    profile,
  };

  const initial = buildKnowledgeIndexContent(options);
  assert(initial.includes("# rubiks-cube-3x3 Knowledge Index"), "Initial index title missing");
  assert(initial.includes("## User Notes"), "User notes section missing");
  assert(initial.includes("<!-- AI3D_INDEX_START -->"), "Managed section start marker missing");
  assert(initial.includes("<!-- AI3D_INDEX_END -->"), "Managed section end marker missing");
  assert(initial.includes("[[Analysis/3D Reports/rubiks-cube-3x3 Report.md|rubiks-cube-3x3 Report]]"), "Report link missing");
  assert(initial.includes("[[Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md|corner cubie]]"), "Part note link missing");
  assert(initial.includes("![[Media/3D Previews/rubiks-cube-3x3_evidence.png]]"), "Evidence image embed missing");
  assert(initial.includes("Corner cubie -> [[Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md|part note]]"), "Annotation to part-note link missing");

  const edited = initial.replace("## User Notes\\n\\n- ", "## User Notes\\n\\n- Preserve this human note\\n- ");
  const updatedAnalysis: AnalysisResult = {
    ...analysis,
    parts: analysis.parts.map((part) => part.partId === "rubiks-cube-3x3:part:1"
      ? { ...part, notePath: undefined }
      : { ...part, notePath: "Parts/3D Components/rubiks-cube-3x3/02 center cubie.md" }),
    previewImages: ["Media/3D Previews/new_evidence.png"],
    partNotePaths: ["Parts/3D Components/rubiks-cube-3x3/02 center cubie.md"],
    annotationLinks: analysis.annotationLinks?.map((link) => ({
      ...link,
      notePath: undefined,
      nearestPartId: "rubiks-cube-3x3:part:2",
      nearestPartName: "center cubie",
    })),
  };

  const refreshed = replaceManagedSection(
    edited,
    buildKnowledgeIndexManagedSection({ ...options, analysis: updatedAnalysis }),
  );
  assert(refreshed.includes("- Preserve this human note"), "User notes were not preserved");
  assert(refreshed.includes("![[Media/3D Previews/new_evidence.png]]"), "Managed evidence image was not refreshed");
  assert(!refreshed.includes("![[Media/3D Previews/rubiks-cube-3x3_evidence.png]]"), "Old managed evidence image remained after refresh");
  assert(refreshed.includes("[[Parts/3D Components/rubiks-cube-3x3/02 center cubie.md|center cubie]]"), "Updated part note link missing");
  assert(!refreshed.includes("[[Parts/3D Components/rubiks-cube-3x3/01 corner cubie.md|corner cubie]]"), "Old part note link remained after refresh");
  assert(countOccurrences(refreshed, "<!-- AI3D_INDEX_START -->") === 1, "Managed start marker should appear once");
  assert(countOccurrences(refreshed, "<!-- AI3D_INDEX_END -->") === 1, "Managed end marker should appear once");

  const legacy = "# Legacy index\\n\\nManual notes only.\\n";
  const appended = replaceManagedSection(legacy, buildKnowledgeIndexManagedSection(options));
  assert(appended.startsWith("# Legacy index\\n\\nManual notes only."), "Legacy note body was not preserved");
  assert(appended.includes("<!-- AI3D_INDEX_START -->"), "Managed section was not appended to legacy index");

  console.log("Knowledge index verification passed");
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
        build.onResolve({ filter: /node-shim$/ }, () => ({ path: nodeShimPath }));
      },
    },
  ],
});

await import(`file://${bundlePath}`);
