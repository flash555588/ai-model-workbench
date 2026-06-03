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

  export class TFile {
    static [Symbol.hasInstance](value) {
      return !!value && typeof value === "object" && value.kind === "file";
    }
  }

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
  import type { AnalysisResult, ModelAssetProfile, ModelEvidence, ModelPreviewSummary } from "../../src/domain/models";
  import { buildLocalAnalysisResult } from "../../src/view/workbench/analysis-result";
  import {
    buildKnowledgeNoteContent,
    buildKnowledgeIndexContent,
    buildKnowledgeIndexManagedSection,
    collectRegisteredPartsFromProfiles,
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

  const files = new Map<string, string>([
    ["Analysis/3D Reports/legacy Analysis.json", JSON.stringify({
      parts: [
        {
          partId: "legacy-model:part:1",
          assetId: "models/legacy grouped parts.gltf",
          name: "Left Assembly",
          source: "group",
          category: "group",
          meshRefs: ["Left Panel A", "Left Panel B"],
          childCount: 2,
          materialRefs: ["fixture blue"],
          bbox: [0.8, 1.45, 0.8],
          center: [-1, 0.3, 0],
          triangleCount: 2400,
          vertexCount: 1400,
          materialName: "fixture blue",
          confidence: 0.72,
          observations: ["Previously registered group part."],
          inferredFunctions: [],
          knowledgeTags: [],
          notePath: "Parts/3D Components/legacy/01 Left Assembly.md",
          reviewed: false,
        },
      ],
    })],
    ["Analysis/3D Reports/current Analysis.json", JSON.stringify({
      parts: [{ partId: "current:part:1", assetId: "models/grouped parts.gltf", name: "Should Skip", meshRefs: [] }],
    })],
  ]);
  const app = {
    vault: {
      getAbstractFileByPath(path: string) {
        return files.has(path) ? { kind: "file", path } : null;
      },
      read(file: { path: string }) {
        return Promise.resolve(files.get(file.path) ?? "");
      },
    },
  };
  const registeredPartsFromSidecars = await collectRegisteredPartsFromProfiles(app as never, {
    "models/legacy grouped parts.gltf": {
      ...profile,
      analysisSidecarPath: "Analysis/3D Reports/legacy Analysis.json",
    },
    "models/grouped parts.gltf": {
      ...profile,
      analysisSidecarPath: "Analysis/3D Reports/current Analysis.json",
    },
  }, "models/grouped parts.gltf");
  assert(registeredPartsFromSidecars.length === 1, "Registered part collection should read other model sidecars only");
  assert(registeredPartsFromSidecars[0].name === "Left Assembly", "Registered part collection did not normalize sidecar part records");

  const registeredPartsFromProfiles = await collectRegisteredPartsFromProfiles(app as never, {
    "models/auto registered parts.gltf": {
      ...profile,
      registeredParts: [
        {
          partId: "auto-model:part:1",
          assetId: "models/auto registered parts.gltf",
          name: "Right Assembly",
          source: "group",
          category: "group",
          meshRefs: ["Right Panel A", "Right Panel B"],
          childCount: 2,
          materialRefs: ["fixture red"],
          bbox: [0.8, 1.45, 0.8],
          center: [1, 0.3, 0],
          triangleCount: 2400,
          vertexCount: 1400,
          materialName: "fixture red",
          confidence: 0.72,
          observations: ["Auto-registered from renderer evidence."],
          inferredFunctions: [],
          knowledgeTags: [],
          reviewed: false,
        },
      ],
    },
    "models/grouped parts.gltf": {
      ...profile,
      registeredParts: [{ partId: "current:part:1", assetId: "models/grouped parts.gltf", name: "Should Skip", meshRefs: [], materialRefs: [], confidence: 0.5, observations: [], inferredFunctions: [], knowledgeTags: [], reviewed: false }],
    },
  }, "models/grouped parts.gltf");
  assert(registeredPartsFromProfiles.length === 1, "Registered part collection should read profile-registered parts without a sidecar");
  assert(registeredPartsFromProfiles[0].name === "Right Assembly", "Profile registered part was not normalized");

  const groupedEvidence: ModelEvidence = {
    summary: preview,
    parts: [
      {
        name: "Left Assembly",
        source: "group",
        meshNames: ["Left Panel A", "Left Panel B"],
        childCount: 2,
        triangleCount: 2400,
        vertexCount: 1400,
        materialName: "fixture blue",
        boundingSize: { x: 0.8, y: 1.45, z: 0.8 },
        center: { x: -1.1, y: 0.325, z: 0 },
      },
      {
        name: "Loose Detail",
        source: "mesh",
        meshNames: ["Loose Detail"],
        childCount: 1,
        triangleCount: 1200,
        vertexCount: 700,
        materialName: "fixture blue",
        boundingSize: { x: 0.8, y: 0.8, z: 0.8 },
        center: { x: 0, y: 0, z: 0 },
      },
    ],
    materialNames: ["fixture blue"],
    resourceWarnings: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
  };

  const groupedAnalysis = buildLocalAnalysisResult({
    modelPath: "models/grouped parts.gltf",
    profile,
    preview,
    evidence: groupedEvidence,
    registeredParts: registeredPartsFromSidecars,
  });
  const groupedPart = groupedAnalysis.parts.find((part) => part.name === "Left Assembly");
  assert(groupedPart?.source === "group", "Grouped evidence part was not marked as source=group");
  assert(groupedPart.category === "group", "Grouped evidence part did not receive group category");
  assert(groupedPart.childCount === 2, "Grouped evidence part child count was not preserved");
  assert(groupedPart.meshRefs.includes("Left Panel A") && groupedPart.meshRefs.includes("Left Panel B"), "Grouped evidence mesh refs were not preserved");
  assert(groupedPart.confidence === 0.72, "Grouped evidence part confidence was not raised");
  assert(groupedPart.registeredMatches?.[0]?.sourceAssetId === "models/legacy grouped parts.gltf", "Grouped part did not match a registered part from another model");
  assert(groupedPart.registeredMatches[0].sourceModelPath === "models/legacy grouped parts.gltf", "Registered part match did not preserve source model path");
  assert(groupedPart.registeredMatches[0].sourceNotePath === "Parts/3D Components/legacy/01 Left Assembly.md", "Registered part note path was not preserved");
  assert(groupedPart.registeredMatches[0].reasons.includes("similar part name"), "Registered part match reasons did not include name similarity");
  const groupedCandidate = groupedAnalysis.draftingInput?.partCandidates.find((part) => part.name === "Left Assembly");
  assert(groupedCandidate?.source === "group", "Grouped drafting input source was not preserved");
  assert(groupedCandidate.childCount === 2, "Grouped drafting input child count was not preserved");
  assert(groupedCandidate.meshRefs?.includes("Left Panel B"), "Grouped drafting input mesh refs were not preserved");
  assert(groupedCandidate.registeredMatches?.[0]?.sourcePartName === "Left Assembly", "Grouped drafting input did not preserve registered matches");
  const groupedReport = buildKnowledgeNoteContent({
    baseName: "grouped parts",
    notePath: "Analysis/3D Reports/grouped parts Report.md",
    sourcePath: "models/grouped parts.gltf",
    analysisSidecarPath: "Analysis/3D Reports/grouped parts Analysis.json",
    analysis: groupedAnalysis,
    preview,
    profile,
  });
  assert(groupedReport.includes("Left Assembly"), "Grouped report did not include group part name");
  assert(groupedReport.includes("group (2)"), "Grouped report did not expose group source and child count");
  assert(groupedReport.includes("Registered from model group with 2 child meshes."), "Grouped report did not include renderer group observation");
  assert(groupedReport.includes("## Registered Part Matches"), "Grouped report did not include registered match section");
  assert(groupedReport.includes("Parts/3D Components/legacy/01 Left Assembly.md"), "Grouped report did not link to registered part note");

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
