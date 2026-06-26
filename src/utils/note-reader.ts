import type { App } from "obsidian";
import { TFile } from "obsidian";
import { normalizeHeadingText } from "./heading-text";

export { normalizeHeadingText } from "./heading-text";

/** Result from searching vault headings. */
export interface HeadingSearchResult {
  notePath: string;
  heading: string;
  level: number;
}

/**
 * Search all markdown files in the vault for headings matching a query.
 * Uses metadataCache (no file reads) for fast incremental search.
 */
export function searchVaultHeadings(app: App, query: string): HeadingSearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: HeadingSearchResult[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.headings) continue;

    for (const h of cache.headings) {
      if (h.heading.toLowerCase().includes(q)) {
        results.push({ notePath: file.path, heading: h.heading, level: h.level });
      }
    }
  }

  // Limit to 15 results to keep dropdown manageable
  return results.slice(0, 15);
}

/**
 * Create a headingSearch callback for AnnotationManager.
 */
export function createHeadingSearch(app: App) {
  return (query: string) => searchVaultHeadings(app, query);
}

/**
 * Read the content under a specific heading in a note file.
 * Returns null if the heading is not found or the section is empty.
 */
export async function readHeadingSection(
  app: App,
  notePath: string,
  heading: string,
): Promise<string | null> {
  try {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return null;
    const content = await app.vault.cachedRead(file);
    const lines = content.split("\n");

    // Find the heading line (normalize for fuzzy match against formatted headings)
    let start = -1;
    let level = 0;
    const normalizedTarget = normalizeHeadingText(heading);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (m) {
        const text = m[2].trim();
        if (text === heading || normalizeHeadingText(text) === normalizedTarget) {
          start = i + 1;
          level = m[1].length;
          break;
        }
      }
    }
    if (start < 0) return null;

    // Extract until next heading of same or higher level
    const section: string[] = [];
    for (let i = start; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s/);
      if (m && m[1].length <= level) break;
      section.push(lines[i]);
    }
    return section.join("\n").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Create a noteReader callback for AnnotationManager.
 */
export function createNoteReader(app: App) {
  return (notePath: string, heading: string) =>
    readHeadingSection(app, notePath, heading);
}
