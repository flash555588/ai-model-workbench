import type { NotePartPresentation, PartRecord, ThreeDBlockConfig } from "../../domain/models";

export interface NotePartsAccess {
  getParts(modelPath: string): readonly PartRecord[];
  subscribe(listener: () => void): () => void;
}

export function parseNotePartPresentation(raw: unknown): NotePartPresentation | undefined {
  if (raw === undefined || raw === false) return undefined;
  if (raw === true) return { display: "registered" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("parts must be true or an object.");
  const value = raw as Record<string, unknown>;
  if (value.display !== undefined && value.display !== "registered") throw new Error("parts.display must be registered.");
  if (value.part !== undefined && (typeof value.part !== "string" || !value.part.trim())) throw new Error("parts.part must be a non-empty registered part ID or name.");
  if (value.separation !== undefined && (typeof value.separation !== "number" || !Number.isFinite(value.separation) || value.separation < 0 || value.separation > 100)) throw new Error("parts.separation must be between 0 and 100.");
  if (value.showUnregistered !== undefined && typeof value.showUnregistered !== "boolean") throw new Error("parts.showUnregistered must be boolean.");
  return { display: "registered", part: typeof value.part === "string" ? value.part.trim() : undefined,
    separation: value.separation, showUnregistered: value.showUnregistered };
}

export function resolveNotePartSelection(parts: readonly PartRecord[], request?: string): { partId: string | null; status: "all" | "matched" | "missing" | "ambiguous" } {
  if (!request) return { partId: null, status: "all" };
  const ids = parts.filter(part => part.partId === request);
  const matches = ids.length ? ids : parts.filter(part => part.name === request);
  return matches.length === 1 ? { partId: matches[0].partId, status: "matched" }
    : { partId: null, status: matches.length ? "ambiguous" : "missing" };
}

/** Serialize a copyable code block without changing the note document. */
export function createNotePartsMarkdown(modelPath: string, parts: NotePartPresentation, original?: ThreeDBlockConfig): string {
  const config: ThreeDBlockConfig = { ...original, models: [{ ...original?.models[0], path: modelPath }], parts };
  return `\`\`\`3d\n${JSON.stringify(config, null, 2)}\n\`\`\``;
}
