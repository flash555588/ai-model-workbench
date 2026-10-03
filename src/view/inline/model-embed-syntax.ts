import { isSupportedModelExtension } from "../../io/formats/registry";

export const DEFAULT_MODEL_EMBED_WIDTH = 400;
export const DEFAULT_MODEL_EMBED_HEIGHT = 300;

export function parseModelEmbedSize(value = ""): { width: number; height: number } {
  const match = value.trim().match(/^(\d+)(?:\s*[xX]\s*(\d+))?$/);
  const dimension = (raw: string | undefined, fallback: number): number => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? Math.min(number, 4096) : fallback;
  };
  const width = dimension(match?.[1], DEFAULT_MODEL_EMBED_WIDTH);
  return { width, height: dimension(match?.[2], match && !match[2] ? Math.round(width * 0.75) : DEFAULT_MODEL_EMBED_HEIGHT) };
}

export interface ModelEmbedMatch {
  from: number;
  to: number;
  path: string;
  width: number;
  height: number;
}

function isEscaped(text: string, position: number): boolean {
  let slashes = 0;
  while (position > 0 && text[--position] === "\\") slashes++;
  return slashes % 2 === 1;
}

function canCloseTicks(source: string, from: number, ticks: number): boolean {
  const paragraph = source.slice(from).split(/\n\s*\n/, 1)[0];
  const run = "`".repeat(ticks);
  for (let index = paragraph.indexOf(run); index >= 0; index = paragraph.indexOf(run, index + ticks)) {
    if (paragraph[index - 1] !== "`" && paragraph[index + ticks] !== "`" && !isEscaped(paragraph, index)) return true;
  }
  return false;
}

/** Find image-style embeds without turning fenced/inline code examples into widgets. */
export function scanModelEmbeds(source: string): ModelEmbedMatch[] {
  const matches: ModelEmbedMatch[] = [];
  let offset = 0;
  let fence = "";
  let inlineTicks = 0;
  let frontmatter = false;
  for (const line of source.split("\n")) {
    if (offset === 0 && line.trim() === "---") {
      frontmatter = true;
      offset += line.length + 1;
      continue;
    }
    if (frontmatter) {
      if (line.trim() === "---" || line.trim() === "...") frontmatter = false;
      offset += line.length + 1;
      continue;
    }
    const fenceMatch = line.match(/^\s*(?:>\s*)*(?:[-+*]\s+|\d+[.)]\s+)?(`{3,}|~{3,})(.*)$/);
    if (fenceMatch && !inlineTicks) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !fenceMatch[2].trim()) fence = "";
      offset += line.length + 1;
      continue;
    }
    if (fence || /^ {4,}[^\s>*+\-\d]/.test(line)) {
      offset += line.length + 1;
      continue;
    }
    for (let index = 0; index < line.length; index++) {
      if (line[index] === "`" && !isEscaped(line, index)) {
        let end = index + 1;
        while (line[end] === "`") end++;
        const ticks = end - index;
        if (!inlineTicks && canCloseTicks(source, offset + end, ticks)) inlineTicks = ticks;
        else if (inlineTicks === ticks) inlineTicks = 0;
        index = end - 1;
        continue;
      }
      if (inlineTicks || !line.startsWith("![[", index) || isEscaped(line, index)) continue;
      const end = line.indexOf("]]", index + 3);
      if (end < 0) continue;
      const [path, size] = line.slice(index + 3, end).split(/\\?\|/);
      const modelPath = path.trim();
      if (isSupportedModelExtension(modelPath.split(".").pop()?.toLowerCase() ?? "")) {
        matches.push({ from: offset + index, to: offset + end + 2, path: modelPath, ...parseModelEmbedSize(size) });
      }
      index = end + 1;
    }
    offset += line.length + 1;
  }
  return matches;
}
