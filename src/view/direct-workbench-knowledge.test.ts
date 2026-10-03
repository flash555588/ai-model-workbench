import { describe, expect, it } from "vitest";
import type { KnowledgeGenerationRecord } from "../domain/models";
import { getDirectKnowledgeState } from "./direct-workbench-knowledge";

const record: KnowledgeGenerationRecord = {
  modelPath: "model.glb", status: "pending", generatedAt: "2026-10-02", partNoteCount: 0, previewImageCount: 0, warningCount: 0,
};
const defaults: Parameters<typeof getDirectKnowledgeState>[0] = {
  modelPath: "model.glb", profile: { tags: [], notes: "", annotations: [], createdAt: "2026-10-02", updatedAt: "2026-10-02" }, record: null, progress: null, starting: false,
};

describe("direct knowledge action state", () => {
  it("allows retry of a persisted pending record without live progress", () => {
    expect(getDirectKnowledgeState({ ...defaults, record })).toMatchObject({ status: "interrupted", primary: "generate-note", generateDisabled: false });
  });
  it("uses runtime progress instead of a stale success or failure", () => {
    expect(getDirectKnowledgeState({ ...defaults, record: { ...record, status: "failed" }, progress: { modelPath: "model.glb", phase: "write" } })).toMatchObject({ status: "generating", generateDisabled: true });
  });
  it("keeps another model's generation status out of this view while preventing concurrent generation", () => {
    expect(getDirectKnowledgeState({ ...defaults, record: { ...record, modelPath: "other.glb", status: "failed" }, progress: { modelPath: "other.glb", phase: "parts" } })).toMatchObject({ status: "empty", generateDisabled: true });
  });
  it("promotes the saved index and preserves the existing report during a failed update", () => {
    const profile = { ...defaults.profile!, reportNotePath: "report.md", knowledgeIndexPath: "index.md" };
    expect(getDirectKnowledgeState({ ...defaults, profile })).toMatchObject({ status: "ready", primary: "open-index" });
    expect(getDirectKnowledgeState({ ...defaults, profile, record: { ...record, status: "failed" } })).toMatchObject({ status: "failed", primary: "generate-note", generateDisabled: false });
  });
});
