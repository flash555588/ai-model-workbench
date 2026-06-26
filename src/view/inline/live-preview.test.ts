import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { docMayContainModelEmbed, transactionMayAffectModelEmbeds } from "./live-preview-embed-scan";

function changeDoc(doc: string, from: number, to: number, insert = "") {
  const state = EditorState.create({ doc });
  return state.update({ changes: { from, to, insert } });
}

describe("transactionMayAffectModelEmbeds", () => {
  it("quickly rejects documents without live preview embed markers", () => {
    const doc = EditorState.create({
      doc: Array.from({ length: 500 }, (_, index) => `Plain paragraph ${index}`).join("\n"),
    }).doc;

    expect(docMayContainModelEmbed(doc)).toBe(false);
  });

  it("detects live preview embed markers before line parsing", () => {
    const doc = EditorState.create({
      doc: "Intro\n![[models/cube.glb]]\nMore text",
    }).doc;

    expect(docMayContainModelEmbed(doc)).toBe(true);
  });

  it("ignores ordinary text edits away from model embeds", () => {
    const doc = [
      "Intro paragraph",
      "Plain text that changes often",
      "![[models/cube.glb]]",
    ].join("\n");

    const tr = changeDoc(doc, 0, 0, "Draft ");

    expect(transactionMayAffectModelEmbeds(tr)).toBe(false);
  });

  it("detects inserted model embeds", () => {
    const doc = "Intro paragraph\nPlain text";
    const tr = changeDoc(doc, doc.length, doc.length, "\n![[models/cube.glb]]");

    expect(transactionMayAffectModelEmbeds(tr)).toBe(true);
  });

  it("detects edits on existing model embed lines", () => {
    const doc = "Intro paragraph\n![[models/cube.glb]]\nMore text";
    const from = doc.indexOf("cube");
    const tr = changeDoc(doc, from, from + "cube".length, "gear");

    expect(transactionMayAffectModelEmbeds(tr)).toBe(true);
  });

  it("detects deleted model embeds", () => {
    const doc = "Intro paragraph\n![[models/cube.glb]]\nMore text";
    const from = doc.indexOf("![[");
    const to = from + "![[models/cube.glb]]".length;
    const tr = changeDoc(doc, from, to);

    expect(transactionMayAffectModelEmbeds(tr)).toBe(true);
  });
});
