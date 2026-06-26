import type { Text, Transaction } from "@codemirror/state";

export const LIVE_PREVIEW_EMBED_MARKER = "![[";

function lineMayContainModelEmbed(text: string): boolean {
  return text.includes(LIVE_PREVIEW_EMBED_MARKER);
}

export function docMayContainModelEmbed(doc: Text): boolean {
  let previousTail = "";
  for (const chunk of doc.iter()) {
    if (!chunk) continue;
    const candidate = previousTail ? previousTail + chunk : chunk;
    if (candidate.includes(LIVE_PREVIEW_EMBED_MARKER)) {
      return true;
    }
    previousTail = candidate.slice(-(LIVE_PREVIEW_EMBED_MARKER.length - 1));
  }
  return false;
}

function clampDocPosition(doc: Text, position: number): number {
  return Math.max(0, Math.min(position, doc.length));
}

function docLineRangeMayContainModelEmbed(doc: Text, from: number, to: number): boolean {
  if (doc.length === 0) {
    return false;
  }

  const startLine = doc.lineAt(clampDocPosition(doc, from));
  const endLine = doc.lineAt(clampDocPosition(doc, to));
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    if (lineMayContainModelEmbed(doc.line(lineNumber).text)) {
      return true;
    }
  }
  return false;
}

export function transactionMayAffectModelEmbeds(tr: Transaction): boolean {
  if (!tr.docChanged) {
    return false;
  }

  let mayAffect = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (mayAffect) return;
    mayAffect =
      docLineRangeMayContainModelEmbed(tr.startState.doc, fromA, toA) ||
      docLineRangeMayContainModelEmbed(tr.state.doc, fromB, toB);
  });
  return mayAffect;
}
