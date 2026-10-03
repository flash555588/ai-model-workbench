import { describe, expect, it } from "vitest";
import { parseModelEmbedSize, scanModelEmbeds } from "./model-embed-syntax";

describe("image-style model embeds", () => {
  it("finds multiple models within a paragraph without replacing surrounding text", () => {
    const source = "之前 ![[模型.glb|240x160]] 之间 ![[part.stl|180]] 之后";
    const embeds = scanModelEmbeds(source);
    expect(embeds.map(({ path, width, height }) => ({ path, width, height }))).toEqual([
      { path: "模型.glb", width: 240, height: 160 }, { path: "part.stl", width: 180, height: 135 },
    ]);
    expect(embeds.map(embed => source.slice(embed.from, embed.to))).toEqual(["![[模型.glb|240x160]]", "![[part.stl|180]]"]);
  });

  it("supports lists, quoted callouts, and escaped size separators in tables", () => {
    const source = "- ![[a.glb|200x140]]\n  - ![[b.obj|180x120]]\n> ![[c.ply|220x140]]\n| 左 | ![[d.glb\\|160x100]] |";
    expect(scanModelEmbeds(source).map(embed => [embed.path, embed.width, embed.height])).toEqual([
      ["a.glb", 200, 140], ["b.obj", 180, 120], ["c.ply", 220, 140], ["d.glb", 160, 100],
    ]);
  });

  it("leaves code examples, escaped embeds, and ordinary images untouched", () => {
    const source = "`![[inline.glb]]`\n```md\n![[fenced.glb]]\n```\n> ~~~md\n> ![[quote.glb]]\n> ~~~\n    ![[indented.glb]]\n\\![[escaped.glb]]\n![[image.png]]\n![[real.glb]]";
    expect(scanModelEmbeds(source).map(embed => embed.path)).toEqual(["real.glb"]);
  });

  it("uses the matching backtick run and handles an escaped backslash", () => {
    expect(scanModelEmbeds("`` ` ![[code.glb]] `` \\\\![[real.glb]]").map(embed => embed.path)).toEqual(["real.glb"]);
  });

  it("bounds dimensions and retains defaults for invalid sizes", () => {
    expect(parseModelEmbedSize("0x0")).toEqual({ width: 400, height: 300 });
    expect(parseModelEmbedSize("999999x999999")).toEqual({ width: 4096, height: 4096 });
    expect(parseModelEmbedSize("240 X 160")).toEqual({ width: 240, height: 160 });
    expect(parseModelEmbedSize("title")).toEqual({ width: 400, height: 300 });
  });

  it("treats unmatched backticks as text and leaves note properties alone", () => {
    const source = "---\nmodel: '![[property.glb]]'\n---\n文字 ` ![[real.glb]]";
    expect(scanModelEmbeds(source).map(embed => embed.path)).toEqual(["real.glb"]);
  });
});
