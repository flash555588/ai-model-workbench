import { describe, expect, it } from "vitest";
import type { PartRecord, ThreeDBlockConfig } from "../../domain/models";
import { createNotePartsMarkdown, parseNotePartPresentation, resolveNotePartSelection } from "./note-parts-config";

const part = (partId: string, name: string): PartRecord => ({ partId, name, assetId: "model", meshRefs: [], materialRefs: [], confidence: 1, reviewed: false, observations: [], inferredFunctions: [], knowledgeTags: [] });
describe("note part presentation", () => {
  it("parses a catalog shorthand and preserves explicit assembly/single-part choices", () => {
    expect(parseNotePartPresentation(true)).toEqual({ display: "registered" });
    expect(parseNotePartPresentation(false)).toBeUndefined();
    expect(parseNotePartPresentation(undefined)).toBeUndefined();
    expect(parseNotePartPresentation({ part: " shell ", separation: 0, showUnregistered: true })).toEqual({ display: "registered", part: "shell", separation: 0, showUnregistered: true });
  });
  it("rejects invalid display modes, part identities, separation and visibility instead of guessing", () => {
    for (const value of [null, "registered", [], { display: "similar" }, { part: " " }, { part: 1 }, { separation: -1 }, { separation: 101 }, { separation: NaN }, { separation: "50" }, { showUnregistered: "true" }]) expect(() => parseNotePartPresentation(value)).toThrow();
  });
  it("uses exact part IDs before names and rejects duplicate names or IDs", () => {
    const parts = [part("first", "bolt"), part("bolt", "shell"), part("second", "bolt")];
    expect(resolveNotePartSelection(parts)).toEqual({ status: "all", partId: null });
    expect(resolveNotePartSelection(parts, "bolt")).toEqual({ status: "matched", partId: "bolt" });
    expect(resolveNotePartSelection(parts, "shell")).toEqual({ status: "matched", partId: "bolt" });
    expect(resolveNotePartSelection(parts.filter(row => row.partId !== "bolt"), "bolt").status).toBe("ambiguous");
    expect(resolveNotePartSelection([part("one", "a"), part("one", "b")], "one").status).toBe("ambiguous");
    expect(resolveNotePartSelection(parts, "Shell").status).toBe("missing");
  });
  it("copies a round-trippable block without losing camera, dimensions or model appearance", () => {
    const original: ThreeDBlockConfig = { models: [{ path: "old.glb", color: "#ff0000" }], height: 260, width: "100%", camera: { position: [1, 2, 3], lookAt: [0, 0, 0] }, scene: { autoRotate: false } };
    const presentation = { display: "registered", part: "part-2", separation: 40, showUnregistered: false } as const;
    const markdown = createNotePartsMarkdown("models/new.glb", presentation, original);
    const parsed = JSON.parse(markdown.split("\n").slice(1, -1).join("\n")) as ThreeDBlockConfig;
    expect(parsed).toEqual({ ...original, models: [{ path: "models/new.glb", color: "#ff0000" }], parts: presentation });
    expect(parseNotePartPresentation(parsed.parts)).toEqual(presentation);
    expect(original.models[0].path).toBe("old.glb");
  });
});
