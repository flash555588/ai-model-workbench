import { scanModelEmbeds } from "./model-embed-syntax";

export type NoteInsertSize = "auto" | "small" | "medium" | "large";
export type NoteInsertMode = "model" | "parts";
export interface NoteInsertContext {
  placement: "block" | "inline" | "table";
  allowed: boolean;
  allowParts: boolean;
  continuationPrefix: string;
}

const tableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const stripQuote = (line: string): string => line.replace(/^\s*(?:>\s*)+/, "");
const hasPipe = (line: string): boolean => /(^|[^\\])\|/.test(line);

/** Reuse the embed scanner so generated embeds obey the same code/example rules. */
export function resolveNoteInsertContext(source: string, from: number, to = from): NoteInsertContext {
  const probe = "![[__ai3d_insert_probe__.glb|1x1]]";
  const allowedEmbed = scanModelEmbeds(source.slice(0, from) + probe + source.slice(to)).some(embed => embed.from === from && embed.path === "__ai3d_insert_probe__.glb");
  const lineStart = from === 0 ? 0 : source.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = source.indexOf("\n", to);
  const before = source.slice(lineStart, from);
  const after = source.slice(to, lineEnd < 0 ? source.length : lineEnd);
  const lines = source.split("\n");
  const index = source.slice(0, from).split("\n").length - 1;
  let table = false;
  if (hasPipe(stripQuote(lines[index] ?? ""))) {
    for (const step of [-1, 1]) {
      for (let row = index; row >= 0 && row < lines.length && hasPipe(stripQuote(lines[row])); row += step) {
        if (tableSeparator.test(stripQuote(lines[row]))) { table = true; break; }
      }
    }
  }
  const prefix = before.match(/^([ \t]*(?:>[ \t]*)*)([ \t]*)(?:(?:[-+*]|\d+[.)])([ \t]+))?$/);
  const block = !!prefix && !after.trim() && !table;
  const quote = prefix?.[1] ?? "";
  const remainder = prefix ? before.slice(quote.length) : "";
  const continuationPrefix = quote + (prefix?.[3] ? " ".repeat(remainder.length) : prefix?.[2] ?? "");
  const crossesTableRow = table && source.slice(from, to).includes("\n");
  const allowed = allowedEmbed && !crossesTableRow && !(table && tableSeparator.test(stripQuote(lines[index])));
  return { placement: table ? "table" : block ? "block" : "inline", allowed, allowParts: allowed && block, continuationPrefix };
}

export function getNoteInsertDimensions(context: NoteInsertContext, size: NoteInsertSize = "auto"): { width: number; height: number } {
  if (size === "small") return { width: 220, height: 165 };
  if (size === "medium") return { width: 400, height: 300 };
  if (size === "large") return { width: 640, height: 480 };
  return context.placement === "table" ? { width: 160, height: 120 }
    : context.placement === "inline" ? { width: 240, height: 180 } : { width: 400, height: 300 };
}

/** Produce a single undoable editor insertion; never rebuild the note document. */
export function createNoteModelInsertion(modelPath: string, context: NoteInsertContext, mode: NoteInsertMode = "model", size: NoteInsertSize = "auto"): string {
  if (!context.allowed || (mode === "parts" && !context.allowParts)) throw new Error("invalid-insert-location");
  const { width, height } = getNoteInsertDimensions(context, size);
  if (mode === "parts") {
    const config = { models: [{ path: modelPath }], width, height, parts: true };
    return ["```3d", JSON.stringify(config, null, 2), "```", ""].join("\n").split("\n").join(`\n${context.continuationPrefix}`);
  }
  if (/[\r\n|#^]|\]\]/.test(modelPath)) throw new Error("unsupported-embed-path");
  return `![[${modelPath}${context.placement === "table" ? "\\|" : "|"}${width}x${height}]]`;
}
