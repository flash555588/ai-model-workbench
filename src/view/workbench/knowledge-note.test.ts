import type { App } from "obsidian";
import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/constants";
import type { AnalysisResult, KnowledgeGenerationRecord, ModelAssetProfile, ModelEvidence, PartRecord, PluginState } from "../../domain/models";
import type { PluginStore } from "../../store/plugin-store";
import { createDefaultProfile } from "../../store/plugin-store";
import { buildKnowledgeNoteContent, collectRegisteredPartsFromProfiles, generateKnowledgeNote, stripTransientRegisteredPartData } from "./knowledge-note";
import { getKnowledgeGenerationProgress, subscribeKnowledgeGenerationProgress } from "./knowledge-generation-progress";

const noticeMessages = vi.hoisted((): string[] => []);

vi.mock("obsidian", () => {
  class MockTFile {
    path: string;

    constructor(path: string) {
      this.path = path;
    }
  }

  class MockNotice {
    constructor(message: string) {
      noticeMessages.push(String(message));
    }
  }

  return {
    Notice: MockNotice,
    TFile: MockTFile,
    TFolder: class MockTFolder {},
  };
});

vi.mock("../../utils/node-shim", () => ({
  pathIsAbsolute: () => false,
  pathJoin: (...segments: string[]) => segments.join("/"),
  pathNormalize: (path: string) => path.replace(/\\/g, "/"),
  readFile: vi.fn(),
}));

type TestFile = { path: string };

interface VaultHarnessOptions {
  failCreatePath?: string;
}

function createTFile(path: string): TestFile {
  const FileCtor = TFile as unknown as new (path: string) => TestFile;
  return new FileCtor(path);
}

function createVaultHarness(options: VaultHarnessOptions = {}) {
  const files = new Map<string, string>();
  const binaries = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const operations: string[] = [];

  const vault = {
    getAbstractFileByPath(path: string) {
      if (files.has(path)) {
        return createTFile(path);
      }
      if (folders.has(path)) {
        return { path, kind: "folder" };
      }
      return null;
    },
    async createFolder(path: string) {
      operations.push(`folder:${path}`);
      folders.add(path);
    },
    async create(path: string, content: string) {
      operations.push(`create:${path}`);
      if (path === options.failCreatePath) {
        throw new Error(`create failed: ${path}`);
      }
      files.set(path, content);
      return createTFile(path);
    },
    async modify(file: TestFile, content: string) {
      operations.push(`modify:${file.path}`);
      files.set(file.path, content);
    },
    async read(file: TestFile) {
      return files.get(file.path) ?? "";
    },
    async createBinary(path: string, content: ArrayBuffer) {
      operations.push(`binary:${path}:${content.byteLength}`);
      binaries.set(path, content);
    },
  };

  const openFile = vi.fn(async (): Promise<void> => undefined);
  const app = {
    vault,
    workspace: {
      getLeaf: vi.fn(() => ({ openFile })),
    },
  } as unknown as App;

  return { app, files, binaries, operations, openFile };
}

function createState(overrides: Partial<PluginState> = {}): PluginState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    currentModelPath: "models/gear.glb",
    convertedAssetRecords: [],
    modelAssetProfiles: {},
    agentDraft: "",
    agentPlan: null,
    modelPreview: {
      meshCount: 1,
      triangleCount: 120,
      vertexCount: 80,
      materialCount: 1,
      boundingSize: { x: 1, y: 1, z: 1 },
      rootName: "gear",
    },
    selectedPart: null,
    lastKnowledgeGeneration: null,
    ...overrides,
  };
}

function createPluginStoreHarness(initialState: PluginState, operations: string[] = []) {
  let state = initialState;
  const generationRecords: KnowledgeGenerationRecord[] = [];
  const updateModelProfile = vi.fn((path: string, updater: (existing: ModelAssetProfile) => Partial<ModelAssetProfile>) => {
    const existing = state.modelAssetProfiles[path] ?? createDefaultProfile();
    state = {
      ...state,
      modelAssetProfiles: {
        ...state.modelAssetProfiles,
        [path]: {
          ...existing,
          ...updater(existing),
          updatedAt: new Date().toISOString(),
        },
      },
    };
  });
  const setLastKnowledgeGeneration = vi.fn((record: KnowledgeGenerationRecord | null) => {
    if (record) {
      generationRecords.push(record);
      operations.push(`generation:${record.status}`);
    }
    state = { ...state, lastKnowledgeGeneration: record };
  });

  const ps = {
    store: {
      getState: () => state,
      setState: (partial: Partial<PluginState>) => {
        state = { ...state, ...partial };
      },
      subscribe: () => () => undefined,
    },
    updateModelProfile,
    setLastKnowledgeGeneration,
  } as unknown as PluginStore;

  return { ps, generationRecords, updateModelProfile };
}

describe("generateKnowledgeNote generation marker", () => {
  it("binds a file-view action to its model instead of the globally current leaf", async () => {
    const { app, files } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState({ currentModelPath: "models/other.glb", modelPreview: null }));
    await generateKnowledgeNote(app, ps, { modelPath: "models/gear.glb", modelPreview: createState().modelPreview });
    const record = generationRecords.at(-1)!;
    expect(record).toMatchObject({ modelPath: "models/gear.glb", status: "success" });
    const analysis = JSON.parse(files.get(record.analysisSidecarPath!)!) as AnalysisResult;
    expect(analysis.asset.sourcePath).toBe("models/gear.glb");
    expect(files.get(record.reportNotePath!)).toContain("120");
    expect(ps.store.getState().currentModelPath).toBe("models/other.glb");
  });

  it("reports local write stages and clears live progress before opening a saved report", async () => {
    const { app, openFile } = createVaultHarness();
    const { ps } = createPluginStoreHarness(createState());
    const phases: Array<string | null> = [];
    const unsubscribe = subscribeKnowledgeGenerationProgress(ps, () => phases.push(getKnowledgeGenerationProgress(ps)?.phase ?? null));
    openFile.mockImplementation(async () => {
      expect(getKnowledgeGenerationProgress(ps)).toBeNull();
      expect(ps.store.getState().lastKnowledgeGeneration?.status).toBe("success");
    });
    try {
      await generateKnowledgeNote(app, ps);
      expect(phases).toEqual(["capture", "paths", "analysis", "parts", "write", "index", null]);
    } finally { unsubscribe(); }
  });

  it("clears live progress after a failed write so generation can be retried", async () => {
    const { app } = createVaultHarness({ failCreatePath: "Analysis/3D Reports/gear Analysis.json" });
    const { ps } = createPluginStoreHarness(createState());
    await expect(generateKnowledgeNote(app, ps)).rejects.toThrow("Unable to write analysis sidecar");
    expect(getKnowledgeGenerationProgress(ps)).toBeNull();
    const next = createVaultHarness();
    await generateKnowledgeNote(next.app, ps);
    expect(ps.store.getState().lastKnowledgeGeneration?.status).toBe("success");
  });

  function partEvidence(componentId = "gear-a"): ModelEvidence {
    return {
      summary: createState().modelPreview!,
      parts: [{ name: "Gear", source: "component", componentId, meshNames: [componentId],
        triangleCount: 120, vertexCount: 80, materialName: "Steel", boundingSize: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 } }],
      materialNames: [], resourceWarnings: [], capturedAt: "2026-10-01T00:00:00.000Z",
    };
  }

  it("captures the starting model evidence and screenshot before asynchronous ownership reads", async () => {
    const { app, files, binaries } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    let evidence = partEvidence("original-component");
    let image = "data:image/png;base64,AQ==";
    const options = { preview: { captureSnapshot: () => image, getModelEvidence: () => evidence } };
    await generateKnowledgeNote(app, ps, options);
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const read = app.vault.read.bind(app.vault);
    const readSpy = vi.spyOn(app.vault, "read").mockImplementation(async (file) => {
      await gate;
      return read(file);
    });
    const generating = generateKnowledgeNote(app, ps, options);
    try {
      await vi.waitFor(() => expect(readSpy).toHaveBeenCalled());
      ps.store.setState({ currentModelPath: "models/other.glb", modelPreview: { ...evidence.summary, rootName: "other" } });
      evidence = partEvidence("other-component");
      image = "data:image/png;base64,Ag==";
      releaseRead();
      await generating;
      const result = generationRecords.at(-1)!;
      const analysis = JSON.parse(files.get(result.analysisSidecarPath!)!) as AnalysisResult;
      expect(analysis.asset.sourcePath).toBe("models/gear.glb");
      expect(analysis.parts[0].componentId).toBe("original-component");
      expect(new Uint8Array(binaries.get(analysis.previewImages[0])!)[0]).toBe(1);
    } finally {
      releaseRead();
      await generating.catch(() => undefined);
      readSpy.mockRestore();
    }
  });

  it("records ownership read failures and releases the generation lock for a retry", async () => {
    const { app, files } = createVaultHarness();
    files.set("Analysis/3D Reports/gear Report.md", "Existing user note");
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    const readSpy = vi.spyOn(app.vault, "read").mockRejectedValue(new Error("vault read failed"));
    await expect(generateKnowledgeNote(app, ps)).rejects.toThrow("vault read failed");
    expect(generationRecords.map((record) => record.status)).toEqual(["pending", "failed"]);
    expect(generationRecords.at(-1)!.modelPath).toBe("models/gear.glb");
    expect(files.get("Analysis/3D Reports/gear Report.md")).toBe("Existing user note");
    readSpy.mockRestore();
    await generateKnowledgeNote(app, ps);
    expect(generationRecords.at(-1)!.status).toBe("success");
  });

  it("continues generation with a warning when screenshot capture throws", async () => {
    const { app, files } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    await generateKnowledgeNote(app, ps, { preview: {
      captureSnapshot: () => { throw new Error("canvas unavailable"); },
      getModelEvidence: () => partEvidence(),
    } });
    const result = generationRecords.at(-1)!;
    const analysis = JSON.parse(files.get(result.analysisSidecarPath!)!) as AnalysisResult;
    expect(result.status).toBe("success");
    expect(result.warningCount).toBe(1);
    expect(analysis.previewImages).toEqual([]);
    expect(analysis.warnings).toContain("Evidence snapshot failed: canvas unavailable");
    expect(analysis.parts[0].componentId).toBe("gear-a");
  });

  it("keeps generation successful when opening a saved report fails", async () => {
    const { app, files, openFile } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    openFile.mockRejectedValueOnce(new Error("workspace unavailable"));
    await expect(generateKnowledgeNote(app, ps)).resolves.toBeUndefined();
    expect(generationRecords.map((record) => record.status)).toEqual(["pending", "success"]);
    expect(files.has(generationRecords.at(-1)!.reportNotePath!)).toBe(true);
    expect(noticeMessages.some((message) => message.includes("saved") && message.includes("workspace unavailable"))).toBe(true);
  });

  it("does not overwrite a later success when an earlier report open rejects late", async () => {
    const { app, openFile } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    let rejectOpen!: (error: Error) => void;
    openFile.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOpen = reject; }));
    const earlier = generateKnowledgeNote(app, ps);
    const observed = earlier.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(openFile).toHaveBeenCalledTimes(1));
      ps.store.setState({ currentModelPath: "models/later.glb" });
      await generateKnowledgeNote(app, ps);
      expect(generationRecords.at(-1)!.modelPath).toBe("models/later.glb");
      rejectOpen(new Error("earlier report open failed"));
      await observed;
      expect(ps.store.getState().lastKnowledgeGeneration).toMatchObject({ status: "success", modelPath: "models/later.glb" });
    } finally {
      rejectOpen?.(new Error("test cleanup"));
      await observed;
    }
  });

  it("isolates same-named models and preserves index and part edits on regeneration", async () => {
    const { app, files } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    const options = { preview: { captureSnapshot: () => null, getModelEvidence: () => partEvidence() } };
    await generateKnowledgeNote(app, ps, options);
    const first = generationRecords.at(-1)!;
    const firstAnalysis = JSON.parse(files.get(first.analysisSidecarPath!)!) as AnalysisResult;
    const firstPartPath = firstAnalysis.parts[0].notePath!;
    files.set(first.knowledgeIndexPath!, files.get(first.knowledgeIndexPath!)! + "\nMy index notes\n");
    files.set(firstPartPath, files.get(firstPartPath)! + "\nMy part notes\n");
    const originalFiles = new Map(files);
    ps.store.setState({ currentModelPath: "other/gear.glb" });
    await generateKnowledgeNote(app, ps, options);
    const second = generationRecords.at(-1)!;
    expect(second.reportNotePath).not.toBe(first.reportNotePath);
    expect(second.analysisSidecarPath).not.toBe(first.analysisSidecarPath);
    expect(second.knowledgeIndexPath).not.toBe(first.knowledgeIndexPath);
    const secondAnalysis = JSON.parse(files.get(second.analysisSidecarPath!)!) as AnalysisResult;
    expect(secondAnalysis.parts[0].notePath).not.toBe(firstPartPath);
    for (const [path, content] of originalFiles) expect(files.get(path)).toBe(content);
    await generateKnowledgeNote(app, ps, options);
    expect(generationRecords.at(-1)!.reportNotePath).toBe(second.reportNotePath);
    ps.store.setState({ currentModelPath: "models/gear.glb" });
    await generateKnowledgeNote(app, ps, options);
    expect(generationRecords.at(-1)!.reportNotePath).toBe(first.reportNotePath);
    expect(files.get(first.knowledgeIndexPath!)).toContain("My index notes");
    expect(files.get(firstPartPath)).toContain("My part notes");
  });

  it.each([" Report.md", " Analysis.json", " Index.md"])("preserves an unrelated user artifact at the default path: %s", async (suffix) => {
    const { app, files } = createVaultHarness();
    const existingPath = "Analysis/3D Reports/gear" + suffix;
    const original = suffix.endsWith(".json") ? JSON.stringify({ asset: { sourcePath: "models/gear.glb" } }) : "My unrelated notes";
    files.set(existingPath, original);
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    await generateKnowledgeNote(app, ps);
    expect(files.get(existingPath)).toBe(original);
    expect(generationRecords.at(-1)!.reportNotePath).toMatch(/gear-[a-f0-9]{8} Report\.md$/);
  });

  it("preserves an unrelated part note and avoids reusing it for a different component", async () => {
    const { app, files } = createVaultHarness();
    const originalPath = "Parts/3D Components/gear/01 Gear.md";
    files.set(originalPath, "Manual part notes");
    const { ps, generationRecords } = createPluginStoreHarness(createState());
    let component = "gear-a";
    const options = { preview: { captureSnapshot: () => null, getModelEvidence: () => partEvidence(component) } };
    await generateKnowledgeNote(app, ps, options);
    const first = JSON.parse(files.get(generationRecords.at(-1)!.analysisSidecarPath!)!) as AnalysisResult;
    const firstPath = first.parts[0].notePath!;
    expect(firstPath).not.toBe(originalPath);
    const edited = files.get(firstPath)! + "\nUser component notes\n";
    files.set(firstPath, edited);
    component = "gear-b";
    await generateKnowledgeNote(app, ps, options);
    const second = JSON.parse(files.get(generationRecords.at(-1)!.analysisSidecarPath!)!) as AnalysisResult;
    expect(second.parts[0].notePath).not.toBe(firstPath);
    expect(files.get(firstPath)).toBe(edited);
    expect(files.get(originalPath)).toBe("Manual part notes");
  });

  it("writes root report paths without leading separators", async () => {
    const { app, files } = createVaultHarness();
    const { ps } = createPluginStoreHarness(createState({ settings: { ...DEFAULT_SETTINGS, reportFolder: "" } }));
    await generateKnowledgeNote(app, ps);
    expect(files.has("gear Report.md")).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith("/"))).toBe(false);
  });

  beforeEach(() => {
    noticeMessages.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records pending before vault writes and success after required artifacts finish", async () => {
    const { app, files, operations, openFile } = createVaultHarness();
    const { ps, generationRecords, updateModelProfile } = createPluginStoreHarness(createState(), operations);

    await generateKnowledgeNote(app, ps);

    expect(generationRecords.map((record) => record.status)).toEqual(["pending", "success"]);
    expect(operations[0]).toBe("generation:pending");
    expect(files.has("Analysis/3D Reports/gear Index.md")).toBe(true);
    expect(files.has("Analysis/3D Reports/gear Analysis.json")).toBe(true);
    expect(files.has("Analysis/3D Reports/gear Report.md")).toBe(true);
    expect(operations.indexOf("create:Analysis/3D Reports/gear Index.md")).toBeGreaterThan(
      operations.indexOf("create:Analysis/3D Reports/gear Report.md"),
    );
    expect(generationRecords[1]).toMatchObject({
      modelPath: "models/gear.glb",
      reportNotePath: "Analysis/3D Reports/gear Report.md",
      analysisSidecarPath: "Analysis/3D Reports/gear Analysis.json",
      knowledgeIndexPath: "Analysis/3D Reports/gear Index.md",
      status: "success",
    });
    expect(updateModelProfile).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("records failed when a required artifact write fails after partial output", async () => {
    const { app, files, openFile } = createVaultHarness({
      failCreatePath: "Analysis/3D Reports/gear Analysis.json",
    });
    const { ps, generationRecords, updateModelProfile } = createPluginStoreHarness(createState());

    await expect(generateKnowledgeNote(app, ps)).rejects.toThrow("Unable to write analysis sidecar");

    expect(generationRecords.map((record) => record.status)).toEqual(["pending", "failed"]);
    expect(files.has("Analysis/3D Reports/gear Index.md")).toBe(false);
    expect(files.has("Analysis/3D Reports/gear Report.md")).toBe(false);
    expect(generationRecords[1]).toMatchObject({
      modelPath: "models/gear.glb",
      reportNotePath: "Analysis/3D Reports/gear Report.md",
      analysisSidecarPath: "Analysis/3D Reports/gear Analysis.json",
      knowledgeIndexPath: "Analysis/3D Reports/gear Index.md",
      status: "failed",
      warningCount: 1,
    });
    expect(updateModelProfile).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("surfaces a warning when replacing a stale pending generation", async () => {
    const previousPending: KnowledgeGenerationRecord = {
      modelPath: "models/old.glb",
      reportNotePath: "Analysis/3D Reports/old Report.md",
      analysisSidecarPath: "Analysis/3D Reports/old Analysis.json",
      knowledgeIndexPath: "Analysis/3D Reports/old Index.md",
      partNoteCount: 0,
      previewImageCount: 0,
      generatedAt: "2026-06-22T00:00:00.000Z",
      status: "pending",
      warningCount: 0,
    };
    const { app, files } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState({
      lastKnowledgeGeneration: previousPending,
    }));

    await generateKnowledgeNote(app, ps);

    expect(generationRecords.map((record) => record.status)).toEqual(["pending", "success"]);
    expect(noticeMessages[0]).toContain("Previous knowledge generation for models/old.glb did not complete");
    expect(files.get("Analysis/3D Reports/gear Analysis.json")).toContain("Previous knowledge generation for models/old.glb did not complete");
    expect(generationRecords[1].warningCount).toBe(1);
  });

  it("keeps detail clusters as evidence without drafting standalone part notes by default", async () => {
    const evidence: ModelEvidence = {
      summary: {
        meshCount: 2,
        triangleCount: 600,
        vertexCount: 900,
        materialCount: 1,
        boundingSize: { x: 10, y: 10, z: 10 },
        rootName: "board",
      },
      parts: [{
        name: "Small detail cluster",
        triangleCount: 600,
        vertexCount: 900,
        materialName: "Plastic",
        boundingSize: { x: 0.2, y: 0.2, z: 0.2 },
        center: { x: 1, y: 1, z: 1 },
        source: "detail-cluster",
        meshNames: ["mesh-1", "mesh-2"],
        childCount: 2,
      }],
      materialNames: ["Plastic"],
      resourceWarnings: [],
      capturedAt: "2026-06-22T00:00:00.000Z",
    };
    const { app, files } = createVaultHarness();
    const { ps, generationRecords } = createPluginStoreHarness(createState({
      currentModelPath: "models/board.glb",
      modelPreview: evidence.summary,
    }));

    await generateKnowledgeNote(app, ps, {
      preview: {
        captureSnapshot: () => null,
        getModelEvidence: () => evidence,
      },
    });

    const analysis = JSON.parse(files.get("Analysis/3D Reports/board Analysis.json") ?? "{}") as AnalysisResult;
    expect(analysis.parts[0]).toMatchObject({
      name: "Small detail cluster",
      source: "detail-cluster",
      category: "detail-cluster",
      confidence: 0.48,
      meshRefs: ["mesh-1", "mesh-2"],
    });
    expect(analysis.parts[0].observations.join(" ")).toContain("avoid over-splitting");
    expect(analysis.partNotePaths).toBeUndefined();
    expect(generationRecords[generationRecords.length - 1]?.partNoteCount).toBe(0);
    expect(files.get("Analysis/3D Reports/board Report.md")).toContain("detail cluster (2)");
    expect([...files.keys()].some((path) => path.startsWith("Parts/3D Components/board/"))).toBe(false);
  });

  it("writes part split format lineage into reports, sidecars, and part notes", async () => {
    const evidence: ModelEvidence = {
      summary: {
        meshCount: 1,
        triangleCount: 420,
        vertexCount: 210,
        materialCount: 1,
        boundingSize: { x: 1.6, y: 0.8, z: 0.45 },
        rootName: "pcb",
      },
      formatLineage: {
        sourcePath: "models/pcb.step",
        sourceFormat: "step",
        effectiveFormat: "glb",
        loadStrategy: "convert",
      },
      parts: [{
        name: "R1",
        source: "component",
        componentId: "R0603-10K",
        occurrenceId: "PCB/R1",
        componentPath: "PCB/R1",
        meshNames: ["R1"],
        childCount: 1,
        triangleCount: 420,
        vertexCount: 210,
        materialName: "component matte",
        boundingSize: { x: 1.6, y: 0.8, z: 0.45 },
        center: { x: 1, y: 2, z: 0.5 },
      }],
      materialNames: ["component matte"],
      resourceWarnings: [],
      capturedAt: "2026-06-22T00:00:00.000Z",
    };
    const { app, files } = createVaultHarness();
    const { ps } = createPluginStoreHarness(createState({
      currentModelPath: "models/pcb.step",
      modelPreview: evidence.summary,
    }));

    await generateKnowledgeNote(app, ps, {
      preview: {
        captureSnapshot: () => null,
        getModelEvidence: () => evidence,
      },
    });

    const analysis = JSON.parse(files.get("Analysis/3D Reports/pcb Analysis.json") ?? "{}") as AnalysisResult;
    expect(analysis.parts[0]).toMatchObject({
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
    expect(analysis.draftingInput?.partCandidates[0]).toMatchObject({
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
    expect(files.get("Analysis/3D Reports/pcb Report.md")).toContain("STEP -&gt; GLB (convert)");
    const partNote = files.get("Parts/3D Components/pcb/01 R1.md") ?? "";
    expect(partNote).toContain("source_format: \"step\"");
    expect(partNote).toContain("effective_format: \"glb\"");
    expect(partNote).toContain("load_strategy: \"convert\"");
    expect(partNote).toContain("- Format lineage: STEP -> GLB (convert)");
  });
});

describe("collectRegisteredPartsFromProfiles", () => {
  function createRegisteredPart(partId: string, partial: Partial<PartRecord> = {}): PartRecord {
    return {
      partId,
      assetId: partial.assetId ?? "models/old.glb",
      name: partial.name ?? partId,
      source: partial.source ?? "mesh",
      meshRefs: partial.meshRefs ?? [partId],
      materialRefs: [],
      confidence: partial.confidence ?? 0.5,
      observations: [],
      inferredFunctions: [],
      knowledgeTags: [],
      reviewed: partial.reviewed ?? false,
      ...partial,
    };
  }

  it("can skip sidecar reads for fast direct-view match previews", async () => {
    const { app, files } = createVaultHarness();
    const sidecarPart = createRegisteredPart("sidecar-part", { name: "Sidecar part" });
    const savedPart = createRegisteredPart("saved-part", { name: "Saved part" });
    files.set("Analysis/old Analysis.json", JSON.stringify({ parts: [sidecarPart] }));
    const profiles: Record<string, ModelAssetProfile> = {
      "models/current.glb": createDefaultProfile(),
      "models/old.glb": {
        ...createDefaultProfile(),
        analysisSidecarPath: "Analysis/old Analysis.json",
        registeredParts: [savedPart],
      },
    };

    const fastParts = await collectRegisteredPartsFromProfiles(app, profiles, "models/current.glb", {
      includeSidecars: false,
    });
    const fullParts = await collectRegisteredPartsFromProfiles(app, profiles, "models/current.glb");

    expect(fastParts.map((part) => part.partId)).toEqual(["saved-part"]);
    expect(fullParts.map((part) => part.partId).sort()).toEqual(["saved-part", "sidecar-part"]);
  });

  it("caps collected parts while keeping reviewed and component records first", async () => {
    const { app } = createVaultHarness();
    const meshParts = Array.from({ length: 40 }, (_value, index) => createRegisteredPart(`mesh-${index}`, {
      confidence: 0.2,
    }));
    const reviewedPart = createRegisteredPart("reviewed", {
      reviewed: true,
      confidence: 0.1,
    });
    const componentPart = createRegisteredPart("component", {
      source: "component",
      componentId: "U4",
      confidence: 0.82,
    });
    const profiles: Record<string, ModelAssetProfile> = {
      "models/current.glb": createDefaultProfile(),
      "models/old.glb": {
        ...createDefaultProfile(),
        registeredParts: [...meshParts, reviewedPart, componentPart],
      },
    };

    const parts = await collectRegisteredPartsFromProfiles(app, profiles, "models/current.glb", {
      includeSidecars: false,
      maxParts: 8,
    });

    expect(parts).toHaveLength(8);
    expect(parts.some((part) => part.partId === "reviewed")).toBe(true);
    expect(parts.some((part) => part.partId === "component")).toBe(true);
  });
});

describe("registered match review output", () => {
  function createMatchedPart(
    partId: string,
    sourcePartName: string,
    reviewDecision: "confirmed" | "rejected",
  ): PartRecord {
    return {
      partId,
      assetId: "models/current.glb",
      name: `Current ${partId}`,
      meshRefs: [partId],
      materialRefs: [],
      confidence: 0.8,
      observations: [],
      inferredFunctions: [],
      knowledgeTags: [],
      registeredMatches: [{
        sourceAssetId: "models/source.glb",
        sourcePartId: `source:${partId}`,
        sourcePartName,
        matchScore: 0.9,
        confidence: 0.85,
        reasons: ["same component id"],
        reviewDecision,
      }],
      reviewed: false,
    };
  }

  it("promotes confirmed reuse and omits rejected matches from report knowledge", () => {
    const analysis: AnalysisResult = {
      asset: {
        assetId: "models/current.glb",
        title: "current",
        sourcePath: "models/current.glb",
        format: "glb",
        importedAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
        status: "ready",
      },
      parts: [
        createMatchedPart("confirmed-part", "Confirmed Source Part", "confirmed"),
        createMatchedPart("rejected-part", "Rejected Source Part", "rejected"),
      ],
      knowledgeNodes: [],
      previewImages: [],
      warnings: [],
      pipeline: [],
    };

    const report = buildKnowledgeNoteContent({
      baseName: "current",
      notePath: "Analysis/3D Reports/current Report.md",
      sourcePath: "models/current.glb",
      preview: null,
      analysis,
    });

    expect(report).toContain("Confirmed Source Part");
    expect(report).toContain("Confirmed");
    expect(report).not.toContain("Rejected Source Part");
  });
});

describe("stripTransientRegisteredPartData", () => {
  function createPart(partial: Partial<PartRecord> = {}): PartRecord {
    return {
      partId: "part-1",
      assetId: "models/board.step",
      name: "U1",
      source: "component",
      meshRefs: ["U1-body"],
      materialRefs: ["Plastic"],
      confidence: 0.82,
      observations: [],
      inferredFunctions: [],
      knowledgeTags: [],
      reviewed: false,
      ...partial,
    };
  }

  it("removes derived automatic observations while keeping structured identity", () => {
    const part = createPart({
      componentId: "U1",
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
      observations: [
        "Registered from model component metadata with 1 child mesh.",
        "Component ID: U1.",
        "Format lineage: STEP -> GLB (convert).",
        "120 triangles and 64 vertexs.",
        "Bounding size 0.022 x 0.016 x 0.002.",
        "Uses material \"Plastic\".",
        "Keep this custom note.",
      ],
    });

    const stripped = stripTransientRegisteredPartData(part);

    expect(stripped.observations).toEqual(["Keep this custom note."]);
    expect(stripped).toMatchObject({
      componentId: "U1",
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
  });

  it("preserves reviewed observations", () => {
    const part = createPart({
      reviewed: true,
      observations: [
        "Component ID: U1.",
        "Keep this reviewed note.",
      ],
    });

    expect(stripTransientRegisteredPartData(part).observations).toEqual([
      "Component ID: U1.",
      "Keep this reviewed note.",
    ]);
  });
});
