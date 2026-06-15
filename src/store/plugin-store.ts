import type { Plugin } from "obsidian";
import type { ModelAssetProfile, PartRecord, PersistedPluginState, PluginState } from "../domain/models";
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
  lastKnowledgeGeneration: null,
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
      lastKnowledgeGeneration: s.lastKnowledgeGeneration,
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
        modelAssetProfiles: normalizeModelAssetProfiles(saved.modelAssetProfiles),
        agentDraft: saved.agentDraft ?? "",
        agentPlan: saved.agentPlan ?? null,
        lastKnowledgeGeneration: normalizeKnowledgeGenerationRecord(saved.lastKnowledgeGeneration),
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
      // Fire-and-forget final flush so pending state changes are not lost on unload.
      persist().catch(err => console.error("[AI3D] Final save on dispose failed:", err));
    },
  };
}

function normalizeModelAssetProfiles(
  saved: PersistedPluginState["modelAssetProfiles"] | undefined,
): Record<string, ModelAssetProfile> {
  if (!saved || typeof saved !== "object") {
    return {};
  }

  const profiles: Record<string, ModelAssetProfile> = {};
  for (const [path, profile] of Object.entries(saved as Record<string, Partial<ModelAssetProfile> | null | undefined>)) {
    if (!profile || typeof profile !== "object") continue;
    const now = new Date().toISOString();
    profiles[path] = {
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      notes: typeof profile.notes === "string" ? profile.notes : "",
      annotations: Array.isArray(profile.annotations) ? profile.annotations : [],
      registeredParts: normalizeRegisteredParts(profile.registeredParts, path),
      analysisVersion: typeof profile.analysisVersion === "string" ? profile.analysisVersion : undefined,
      reportNotePath: typeof profile.reportNotePath === "string" ? profile.reportNotePath : undefined,
      analysisSidecarPath: typeof profile.analysisSidecarPath === "string" ? profile.analysisSidecarPath : undefined,
      previewImagePaths: Array.isArray(profile.previewImagePaths) ? profile.previewImagePaths.filter((path): path is string => typeof path === "string") : undefined,
      knowledgeIndexPath: typeof profile.knowledgeIndexPath === "string" ? profile.knowledgeIndexPath : undefined,
      createdAt: typeof profile.createdAt === "string" ? profile.createdAt : now,
      updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : now,
    };
  }
  return profiles;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizeNumberTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const tuple = value.slice(0, 3).map((entry) => Number(entry));
  return tuple.every(Number.isFinite) ? [tuple[0], tuple[1], tuple[2]] : undefined;
}

function normalizeRegisteredParts(value: unknown, fallbackAssetId: string): PartRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts: PartRecord[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<PartRecord>;
    const partId = typeof record.partId === "string" ? record.partId : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (!partId || !name) continue;
    const assetId = typeof record.assetId === "string" && record.assetId ? record.assetId : fallbackAssetId;
    const key = `${assetId}:${partId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({
      partId,
      assetId,
      parentPartId: typeof record.parentPartId === "string" ? record.parentPartId : undefined,
      name,
      source: record.source === "group" || record.source === "mesh" || record.source === "component" ? record.source : undefined,
      componentId: typeof record.componentId === "string" ? record.componentId : undefined,
      occurrenceId: typeof record.occurrenceId === "string" ? record.occurrenceId : undefined,
      partNumber: typeof record.partNumber === "string" ? record.partNumber : undefined,
      componentPath: typeof record.componentPath === "string" ? record.componentPath : undefined,
      category: typeof record.category === "string" ? record.category : undefined,
      meshRefs: normalizeStringArray(record.meshRefs),
      childCount: Number.isFinite(record.childCount) ? Math.max(0, Math.floor(Number(record.childCount))) : undefined,
      materialRefs: normalizeStringArray(record.materialRefs),
      bbox: normalizeNumberTuple(record.bbox),
      center: normalizeNumberTuple(record.center),
      triangleCount: Number.isFinite(record.triangleCount) ? Math.max(0, Math.floor(Number(record.triangleCount))) : undefined,
      vertexCount: Number.isFinite(record.vertexCount) ? Math.max(0, Math.floor(Number(record.vertexCount))) : undefined,
      materialName: typeof record.materialName === "string" ? record.materialName : null,
      confidence: Number.isFinite(record.confidence) ? Math.max(0, Math.min(1, Number(record.confidence))) : 0.5,
      observations: normalizeStringArray(record.observations),
      inferredFunctions: normalizeStringArray(record.inferredFunctions),
      knowledgeTags: normalizeStringArray(record.knowledgeTags),
      notePath: typeof record.notePath === "string" ? record.notePath : undefined,
      registeredMatches: Array.isArray(record.registeredMatches) ? record.registeredMatches : undefined,
      reviewed: record.reviewed === true,
    });
  }

  return parts.length > 0 ? parts : undefined;
}

function normalizeKnowledgeGenerationRecord(
  saved: PersistedPluginState["lastKnowledgeGeneration"] | undefined,
): PersistedPluginState["lastKnowledgeGeneration"] {
  if (!saved || typeof saved !== "object") {
    return null;
  }

  const modelPath = typeof saved.modelPath === "string" ? saved.modelPath : "";
  if (!modelPath) {
    return null;
  }

  return {
    modelPath,
    reportNotePath: typeof saved.reportNotePath === "string" ? saved.reportNotePath : undefined,
    analysisSidecarPath: typeof saved.analysisSidecarPath === "string" ? saved.analysisSidecarPath : undefined,
    knowledgeIndexPath: typeof saved.knowledgeIndexPath === "string" ? saved.knowledgeIndexPath : undefined,
    partNoteCount: Number.isFinite(saved.partNoteCount) ? Math.max(0, Math.floor(saved.partNoteCount)) : 0,
    previewImageCount: Number.isFinite(saved.previewImageCount) ? Math.max(0, Math.floor(saved.previewImageCount)) : 0,
    generatedAt: typeof saved.generatedAt === "string" ? saved.generatedAt : new Date().toISOString(),
    status: saved.status === "failed" ? "failed" : "success",
    warningCount: Number.isFinite(saved.warningCount) ? Math.max(0, Math.floor(saved.warningCount)) : 0,
  };
}
