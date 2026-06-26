/**
 * Normalize heading text by stripping common markdown formatting.
 * Used for fuzzy matching between DOM textContent and raw markdown headings.
 */
export function normalizeHeadingText(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
