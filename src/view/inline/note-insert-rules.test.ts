import { describe, expect, it } from "vitest";
import { createNoteModelInsertion, getNoteInsertDimensions, resolveNoteInsertContext } from "./note-insert-rules";
import { scanModelEmbeds } from "./model-embed-syntax";

describe("note insertion rules", () => {
  it("chooses defaults for a blank line, inline text and a table without treating prose pipes as a table", () => {
    const blank = resolveNoteInsertContext("", 0);
    expect(blank.allowParts).toBe(true);
    expect(getNoteInsertDimensions(blank)).toEqual({ width: 400, height: 300 });
    const text = resolveNoteInsertContext("前文 后文", 3);
    expect(text.placement).toBe("inline"); expect(text.allowParts).toBe(false);
    expect(getNoteInsertDimensions(text)).toEqual({ width: 240, height: 180 });
    const source = "| 位置 | 模型 |\n| --- | --- |\n| 图 |  |";
    const table = resolveNoteInsertContext(source, source.lastIndexOf(" |"));
    expect(table.placement).toBe("table");
    expect(getNoteInsertDimensions(table)).toEqual({ width: 160, height: 120 });
    expect(resolveNoteInsertContext("文字 A | B", 7).placement).toBe("inline");
    expect(resolveNoteInsertContext("\n下一行", 0).placement).toBe("block");
  });
  it("escapes the size separator in table cells and produces a renderable sized embed", () => {
    const source = "> | 名称 | 模型 |\n> | --- | --- |\n> | 展示 |  |";
    const from = source.lastIndexOf(" |");
    const insertion = createNoteModelInsertion("模型/装配.glb", resolveNoteInsertContext(source, from));
    expect(insertion).toBe("![[模型/装配.glb\\|160x120]]");
    const updated = source.slice(0, from) + insertion + source.slice(from);
    expect(scanModelEmbeds(updated)[0]).toMatchObject({ path: "模型/装配.glb", width: 160, height: 120 });
  });
  it("rejects code, properties, divider rows and table selections spanning rows", () => {
    for (const [source, marker] of [["```md\nHERE\n```", "HERE"], ["前文 `HERE` 后文", "HERE"], ["---\ntitle: HERE\n---\n正文", "HERE"], ["    HERE", "HERE"]]) {
      const context = resolveNoteInsertContext(source, source.indexOf(marker));
      expect(context.allowed).toBe(false);
      expect(() => createNoteModelInsertion("a.glb", context)).toThrow("invalid-insert-location");
    }
    const source = "| A | B |\n| --- | --- |\n| C | D |";
    expect(resolveNoteInsertContext(source, source.indexOf("---")).allowed).toBe(false);
    expect(resolveNoteInsertContext(source, 2, source.length - 2).allowed).toBe(false);
  });
  it("generates a persistent parts block and preserves quote/list indentation on every line", () => {
    for (const prefix of ["", "> ", "- ", "> 1. "]) {
      const context = resolveNoteInsertContext(prefix, prefix.length);
      const insertion = createNoteModelInsertion("模型/a.glb", context, "parts", "large");
      expect(context.allowParts).toBe(true);
      const lines = insertion.split("\n");
      expect(lines.slice(1).every(line => line.startsWith(context.continuationPrefix))).toBe(true);
      const json = lines.slice(1, -2).map(line => line.slice(context.continuationPrefix.length)).join("\n");
      expect(JSON.parse(json)).toEqual({ models: [{ path: "模型/a.glb" }], width: 640, height: 480, parts: true });
    }
  });
  it("keeps inline placements inline and lets a full-line selection become a parts block", () => {
    const text = "前文 后文";
    const context = resolveNoteInsertContext(text, 3);
    expect(() => createNoteModelInsertion("a.glb", context, "parts")).toThrow();
    expect(createNoteModelInsertion("a.glb", context, "model", "small")).toBe("![[a.glb|220x165]]");
    expect(resolveNoteInsertContext("待替换文字", 0, 6).allowParts).toBe(true);
    expect(resolveNoteInsertContext("> ", 0).allowParts).toBe(false);
  });
  it("rejects file names that would change the wikilink target instead of inserting a broken link", () => {
    const context = resolveNoteInsertContext("", 0);
    for (const path of ["a#b.glb", "a^b.glb", "a|b.glb", "a]]b.glb", "a\nb.glb"]) expect(() => createNoteModelInsertion(path, context)).toThrow("unsupported-embed-path");
  });
});
