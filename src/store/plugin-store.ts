import type { Plugin } from "obsidian";
import type { ModelAssetProfile, PartRecord, PersistedPluginState, PluginState } from "../domain/models";
import { DEFAULT_SETTINGS } from "../domain/constants";
import { createStore, type Store } from "./create-store";
import { compactPersistedNumberTuple, isCompactPersistedNumber } from "../utils/compact-number";
import {
  areRegisteredPartObservationsPersistedCompact,
  compactRegisteredPartForPersistence,
  MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS,
  MAX_PERSISTED_REGISTERED_PART_MESH_REFS,
  MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS,
  normalizeModelAssetFormat,
  normalizeModelLoadStrategy,
  normalizePartSource,
  rankRegisteredPart,
} from "../utils/registered-part-persistence";
import {
  isReusableRegisteredPartMatchReviews,
  normalizeRegisteredPartMatchReviews,
} from "../utils/registered-match-review";

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
const NORMALIZED_STATE_SAVE_DELAY_MS = 50;
const PERSISTED_STATE_SCHEMA_VERSION = 1;

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
      stateSchemaVersion: PERSISTED_STATE_SCHEMA_VERSION,
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
      markDirty();
    },

    setConvertedAssetRecords(records) {
      if (records === store.getState().convertedAssetRecords) return;
      store.setState({ convertedAssetRecords: records });
      markDirty();
    },

    updateSettings(partial) {
      const current = store.getState().settings;
      if (!Object.entries(partial).some(([key, value]) => current[key as keyof typeof current] !== value)) {
        return;
      }
      store.setState({ settings: { ...current, ...partial } });
      markDirty();
    },

    setLastKnowledgeGeneration(record) {
      if (record === store.getState().lastKnowledgeGeneration) return;
      store.setState({ lastKnowledgeGeneration: record });
      markDirty();
    },

    async load() {
      const saved = (await plugin.loadData()) as PersistedPluginState | null;
      if (!saved) return;
      localeLoadedFromSaved = !!saved.settings?.locale;
      const schemaCurrent = saved.stateSchemaVersion === PERSISTED_STATE_SCHEMA_VERSION;
      const { profiles, changed: profilesChanged } = normalizeModelAssetProfiles(saved.modelAssetProfiles, {
        trustPersistedSchema: schemaCurrent,
      });
      store.setState({
        settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
        convertedAssetRecords: saved.convertedAssetRecords ?? [],
        modelAssetProfiles: profiles,
        agentDraft: saved.agentDraft ?? "",
        agentPlan: saved.agentPlan ?? null,
        lastKnowledgeGeneration: normalizeKnowledgeGenerationRecord(saved.lastKnowledgeGeneration),
      });
      if (profilesChanged || !schemaCurrent) {
        dirtyRevision += 1;
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
      flushLatestState().catch(err => console.error("[AI3D] Final save on dispose failed:", err));
    },
  };
}

function normalizeModelAssetProfiles(
  saved: PersistedPluginState["modelAssetProfiles"] | undefined,
  options: { trustPersistedSchema?: boolean } = {},
): { profiles: Record<string, ModelAssetProfile>; changed: boolean } {
  if (!saved || typeof saved !== "object") {
    return { profiles: {}, changed: false };
  }

  const profiles: Record<string, ModelAssetProfile> = {};
  let changed = false;
  for (const [path, profile] of Object.entries(saved as Record<string, Partial<ModelAssetProfile> | null | undefined>)) {
    if (!profile || typeof profile !== "object") continue;
    if (options.trustPersistedSchema && isReusableModelAssetProfile(profile)) {
      profiles[path] = profile;
      continue;
    }
    const now = new Date().toISOString();
    const registeredParts = normalizeRegisteredParts(profile.registeredParts, path);
    const registeredMatchReviews = normalizeRegisteredPartMatchReviews(profile.registeredMatchReviews);
    changed = changed || registeredParts.changed || registeredMatchReviews.changed;
    profiles[path] = {
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      notes: typeof profile.notes === "string" ? profile.notes : "",
      annotations: Array.isArray(profile.annotations) ? profile.annotations : [],
      registeredParts: registeredParts.parts,
      registeredMatchReviews: registeredMatchReviews.reviews,
      analysisVersion: typeof profile.analysisVersion === "string" ? profile.analysisVersion : undefined,
      reportNotePath: typeof profile.reportNotePath === "string" ? profile.reportNotePath : undefined,
      analysisSidecarPath: typeof profile.analysisSidecarPath === "string" ? profile.analysisSidecarPath : undefined,
      previewImagePaths: Array.isArray(profile.previewImagePaths) ? profile.previewImagePaths.filter((path): path is string => typeof path === "string") : undefined,
      knowledgeIndexPath: typeof profile.knowledgeIndexPath === "string" ? profile.knowledgeIndexPath : undefined,
      createdAt: typeof profile.createdAt === "string" ? profile.createdAt : now,
      updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : now,
    };
  }
  return { profiles, changed };
}

function isReusableModelAssetProfile(profile: Partial<ModelAssetProfile>): profile is ModelAssetProfile {
  return Array.isArray(profile.tags) &&
    typeof profile.notes === "string" &&
    Array.isArray(profile.annotations) &&
    (
      profile.registeredParts === undefined ||
      (Array.isArray(profile.registeredParts) && profile.registeredParts.length <= MAX_REGISTERED_PARTS_PER_PROFILE)
    ) &&
    (
      profile.registeredMatchReviews === undefined ||
      isReusableRegisteredPartMatchReviews(profile.registeredMatchReviews)
    ) &&
    isNormalizedOptionalString(profile.analysisVersion) &&
    isNormalizedOptionalString(profile.reportNotePath) &&
    isNormalizedOptionalString(profile.analysisSidecarPath) &&
    isNormalizedOptionalString(profile.knowledgeIndexPath) &&
    (profile.previewImagePaths === undefined || Array.isArray(profile.previewImagePaths)) &&
    typeof profile.createdAt === "string" &&
    typeof profile.updatedAt === "string";
}

function normalizeStringArray(value: unknown, maxEntries = Number.POSITIVE_INFINITY): string[] {
  const entries = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return Number.isFinite(maxEntries) ? entries.slice(0, maxEntries) : entries;
}

function isNormalizedStringArray(value: unknown, maxEntries = Number.POSITIVE_INFINITY): value is string[] {
  return Array.isArray(value) &&
    (!Number.isFinite(maxEntries) || value.length <= maxEntries) &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeNumberTuple(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const tuple = value.slice(0, 3).map((entry) => Number(entry));
  return tuple.every(Number.isFinite) ? compactPersistedNumberTuple(tuple) : undefined;
}

function isNormalizedNumberTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => Number.isFinite(entry) && isCompactPersistedNumber(Number(entry)));
}

function isNormalizedPartSource(value: unknown): boolean {
  return value === undefined || normalizePartSource(value) === value;
}

function isNormalizedModelAssetFormat(value: unknown): boolean {
  return value === undefined || normalizeModelAssetFormat(value) === value;
}

function isNormalizedModelLoadStrategy(value: unknown): boolean {
  return value === undefined || normalizeModelLoadStrategy(value) === value;
}

function isNormalizedOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNormalizedOptionalCount(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

function isReusableRegisteredPart(entry: unknown): entry is PartRecord {
  if (!entry || typeof entry !== "object") return false;
  const record = entry as Partial<PartRecord>;
  if ("registeredMatches" in record) return false;
  return typeof record.partId === "string" && record.partId.length > 0 &&
    typeof record.assetId === "string" && record.assetId.length > 0 &&
    typeof record.name === "string" && record.name.length > 0 &&
    isNormalizedOptionalString(record.parentPartId) &&
    isNormalizedPartSource(record.source) &&
    isNormalizedOptionalString(record.componentId) &&
    isNormalizedOptionalString(record.occurrenceId) &&
    isNormalizedOptionalString(record.partNumber) &&
    isNormalizedOptionalString(record.componentPath) &&
    isNormalizedOptionalString(record.category) &&
    isNormalizedStringArray(record.meshRefs, MAX_PERSISTED_REGISTERED_PART_MESH_REFS) &&
    isNormalizedOptionalCount(record.childCount) &&
    isNormalizedStringArray(record.materialRefs, MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS) &&
    (record.bbox === undefined || isNormalizedNumberTuple(record.bbox)) &&
    (record.center === undefined || isNormalizedNumberTuple(record.center)) &&
    isNormalizedOptionalCount(record.triangleCount) &&
    isNormalizedOptionalCount(record.vertexCount) &&
    (typeof record.materialName === "string" || record.materialName === null) &&
    isNormalizedModelAssetFormat(record.sourceFormat) &&
    isNormalizedModelAssetFormat(record.effectiveFormat) &&
    isNormalizedModelLoadStrategy(record.loadStrategy) &&
    Number.isFinite(record.confidence) && Number(record.confidence) >= 0 && Number(record.confidence) <= 1 &&
    isNormalizedStringArray(record.observations, MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS) &&
    areRegisteredPartObservationsPersistedCompact(record as PartRecord) &&
    isNormalizedStringArray(record.inferredFunctions) &&
    isNormalizedStringArray(record.knowledgeTags) &&
    isNormalizedOptionalString(record.notePath) &&
    typeof record.reviewed === "boolean";
}

function reuseNormalizedRegisteredParts(value: readonly unknown[]): PartRecord[] | undefined | null {
  if (value.length === 0) {
    return undefined;
  }
  if (value.length > MAX_REGISTERED_PARTS_PER_PROFILE) {
    return null;
  }

  const seen = new Set<string>();
  for (const entry of value) {
    if (!isReusableRegisteredPart(entry)) {
      return null;
    }
    const key = `${entry.assetId}:${entry.partId}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
  }
  return value as PartRecord[];
}

function limitRegisteredParts(parts: PartRecord[]): PartRecord[] {
  if (parts.length <= MAX_REGISTERED_PARTS_PER_PROFILE) {
    return parts;
  }

  return [...parts]
    .sort((left, right) => {
      const rankDelta = rankRegisteredPart(left) - rankRegisteredPart(right);
      if (rankDelta !== 0) return rankDelta;
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) return confidenceDelta;
      return (right.childCount ?? 0) - (left.childCount ?? 0);
    })
    .slice(0, MAX_REGISTERED_PARTS_PER_PROFILE);
}

function normalizeRegisteredParts(value: unknown, fallbackAssetId: string): { parts: PartRecord[] | undefined; changed: boolean } {
  if (!Array.isArray(value)) {
    return { parts: undefined, changed: false };
  }
  const reusableParts = reuseNormalizedRegisteredParts(value);
  if (reusableParts !== null) {
    return { parts: reusableParts, changed: false };
  }

  const parts: PartRecord[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<PartRecord>;
    if ("registeredMatches" in record) {
      changed = true;
    }
    if (
      (Array.isArray(record.meshRefs) && record.meshRefs.length > MAX_PERSISTED_REGISTERED_PART_MESH_REFS) ||
      (Array.isArray(record.materialRefs) && record.materialRefs.length > MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS) ||
      (Array.isArray(record.observations) && record.observations.length > MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS) ||
      (record.bbox !== undefined && !isNormalizedNumberTuple(record.bbox)) ||
      (record.center !== undefined && !isNormalizedNumberTuple(record.center))
    ) {
      changed = true;
    }
    const partId = typeof record.partId === "string" ? record.partId : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (!partId || !name) continue;
    const assetId = typeof record.assetId === "string" && record.assetId ? record.assetId : fallbackAssetId;
    const key = `${assetId}:${partId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const normalizedPart = {
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
      meshRefs: normalizeStringArray(record.meshRefs, MAX_PERSISTED_REGISTERED_PART_MESH_REFS),
      childCount: Number.isFinite(record.childCount) ? Math.max(0, Math.floor(Number(record.childCount))) : undefined,
      materialRefs: normalizeStringArray(record.materialRefs, MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS),
      bbox: normalizeNumberTuple(record.bbox),
      center: normalizeNumberTuple(record.center),
      triangleCount: Number.isFinite(record.triangleCount) ? Math.max(0, Math.floor(Number(record.triangleCount))) : undefined,
      vertexCount: Number.isFinite(record.vertexCount) ? Math.max(0, Math.floor(Number(record.vertexCount))) : undefined,
      materialName: typeof record.materialName === "string" ? record.materialName : null,
      sourceFormat: normalizeModelAssetFormat(record.sourceFormat),
      effectiveFormat: normalizeModelAssetFormat(record.effectiveFormat),
      loadStrategy: normalizeModelLoadStrategy(record.loadStrategy),
      confidence: Number.isFinite(record.confidence) ? Math.max(0, Math.min(1, Number(record.confidence))) : 0.5,
      observations: normalizeStringArray(record.observations, MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS),
      inferredFunctions: normalizeStringArray(record.inferredFunctions),
      knowledgeTags: normalizeStringArray(record.knowledgeTags),
      notePath: typeof record.notePath === "string" ? record.notePath : undefined,
      registeredMatches: undefined,
      reviewed: record.reviewed === true,
    };
    const compactedPart = compactRegisteredPartForPersistence(normalizedPart);
    if (!areRegisteredPartObservationsPersistedCompact(normalizedPart)) {
      changed = true;
    }
    parts.push(compactedPart);
  }

  const limitedParts = limitRegisteredParts(parts);
  if (parts.length !== value.length || limitedParts.length !== parts.length) {
    changed = true;
  }
  return {
    parts: limitedParts.length > 0 ? limitedParts : undefined,
    changed,
  };
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
    registeredMatchReviews: undefined,
    createdAt: now,
    updatedAt: now,
  };
}
