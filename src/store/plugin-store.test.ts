import type { Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/constants";
import type { ModelAssetProfile, ModelPreviewSummary, PartRecord, PersistedPluginState } from "../domain/models";
import { createPluginStore } from "./plugin-store";

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => res(value as T | PromiseLike<T>);
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cloneState(data: PersistedPluginState): PersistedPluginState {
  return JSON.parse(JSON.stringify(data)) as PersistedPluginState;
}

function createFakePlugin(
  saveDataImpl?: (data: PersistedPluginState) => Promise<void>,
  loadDataValue: PersistedPluginState | null = null,
) {
  const loadData = vi.fn(async () => loadDataValue);
  const saveData = vi.fn((data: unknown) => {
    const snapshot = cloneState(data as PersistedPluginState);
    return saveDataImpl?.(snapshot) ?? Promise.resolve();
  });

  return {
    plugin: { loadData, saveData } as unknown as Plugin,
    saveData,
  };
}

function createPreviewSummary(): ModelPreviewSummary {
  return {
    meshCount: 1,
    triangleCount: 12,
    vertexCount: 24,
    materialCount: 1,
    performanceTier: "light",
    performanceHint: "12 triangles, 1 materials. Performance tier: light.",
    resourceWarnings: [],
    boundingSize: { x: 1, y: 1, z: 1 },
    rootName: "__root__",
  };
}

async function settlePromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("createPluginStore persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("debounces state changes and saves the latest state once", async () => {
    const saved: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      saved.push(data);
    });
    const pluginStore = createPluginStore(plugin);

    pluginStore.updateSettings({ locale: "zh-CN" });
    await vi.advanceTimersByTimeAsync(250);
    pluginStore.updateSettings({ defaultCanvasHeight: 512 });
    await vi.advanceTimersByTimeAsync(499);

    expect(saveData).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saved[0].stateSchemaVersion).toBe(1);
    expect(saved[0].settings.locale).toBe("zh-CN");
    expect(saved[0].settings.defaultCanvasHeight).toBe(512);
  });

  it("queues a follow-up save when state changes during an in-flight save", async () => {
    const saves: Array<{ data: PersistedPluginState; deferred: Deferred }> = [];
    const { plugin, saveData } = createFakePlugin((data) => {
      const deferred = createDeferred();
      saves.push({ data, deferred });
      return deferred.promise;
    });
    const pluginStore = createPluginStore(plugin);

    pluginStore.updateSettings({ locale: "zh-CN" });
    await vi.advanceTimersByTimeAsync(500);

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saves[0].data.settings.locale).toBe("zh-CN");

    pluginStore.updateSettings({ locale: "en", defaultCanvasHeight: 640 });
    await vi.advanceTimersByTimeAsync(500);

    expect(saveData).toHaveBeenCalledTimes(1);

    saves[0].deferred.resolve();
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(2);
    expect(saves[1].data.settings.locale).toBe("en");
    expect(saves[1].data.settings.defaultCanvasHeight).toBe(640);

    saves[1].deferred.resolve();
    await settlePromises();
  });

  it("save clears pending debounce and waits for the latest state to persist", async () => {
    const saves: Array<{ data: PersistedPluginState; deferred: Deferred }> = [];
    const { plugin, saveData } = createFakePlugin((data) => {
      const deferred = createDeferred();
      saves.push({ data, deferred });
      return deferred.promise;
    });
    const pluginStore = createPluginStore(plugin);

    pluginStore.updateSettings({ defaultCanvasHeight: 720 });
    let flushed = false;
    const savePromise = pluginStore.save().then(() => {
      flushed = true;
    });

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saves[0].data.settings.defaultCanvasHeight).toBe(720);

    await vi.advanceTimersByTimeAsync(1_000);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(false);

    saves[0].deferred.resolve();
    await savePromise;

    expect(flushed).toBe(true);
  });

  it("dispose starts a final flush and logs save failures without throwing", async () => {
    const saves: Array<{ data: PersistedPluginState; deferred: Deferred }> = [];
    const { plugin, saveData } = createFakePlugin((data) => {
      const deferred = createDeferred();
      saves.push({ data, deferred });
      return deferred.promise;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pluginStore = createPluginStore(plugin);

    pluginStore.updateSettings({ defaultCanvasHeight: 360 });

    expect(() => pluginStore.dispose()).not.toThrow();
    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saves[0].data.settings.defaultCanvasHeight).toBe(360);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveData).toHaveBeenCalledTimes(1);

    const error = new Error("save failed");
    saves[0].deferred.reject(error);
    await settlePromises();

    expect(errorSpy).toHaveBeenCalledWith("[AI3D] Final save on dispose failed:", error);
  });

  it("does not persist transient current preview state", async () => {
    const { plugin, saveData } = createFakePlugin();
    const pluginStore = createPluginStore(plugin);

    pluginStore.setCurrentModel("models/large.glb", createPreviewSummary());
    pluginStore.clearModelPreview();
    await vi.advanceTimersByTimeAsync(1_000);
    await settlePromises();

    expect(saveData).not.toHaveBeenCalled();

    pluginStore.dispose();
    await settlePromises();

    expect(saveData).not.toHaveBeenCalled();
  });

  it("does not persist unchanged settings values", async () => {
    const { plugin, saveData } = createFakePlugin();
    const pluginStore = createPluginStore(plugin);

    pluginStore.updateSettings({ locale: DEFAULT_SETTINGS.locale });
    await vi.advanceTimersByTimeAsync(1_000);
    await settlePromises();

    expect(saveData).not.toHaveBeenCalled();
  });

  it("preserves registered detail cluster part sources when loading saved data", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "board:part:1",
            assetId: "models/board.glb",
            name: "Small detail cluster",
            source: "detail-cluster",
            meshRefs: ["mesh-1", "mesh-2"],
            childCount: 2,
            materialRefs: ["Plastic"],
            bbox: [0.1, 0.1, 0.1],
            center: [0, 0, 0],
            triangleCount: 12,
            vertexCount: 24,
            materialName: "Plastic",
            sourceFormat: "step",
            effectiveFormat: "glb",
            loadStrategy: "convert",
            confidence: 0.48,
            observations: ["Merged tiny fragments."],
            inferredFunctions: [],
            knowledgeTags: [],
            reviewed: false,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const { plugin } = createFakePlugin(undefined, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    expect(pluginStore.store.getState().modelAssetProfiles["models/board.glb"]?.registeredParts?.[0]?.source).toBe("detail-cluster");
    expect(pluginStore.store.getState().modelAssetProfiles["models/board.glb"]?.registeredParts?.[0]).toMatchObject({
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
  });

  it("does not rewrite unchanged state during load", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      stateSchemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "board:part:1",
            assetId: "models/board.glb",
            name: "Board",
            source: "component",
            meshRefs: ["board"],
            materialRefs: ["Plastic"],
            materialName: null,
            confidence: 0.82,
            observations: [],
            inferredFunctions: [],
            knowledgeTags: [],
            reviewed: false,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const { plugin, saveData } = createFakePlugin(undefined, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();
    await vi.advanceTimersByTimeAsync(1_000);
    await settlePromises();

    expect(saveData).not.toHaveBeenCalled();
  });

  it("reuses already normalized registered part arrays during load", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const registeredParts: PartRecord[] = [{
      partId: "component-part",
      assetId: "models/board.glb",
      name: "U1",
      source: "component",
      componentId: "U1",
      occurrenceId: "occ-1",
      partNumber: "U1",
      componentPath: "Board/U1",
      category: "IC",
      meshRefs: ["U1-body"],
      childCount: 1,
      materialRefs: ["Plastic"],
      bbox: [1, 2, 3],
      center: [0, 0, 0],
      triangleCount: 12,
      vertexCount: 24,
      materialName: null,
      sourceFormat: "glb",
      effectiveFormat: "glb",
      loadStrategy: "direct",
      confidence: 0.82,
      observations: ["Component ID: U1."],
      inferredFunctions: [],
      knowledgeTags: [],
      notePath: "Parts/U1.md",
      reviewed: false,
    }];
    const profile: ModelAssetProfile = {
      tags: [],
      notes: "",
      annotations: [],
      registeredParts,
      createdAt: now,
      updatedAt: now,
    };
    const saved: PersistedPluginState = {
      stateSchemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.glb": profile,
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const { plugin, saveData } = createFakePlugin(undefined, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();
    await vi.advanceTimersByTimeAsync(1_000);
    await settlePromises();

    expect(pluginStore.store.getState().modelAssetProfiles["models/board.glb"]).toBe(profile);
    expect(pluginStore.store.getState().modelAssetProfiles["models/board.glb"]?.registeredParts).toBe(registeredParts);
    expect(saveData).not.toHaveBeenCalled();
  });

  it("normalizes schema-marked profiles that still contain oversized registered part lists", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const createPart = (index: number, partial: Partial<PartRecord> = {}): PartRecord => ({
      partId: `part-${index}`,
      assetId: "models/oversized.glb",
      name: `mesh-${index}`,
      source: "mesh",
      meshRefs: [`mesh-${index}`],
      materialRefs: [],
      confidence: 0.2,
      observations: [],
      inferredFunctions: [],
      knowledgeTags: [],
      reviewed: false,
      ...partial,
    });
    const saved: PersistedPluginState = {
      stateSchemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/oversized.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [
            ...Array.from({ length: 300 }, (_value, index) => createPart(index)),
            createPart(1000, { partId: "reviewed-part", name: "Reviewed part", reviewed: true }),
            createPart(1001, { partId: "component-part", name: "Component", source: "component", confidence: 0.82 }),
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const parts = pluginStore.store.getState().modelAssetProfiles["models/oversized.glb"]?.registeredParts ?? [];
    expect(parts).toHaveLength(256);
    expect(parts.some((part) => part.partId === "reviewed-part")).toBe(true);
    expect(parts.some((part) => part.partId === "component-part")).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(normalizedSaves[0].stateSchemaVersion).toBe(1);
    expect(normalizedSaves[0].modelAssetProfiles["models/oversized.glb"]?.registeredParts).toHaveLength(256);
  });

  it("persists the current schema marker once for legacy compact state", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();
    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(normalizedSaves[0].stateSchemaVersion).toBe(1);
  });

  it("limits oversized registered part lists while keeping reviewed and component records", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const createPart = (index: number, partial: Partial<PartRecord> = {}): PartRecord => ({
      partId: `part-${index}`,
      assetId: "models/large.glb",
      name: `mesh-${index}`,
      source: "mesh",
      meshRefs: [`mesh-${index}`],
      materialRefs: [],
      confidence: 0.2,
      observations: [],
      inferredFunctions: [],
      knowledgeTags: [],
      reviewed: false,
      ...partial,
    });
    const manyMeshParts = Array.from({ length: 300 }, (_value, index) => createPart(index));
    const reviewedPart = createPart(1000, {
      partId: "reviewed-part",
      name: "Reviewed part",
      reviewed: true,
    });
    const componentPart = createPart(1001, {
      partId: "component-part",
      name: "U4",
      source: "component",
      componentId: "U4",
      confidence: 0.82,
    });
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/large.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [...manyMeshParts, reviewedPart, componentPart],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const parts = pluginStore.store.getState().modelAssetProfiles["models/large.glb"]?.registeredParts ?? [];
    expect(parts).toHaveLength(256);
    expect(parts.some((part) => part.partId === "reviewed-part")).toBe(true);
    expect(parts.some((part) => part.partId === "component-part")).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    expect(normalizedSaves[0].modelAssetProfiles["models/large.glb"]?.registeredParts).toHaveLength(256);
  });

  it("strips transient registered matches and quickly persists normalized profiles", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/large.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "part-1",
            assetId: "models/large.glb",
            name: "U1",
            source: "component",
            meshRefs: Array.from({ length: 100 }, (_value, index) => `U1-mesh-${index}`),
            materialRefs: [],
            confidence: 0.82,
            observations: [],
            inferredFunctions: [],
            knowledgeTags: [],
            registeredMatches: [{
              sourceAssetId: "models/old.glb",
              sourcePartId: "old-part",
              sourcePartName: "Old U1",
              matchScore: 0.95,
              confidence: 0.9,
              reasons: ["same component id"],
            }],
            reviewed: false,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const part = pluginStore.store.getState().modelAssetProfiles["models/large.glb"]?.registeredParts?.[0];
    expect(part?.registeredMatches).toBeUndefined();
    expect(part?.meshRefs).toHaveLength(16);

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    const persistedPart = normalizedSaves[0].modelAssetProfiles["models/large.glb"]?.registeredParts?.[0];
    expect(persistedPart?.registeredMatches).toBeUndefined();
    expect(persistedPart?.meshRefs).toHaveLength(16);
  });

  it("compacts persisted registered part number tuples during load", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "part-1",
            assetId: "models/board.glb",
            name: "U1",
            source: "component",
            meshRefs: ["U1-body"],
            materialRefs: [],
            bbox: [0.022000000000000006, 0.016399999999999998, 0.0015009999999989988],
            center: [0.049657099314199, 0.033020066040132, 0.002336656972313501],
            confidence: 0.82,
            observations: [],
            inferredFunctions: [],
            knowledgeTags: [],
            reviewed: false,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const part = pluginStore.store.getState().modelAssetProfiles["models/board.glb"]?.registeredParts?.[0];
    expect(part?.bbox).toEqual([0.022, 0.0164, 0.001501]);
    expect(part?.center).toEqual([0.0496571, 0.0330201, 0.00233666]);

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    const persistedPart = normalizedSaves[0].modelAssetProfiles["models/board.glb"]?.registeredParts?.[0];
    expect(persistedPart?.bbox).toEqual([0.022, 0.0164, 0.001501]);
    expect(persistedPart?.center).toEqual([0.0496571, 0.0330201, 0.00233666]);
  });

  it("strips derived automatic registered part observations during load", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/board.step": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "part-1",
            assetId: "models/board.step",
            name: "U1",
            source: "component",
            componentId: "U1",
            componentPath: "__root__/Board/U1",
            meshRefs: ["U1-body"],
            materialRefs: ["Plastic"],
            bbox: [0.022, 0.0164, 0.001501],
            center: [0.0496571, 0.0330201, 0.00233666],
            triangleCount: 120,
            vertexCount: 64,
            materialName: "Plastic",
            sourceFormat: "step",
            effectiveFormat: "glb",
            loadStrategy: "convert",
            confidence: 0.82,
            observations: [
              "Registered from model component metadata with 1 child mesh.",
              "Component ID: U1.",
              "Component path: __root__/Board/U1.",
              "Format lineage: STEP -> GLB (convert).",
              "120 triangles and 64 vertexs.",
              "Bounding size 0.022 x 0.016 x 0.002.",
              "Uses material \"Plastic\".",
              "Custom inspection note.",
            ],
            inferredFunctions: [],
            knowledgeTags: [],
            reviewed: false,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const normalizedSaves: PersistedPluginState[] = [];
    const { plugin, saveData } = createFakePlugin(async (data) => {
      normalizedSaves.push(data);
    }, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const part = pluginStore.store.getState().modelAssetProfiles["models/board.step"]?.registeredParts?.[0];
    expect(part?.observations).toEqual(["Custom inspection note."]);
    expect(part).toMatchObject({
      componentId: "U1",
      componentPath: "__root__/Board/U1",
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
      triangleCount: 120,
      vertexCount: 64,
      materialName: "Plastic",
    });

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).toHaveBeenCalledTimes(1);
    const persistedPart = normalizedSaves[0].modelAssetProfiles["models/board.step"]?.registeredParts?.[0];
    expect(persistedPart?.observations).toEqual(["Custom inspection note."]);
  });

  it("keeps reviewed registered part observations during compaction", async () => {
    const now = "2026-06-22T00:00:00.000Z";
    const saved: PersistedPluginState = {
      stateSchemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS },
      convertedAssetRecords: [],
      modelAssetProfiles: {
        "models/reviewed.glb": {
          tags: [],
          notes: "",
          annotations: [],
          registeredParts: [{
            partId: "part-1",
            assetId: "models/reviewed.glb",
            name: "Reviewed U1",
            source: "component",
            meshRefs: ["U1-body"],
            materialRefs: [],
            confidence: 0.82,
            observations: [
              "Component ID: U1.",
              "Custom reviewed note.",
            ],
            inferredFunctions: [],
            knowledgeTags: [],
            reviewed: true,
          }],
          createdAt: now,
          updatedAt: now,
        },
      },
      agentDraft: "",
      agentPlan: null,
      lastKnowledgeGeneration: null,
    };
    const { plugin, saveData } = createFakePlugin(undefined, saved);
    const pluginStore = createPluginStore(plugin);

    await pluginStore.load();

    const part = pluginStore.store.getState().modelAssetProfiles["models/reviewed.glb"]?.registeredParts?.[0];
    expect(part?.observations).toEqual([
      "Component ID: U1.",
      "Custom reviewed note.",
    ]);

    await vi.advanceTimersByTimeAsync(50);
    await settlePromises();

    expect(saveData).not.toHaveBeenCalled();
  });
});
