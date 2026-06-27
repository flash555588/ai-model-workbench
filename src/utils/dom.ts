/**
 * Staged element creation helpers.
 *
 * These helpers create detached elements for places such as CodeMirror widgets,
 * where Obsidian's enhanced Document.createEl/createDiv would try to append the
 * element directly to the document root.
 */

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function getCurrentDocument(): Document {
  return typeof activeDocument === "undefined" ? window.document : activeDocument;
}

function createDetachedElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return getCurrentDocument().createElementNS(HTML_NAMESPACE, tag) as HTMLElementTagNameMap[K];
}

/**
 * Create an Obsidian-styled div without appending to the live DOM.
 *
 * @param cls Optional CSS class(es) to apply.
 */
export function createStagedDiv(cls?: string): HTMLDivElement {
  const el = createDetachedElement("div");
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
  const el = createDetachedElement(tag);
  if (cls) el.className = cls;
  return el;
}
