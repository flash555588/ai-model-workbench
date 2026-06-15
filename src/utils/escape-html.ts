/**
 * Escape HTML special characters so untrusted strings can be safely embedded
 * in generated Markdown/notes. This prevents malicious model names, remote
 * draft output, or metadata from being interpreted as HTML/JS in Obsidian's
 * preview.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
