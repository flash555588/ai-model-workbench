import type { Plugin } from "obsidian";
import type { ModelAssetFormat, ModelAssetProfile, ModelLoadStrategy, PartRecord, PersistedPluginState, PluginState } from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/constants";
import { createStore, type Store } from "./create-store";

export interface PluginStore {
  store: Store<PluginState>;
  load: () => Promise<void>;
  save: () => Promise<void>;
  dispose: () => void;
  /** True if the loaded data had an explicit locale field (not from DEFAULT_SETTINGS). */
  localeLoadedFromSaved: boolean;
  /** Typed action: set current model path and preview, clearing selected part. */
  setCurrentModel(path: string | null, preview: import("../domain/models").ModelPreviewSummary | null): void;
  /** Typed action: clear model preview and selected part. */
  clearModelPreview(): void;
  /** Typed action: update a single model profile by path with an updater function. */
  updateModelProfile(path: string, updater: (existing: ModelAssetProfile) => Partial<ModelAssetProfile>): void;
  /** Typed action: replace converted asset records. */
  setConvertedAssetRecords(records: import("../domain/models").ConvertedAssetRecord[]): void;
  /** Typed action: update settings partially. */
  updateSettings(partial: Partial<import("../domain/models").PluginSettings>): void;
  /** Typed action: set the last knowledge generation record. */
  setLastKnowledgeGeneration(record: import("../domain/models").KnowledgeGenerationRecord | null): void;
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

const MAX_REGISTERED_PARTS_PER_PROFILE = 256;
const MAX_REGISTERED_PART_MESH_REFS = 64;
const MAX_REGISTERED_PART_MATERIAL_REFS = 32;
const MAX_REGISTERED_PART_OBSERVATIONS = 16;
const NORMALIZED_STATE_SAVE_DELAY_MS = 50;

export function createPluginStore(plugin: Plugin): PluginStore {
  const store = createStore<PluginState>(INITIAL_STATE);

  let saveTimer: number | null = null;
  let dirtyRevision = 0;
  let savedRevision = 0;
  let saveLoop: Promise<void> | null = null;

  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      flushLatestState().catch(err => console.error("[AI3D] Auto-save failed:", err));
    }, 500);
  }

  function markDirty() {
    dirtyRevision += 1;
    scheduleSave();
  }

  function snapshotPersistedState(): PersistedPluginState {
    const s = store.getState();
    return {
      settings: s.settings,
      convertedAssetRecords: s.convertedAssetRecords,
      modelAssetProfiles: s.modelAssetProfiles,
      agentDraft: s.agentDraft,
      agentPlan: s.agentPlan,
      lastKnowledgeGeneration: s.lastKnowledgeGeneration,
    };
  }

  function flushLatestState(force = false): Promise<void> {
    if (force && savedRevision >= dirtyRevision) {
      dirtyRevision += 1;
    }

    if (!saveLoop) {
      saveLoop = runSaveLoop();
    }

    return saveLoop;
  }

  async function runSaveLoop(): Promise<void> {
    try {
      while (savedRevision < dirtyRevision) {
        const targetRevision = dirtyRevision;
        const data = snapshotPersistedState();
        await plugin.saveData(data);
        savedRevision = Math.max(savedRevision, targetRevision);
      }
    } finally {
      saveLoop = null;
    }

    if (savedRevision < dirtyRevision) {
      await flushLatestState();
    }
  }

  // Auto-save on every state change
  store.subscribe(() => markDirty());

  let localeLoadedFromSaved = false;

  return {
    store,
    get localeLoadedFromSaved() { return localeLoadedFromSaved; },

    setCurrentModel(path, preview) {
      store.setState({ currentModelPath: path, modelPreview: preview, selectedPart: null });
    },

    clearModelPreview() {
      store.setState({ modelPreview: null, selectedPart: null });
    },

    updateModelProfile(path, updater) {
      const current = store.getState().modelAssetProfiles;
      const existing = current[path] ?? createDefaultProfile();
      store.setState({
        modelAssetProfiles: { ...current, [path]: { ...existing, ...updater(existing), updatedAt: new Date().toISOString() } },
      });
    },

    setConvertedAssetRecords(records) {
      store.setState({ convertedAssetRecords: records });
    },

    updateSettings(partial) {
      const current = store.getState().settings;
      store.setState({ settings: { ...current, ...partial } });
    },

    setLastKnowledgeGeneration(record) {
      store.setState({ lastKnowledgeGeneration: record });
    },

    async load() {
      const saved = (await plugin.loadData()) as PersistedPluginState | null;
      if (!saved) return;
      localeLoadedFromSaved = !!saved.settings?.locale;
      const profiles = normalizeModelAssetProfiles(saved.modelAssetProfiles);
      store.setState({
        settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
        convertedAssetRecords: saved.convertedAssetRecords ?? [],
        modelAssetProfiles: profiles,
        agentDraft: saved.agentDraft ?? "",
        agentPlan: saved.agentPlan ?? null,
        lastKnowledgeGeneration: normalizeKnowledgeGenerationRecord(saved.lastKnowledgeGeneration),
      });
      if (shouldPersistNormalizedProfiles(saved.modelAssetProfiles, profiles)) {
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          saveTimer = null;
          flushLatestState().catch(err => console.error("[AI3D] Normalized state save failed:", err));
        }, NORMALIZED_STATE_SAVE_DELAY_MS);
      }
    },

    async save() {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      await flushLatestState(true);
    },

    dispose() {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      // Fire-and-forget final flush so pending state changes are not lost on unload.
      flushLatestState(true).catch(err => console.error("[AI3D] Final save on dispose failed:", err));
    },
  };
}

function shouldPersistNormalizedProfiles(
  saved: PersistedPluginState["modelAssetProfiles"] | undefined,
  normalized: Record<string, ModelAssetProfile>,
): boolean {
  if (!saved || typeof saved !== "object") {
    return false;
  }

  for (const [path, profile] of Object.entries(saved as Record<string, Partial<ModelAssetProfile> | null | undefined>)) {
    if (!profile || typeof profile !== "object") continue;
    const savedParts = Array.isArray(profile.registeredParts) ? profile.registeredParts : [];
    const normalizedParts = normalized[path]?.registeredParts ?? [];
    if (savedParts.length !== normalizedParts.length) {
      return true;
    }
    if (savedParts.some((part) => !!part && typeof part === "object" && "registeredMatches" in part)) {
      return true;
    }
    if (savedParts.some((part) => {
      if (!part || typeof part !== "object") return false;
      return (Array.isArray(part.meshRefs) && part.meshRefs.length > MAX_REGISTERED_PART_MESH_REFS)
        || (Array.isArray(part.materialRefs) && part.materialRefs.length > MAX_REGISTERED_PART_MATERIAL_REFS)
        || (Array.isArray(part.observations) && part.observations.length > MAX_REGISTERED_PART_OBSERVATIONS);
    })) {
      return true;
    }
  }

  return false;
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

function normalizeStringArray(value: unknown, maxEntries = Number.POSITIVE_INFINITY): string[] {
  const entries = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return Number.isFinite(maxEntries) ? entries.slice(0, maxEntries) : entries;
}

function normalizeNumberTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const tuple = value.slice(0, 3).map((entry) => Number(entry));
  return tuple.every(Number.isFinite) ? [tuple[0], tuple[1], tuple[2]] : undefined;
}

function normalizePartSource(value: unknown): PartRecord["source"] {
  return value === "group" || value === "mesh" || value === "component" || value === "detail-cluster"
    ? value
    : undefined;
}

function normalizeModelAssetFormat(value: unknown): ModelAssetFormat | undefined {
  return value === "glb" || value === "gltf" || value === "stl" || value === "obj" || value === "splat" ||
    value === "ply" || value === "fbx" || value === "step" || value === "stp" || value === "iges" ||
    value === "igs" || value === "brep" || value === "sldprt" || value === "3mf" || value === "dae"
    ? value
    : undefined;
}

function normalizeModelLoadStrategy(value: unknown): ModelLoadStrategy | undefined {
  return value === "direct" || value === "convert" ? value : undefined;
}

function getRegisteredPartRank(part: PartRecord): number {
  if (part.reviewed || part.notePath) return 0;
  if (part.source === "component") return 1;
  if (part.source === "group") return 2;
  if (part.source === "detail-cluster") return 3;
  return 4;
}

function limitRegisteredParts(parts: PartRecord[]): PartRecord[] {
  if (parts.length <= MAX_REGISTERED_PARTS_PER_PROFILE) {
    return parts;
  }

  return [...parts]
    .sort((left, right) => {
      const rankDelta = getRegisteredPartRank(left) - getRegisteredPartRank(right);
      if (rankDelta !== 0) return rankDelta;
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) return confidenceDelta;
      return (right.childCount ?? 0) - (left.childCount ?? 0);
    })
    .slice(0, MAX_REGISTERED_PARTS_PER_PROFILE);
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
      source: normalizePartSource(record.source),
      componentId: typeof record.componentId === "string" ? record.componentId : undefined,
      occurrenceId: typeof record.occurrenceId === "string" ? record.occurrenceId : undefined,
      partNumber: typeof record.partNumber === "string" ? record.partNumber : undefined,
      componentPath: typeof record.componentPath === "string" ? record.componentPath : undefined,
      category: typeof record.category === "string" ? record.category : undefined,
      meshRefs: normalizeStringArray(record.meshRefs, MAX_REGISTERED_PART_MESH_REFS),
      childCount: Number.isFinite(record.childCount) ? Math.max(0, Math.floor(Number(record.childCount))) : undefined,
      materialRefs: normalizeStringArray(record.materialRefs, MAX_REGISTERED_PART_MATERIAL_REFS),
      bbox: normalizeNumberTuple(record.bbox),
      center: normalizeNumberTuple(record.center),
      triangleCount: Number.isFinite(record.triangleCount) ? Math.max(0, Math.floor(Number(record.triangleCount))) : undefined,
      vertexCount: Number.isFinite(record.vertexCount) ? Math.max(0, Math.floor(Number(record.vertexCount))) : undefined,
      materialName: typeof record.materialName === "string" ? record.materialName : null,
      sourceFormat: normalizeModelAssetFormat(record.sourceFormat),
      effectiveFormat: normalizeModelAssetFormat(record.effectiveFormat),
      loadStrategy: normalizeModelLoadStrategy(record.loadStrategy),
      confidence: Number.isFinite(record.confidence) ? Math.max(0, Math.min(1, Number(record.confidence))) : 0.5,
      observations: normalizeStringArray(record.observations, MAX_REGISTERED_PART_OBSERVATIONS),
      inferredFunctions: normalizeStringArray(record.inferredFunctions),
      knowledgeTags: normalizeStringArray(record.knowledgeTags),
      notePath: typeof record.notePath === "string" ? record.notePath : undefined,
      registeredMatches: undefined,
      reviewed: record.reviewed === true,
    });
  }

  const limitedParts = limitRegisteredParts(parts);
  return limitedParts.length > 0 ? limitedParts : undefined;
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
    status: saved.status === "failed" || saved.status === "pending" ? saved.status : "success",
    warningCount: Number.isFinite(saved.warningCount) ? Math.max(0, Math.floor(saved.warningCount)) : 0,
  };
}

export function createDefaultProfile(): ModelAssetProfile {
  const now = new Date().toISOString();
  return {
    tags: [],
    notes: "",
    annotations: [],
    registeredParts: undefined,
    createdAt: now,
    updatedAt: now,
  };
}
