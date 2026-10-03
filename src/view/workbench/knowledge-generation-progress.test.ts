import { describe, expect, it, vi } from "vitest";
import { beginKnowledgeGenerationProgress, getKnowledgeGenerationProgress, subscribeKnowledgeGenerationProgress } from "./knowledge-generation-progress";

describe("knowledge generation progress ownership", () => {
  it("does not let a late finish or phase from an older run replace the newer run", () => {
    const owner = {};
    const earlier = beginKnowledgeGenerationProgress(owner, "old.glb");
    const later = beginKnowledgeGenerationProgress(owner, "new.glb");
    earlier.finish();
    earlier.setPhase("index");
    expect(getKnowledgeGenerationProgress(owner)).toEqual({ modelPath: "new.glb", phase: "capture" });
    later.setPhase("write");
    expect(getKnowledgeGenerationProgress(owner)?.phase).toBe("write");
    later.finish();
    expect(getKnowledgeGenerationProgress(owner)).toBeNull();
  });

  it("isolates owners and releases view subscriptions", () => {
    const owner = {};
    const other = {};
    const listener = vi.fn();
    const unsubscribe = subscribeKnowledgeGenerationProgress(owner, listener);
    const run = beginKnowledgeGenerationProgress(owner, "model.glb");
    beginKnowledgeGenerationProgress(other, "other.glb");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    run.finish();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps observer exceptions out of the generation pipeline", () => {
    const owner = {};
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    subscribeKnowledgeGenerationProgress(owner, () => { throw new Error("closed view"); });
    try {
      const run = beginKnowledgeGenerationProgress(owner, "model.glb");
      expect(() => run.setPhase("index")).not.toThrow();
      expect(() => run.finish()).not.toThrow();
      expect(getKnowledgeGenerationProgress(owner)).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
