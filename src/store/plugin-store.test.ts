import type { Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/constants";
import type { PersistedPluginState } from "../domain/models";
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
});
