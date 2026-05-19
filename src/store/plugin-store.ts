import type { Plugin } from "obsidian";
import type { PluginState, PersistedPluginState } from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/constants";
import { createStore, type Store } from "./create-store";

export interface PluginStore {
  store: Store<PluginState>;
  load: () => Promise<void>;
  save: () => Promise<void>;
  dispose: () => void;
  /** True if the loaded data had an explicit locale field (not from DEFAULT_SETTINGS). */
  localeLoadedFromSaved: boolean;
}

const INITIAL_STATE: PluginState = {
  settings: { ...DEFAULT_SETTINGS },
  currentModelPath: null,
  convertedAssetRecords: [],
  modelAssetProfiles: {},
  agentDraft: "",
  agentPlan: null,
  modelPreview: null,
  selectedPart: null,
};

export function createPluginStore(plugin: Plugin): PluginStore {
  const store = createStore<PluginState>(INITIAL_STATE);

  let saveTimer: number | null = null;

  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      persist().catch(err => console.error("[AI3D] Auto-save failed:", err));
    }, 500);
  }

  async function persist() {
    const s = store.getState();
    const data: PersistedPluginState = {
      settings: s.settings,
      convertedAssetRecords: s.convertedAssetRecords,
      modelAssetProfiles: s.modelAssetProfiles,
      agentDraft: s.agentDraft,
      agentPlan: s.agentPlan,
    };
    await plugin.saveData(data);
  }

  // Auto-save on every state change
  store.subscribe(() => scheduleSave());

  let localeLoadedFromSaved = false;

  return {
    store,
    get localeLoadedFromSaved() { return localeLoadedFromSaved; },

    async load() {
      const saved = (await plugin.loadData()) as PersistedPluginState | null;
      if (!saved) return;
      localeLoadedFromSaved = !!saved.settings?.locale;
      store.setState({
        settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
        convertedAssetRecords: saved.convertedAssetRecords ?? [],
        modelAssetProfiles: saved.modelAssetProfiles ?? {},
        agentDraft: saved.agentDraft ?? "",
        agentPlan: saved.agentPlan ?? null,
      });
    },

    async save() {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      await persist();
    },

    dispose() {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
    },
  };
}
