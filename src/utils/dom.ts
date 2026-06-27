/* eslint-disable obsidianmd/prefer-create-el */
/**
 * Staged element creation helpers.
 *
 * These helpers create detached elements for places such as CodeMirror widgets,
 * where Obsidian's enhanced Document.createEl/createDiv would try to append the
 * element directly to the document root.
 */

/**
 * Create an Obsidian-styled div without appending to the live DOM.
 *
 * @param cls Optional CSS class(es) to apply.
 */
export function createStagedDiv(cls?: string): HTMLDivElement {
  const el = activeDocument.createElement("div");
  if (cls) el.className = cls;
  return el;
}

/**
 * Create an Obsidian-styled element of any tag without appending to the live DOM.
 *
 * @param tag HTML tag name (e.g. "button", "input", "canvas", "span").
 * @param cls Optional CSS class(es) to apply.
 */
export function createStagedEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const el = activeDocument.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
