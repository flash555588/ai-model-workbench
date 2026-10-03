/** Runtime-only progress: a persisted pending record must never block a retry after restart. */
export type KnowledgeGenerationPhase = "capture" | "paths" | "analysis" | "parts" | "remote" | "write" | "index";

export interface KnowledgeGenerationProgress {
  modelPath: string;
  phase: KnowledgeGenerationPhase;
}

const progress = new WeakMap<object, KnowledgeGenerationProgress>();
const observers = new WeakMap<object, Set<() => void>>();

function notify(owner: object): void {
  for (const listener of [...(observers.get(owner) ?? [])]) {
    try {
      listener();
    } catch (error) {
      console.warn("[AI3D] Knowledge progress observer failed:", error);
    }
  }
}

export function getKnowledgeGenerationProgress(owner: object): KnowledgeGenerationProgress | null {
  return progress.get(owner) ?? null;
}

export function subscribeKnowledgeGenerationProgress(owner: object, listener: () => void): () => void {
  const listeners = observers.get(owner) ?? new Set<() => void>();
  observers.set(owner, listeners);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function beginKnowledgeGenerationProgress(owner: object, modelPath: string): {
  setPhase: (phase: KnowledgeGenerationPhase) => void;
  finish: () => void;
} {
  const current: KnowledgeGenerationProgress = { modelPath, phase: "capture" };
  progress.set(owner, current);
  notify(owner);
  return {
    setPhase(phase) {
      if (progress.get(owner) !== current) return;
      current.phase = phase;
      notify(owner);
    },
    finish() {
      if (progress.get(owner) !== current) return;
      progress.delete(owner);
      notify(owner);
    },
  };
}
