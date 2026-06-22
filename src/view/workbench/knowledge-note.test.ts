import type { App } from "obsidian";
import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/constants";
import type { KnowledgeGenerationRecord, ModelAssetProfile, PluginState } from "../../domain/models";
import type { PluginStore } from "../../store/plugin-store";
import { createDefaultProfile } from "../../store/plugin-store";
import { generateKnowledgeNote } from "./knowledge-note";

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
    },
  };

  const openFile = vi.fn(async () => undefined);
  const app = {
    vault,
    workspace: {
      getLeaf: vi.fn(() => ({ openFile })),
    },
  } as unknown as App;

  return { app, files, operations, openFile };
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
    expect(files.has("Analysis/3D Reports/gear Index.md")).toBe(true);
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
});
