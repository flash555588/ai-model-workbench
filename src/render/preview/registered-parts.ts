import type { ModelPartSummary, PartRecord } from "../../domain/models";
import { getPreviewBoundsCenter, getPreviewBoundsMaxSpan, mergePreviewBounds, type PreviewBounds } from "./bounds";
import type { PreviewWorldPoint } from "./types";

export type RegisteredPartStatus = "matched" | "partial" | "missing" | "ambiguous";
export interface RegisteredPartRow {
  part: PartRecord;
  status: RegisteredPartStatus;
  meshKeys: readonly string[];
}
export interface RegisteredPartCandidate {
  identity: Pick<ModelPartSummary, "componentPath" | "occurrenceId" | "componentId">;
  meshKeys: readonly string[];
}
export interface RegisteredPartGeometry {
  key: string;
  names: readonly string[];
  bounds: PreviewBounds;
  visible: boolean;
  /** Set a world-space offset from the captured pose, never an incremental move. */
  setOffset(this: void, offset: PreviewWorldPoint): void;
  setVisible(this: void, visible: boolean): void;
  restore(this: void): void;
}
export interface RegisteredPartDisplay {
  readonly rows: readonly RegisteredPartRow[];
  readonly unregisteredMeshCount: number;
  setSpread(amount: number): void;
  isolate(partId: string | null): void;
  setVisible(partId: string, visible: boolean): void;
  setAllVisible(visible: boolean): void;
  showUnregistered(visible: boolean): void;
  reset(): void;
  dispose(): void;
}

/** Resolve only this asset's exact identities/references; never similarity matches. */
export function resolveRegisteredParts(
  parts: readonly PartRecord[], geometries: readonly Pick<RegisteredPartGeometry, "key" | "names">[],
  candidates: readonly RegisteredPartCandidate[],
): RegisteredPartRow[] {
  const names = new Map<string, Set<string>>();
  for (const geometry of geometries) for (const name of geometry.names) {
    const keys = names.get(name) ?? new Set<string>();
    keys.add(geometry.key);
    names.set(name, keys);
  }
  const rows = parts.map((part): RegisteredPartRow => {
    // A stored occurrence or path is authoritative. Stale identities must not fall
    // back to another identically named occurrence elsewhere in the model.
    let structural = candidates.filter(candidate => {
      // Babylon's generated GLTF root is absent from Three's component paths.
      // Normalize only that import wrapper, preserving meaningful path segments.
      const path = (value?: string) => value?.replace(/^__root__\//, "");
      if (part.componentPath && path(candidate.identity.componentPath) !== path(part.componentPath)) return false;
      if (part.occurrenceId && candidate.identity.occurrenceId !== part.occurrenceId) return false;
      if (part.componentId && candidate.identity.componentId !== part.componentId) return false;
      return !!(part.componentPath || part.occurrenceId || part.componentId);
    });
    // A group and its only mesh can expose the same explicit identity.
    structural = structural.filter((candidate, index, all) => all.findIndex(other =>
      [...other.meshKeys].sort().join("\0") === [...candidate.meshKeys].sort().join("\0")) === index);
    if (structural.length > 1) return { part, status: "ambiguous", meshKeys: [] };
    if ((part.componentPath || part.occurrenceId || part.componentId) && !structural.length) return { part, status: "missing", meshKeys: [] };
    const scope = structural[0] ? new Set(structural[0].meshKeys) : null;
    const matched = new Set<string>();
    let missing = 0;
    for (const name of new Set(part.meshRefs)) {
      const keys = [...(names.get(name) ?? [])].filter(key => !scope || scope.has(key));
      if (keys.length > 1) {
        if (!scope || part.childCount !== scope.size) return { part, status: "ambiguous", meshKeys: [] };
        for (const key of keys) matched.add(key);
        continue;
      }
      if (keys.length === 1) matched.add(keys[0]); else missing++;
    }
    // Persisted mesh references may be capped. An exact unique group identity
    // supplies the rest only when its geometry count agrees with registration.
    if (scope && !missing && part.childCount === scope.size && matched.size < scope.size) {
      for (const key of scope) matched.add(key);
    }
    if (!part.meshRefs.length && scope) for (const key of scope) matched.add(key);
    const partial = missing > 0 || (part.childCount !== undefined && matched.size < part.childCount);
    return { part, status: !matched.size ? "missing" : partial ? "partial" : "matched", meshKeys: [...matched] };
  });
  const owners = new Map<string, number>();
  for (const row of rows) for (const key of row.meshKeys) owners.set(key, (owners.get(key) ?? 0) + 1);
  const ids = new Map<string, number>();
  for (const row of rows) ids.set(row.part.partId, (ids.get(row.part.partId) ?? 0) + 1);
  return rows.map(row => {
    const duplicateId = (ids.get(row.part.partId) ?? 0) > 1;
    return duplicateId || row.meshKeys.some(key => (owners.get(key) ?? 0) > 1)
      ? { ...row, status: "ambiguous", meshKeys: [] } : row;
  });
}

export function createRegisteredPartDisplay(
  parts: readonly PartRecord[], geometries: readonly RegisteredPartGeometry[],
  candidates: readonly RegisteredPartCandidate[], changed: () => void,
  fit: (bounds: PreviewBounds) => void, released: () => void,
): RegisteredPartDisplay {
  const rows = resolveRegisteredParts(parts, geometries, candidates);
  const byKey = new Map(geometries.map(geometry => [geometry.key, geometry]));
  const owned = new Set(rows.flatMap(row => [...row.meshKeys]));
  const unregistered = geometries.filter(geometry => !owned.has(geometry.key));
  const groups = rows.filter(row => row.meshKeys.length).map(row => {
    const bounds = row.meshKeys.reduce<PreviewBounds | null>((merged, key) => mergePreviewBounds(merged, byKey.get(key)!.bounds), null)!;
    return { row, bounds };
  });
  // A catalog grid also separates concentric/coincident parts without making
  // many parts unreadably small in a single long row.
  const gap = Math.max(0.001, ...geometries.map(geometry => getPreviewBoundsMaxSpan(geometry.bounds))) * 0.35;
  const cellWidth = Math.max(0.001, ...groups.map(group => group.bounds.max.x - group.bounds.min.x)) + gap;
  const cellHeight = Math.max(0.001, ...groups.map(group => group.bounds.max.y - group.bounds.min.y)) + gap;
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const rowCount = Math.ceil(groups.length / columns);
  const offsets = new Map<string, PreviewWorldPoint>();
  groups.forEach(({ row, bounds }, index) => {
    const center = getPreviewBoundsCenter(bounds);
    offsets.set(row.part.partId, {
      x: (index % columns - (columns - 1) / 2) * cellWidth - center.x,
      y: ((rowCount - 1) / 2 - Math.floor(index / columns)) * cellHeight - center.y,
      z: -center.z,
    });
  });
  let spread = 1;
  let isolated: string | null = null;
  let showOther = false;
  let disposed = false;
  const hidden = new Set<string>();
  const update = (refit: boolean): void => {
    if (disposed) return;
    const ownersByKey = new Map(rows.flatMap(row => row.meshKeys.map(key => [key, row.part.partId] as const)));
    let visibleBounds: PreviewBounds | null = null;
    // Adapters must supply ancestors before descendants: translating a child
    // compensates for any change to its renderable parent in world space.
    for (const geometry of geometries) {
      const owner = ownersByKey.get(geometry.key);
      const base = owner ? offsets.get(owner) : null;
      const offset = { x: (base?.x ?? 0) * spread, y: (base?.y ?? 0) * spread, z: (base?.z ?? 0) * spread };
      const visible = geometry.visible && (owner ? !hidden.has(owner) && (!isolated || isolated === owner) : showOther && !isolated);
      if (spread === 0) geometry.restore(); else geometry.setOffset(offset);
      geometry.setVisible(visible);
      if (visible) visibleBounds = mergePreviewBounds(visibleBounds, {
        min: { x: geometry.bounds.min.x + offset.x, y: geometry.bounds.min.y + offset.y, z: geometry.bounds.min.z + offset.z },
        max: { x: geometry.bounds.max.x + offset.x, y: geometry.bounds.max.y + offset.y, z: geometry.bounds.max.z + offset.z },
      });
    }
    changed();
    if (refit && visibleBounds) fit(visibleBounds);
  };
  return {
    rows, unregisteredMeshCount: unregistered.length,
    setSpread(value) { if (!Number.isFinite(value)) return; spread = Math.max(0, Math.min(1, value)); update(true); },
    isolate(id) { if (id && !groups.some(group => group.row.part.partId === id)) return; isolated = id; if (id) hidden.delete(id); update(true); },
    setVisible(id, visible) { if (visible) hidden.delete(id); else hidden.add(id); update(false); },
    setAllVisible(visible) { hidden.clear(); if (!visible) for (const { row } of groups) hidden.add(row.part.partId); update(false); },
    showUnregistered(visible) { showOther = visible; update(true); },
    reset() { spread = 0; isolated = null; showOther = true; hidden.clear(); update(true); },
    dispose() { if (disposed) return; disposed = true; for (const geometry of geometries) geometry.restore(); changed(); released(); },
  };
}
