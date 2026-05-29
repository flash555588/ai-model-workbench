import type { ModelLoadFailureDetails } from "../io/conversion/errors";
import type { ModelPreviewSummary } from "../domain/models";
import { isMobile } from "../utils/device";

export function renderModelLoadFailure(host: HTMLElement, failure: ModelLoadFailureDetails): HTMLDivElement {
  const shell = host.createDiv({ cls: "ai3d-inline-empty ai3d-load-feedback-shell" });
  if (isMobile()) {
    shell.classList.add("is-mobile");
  }
  const block = shell.createDiv({ cls: `ai3d-load-feedback is-${failure.level}` });
  block.createDiv({ cls: "ai3d-load-feedback-title", text: failure.title });
  block.createDiv({ cls: "ai3d-load-feedback-message", text: failure.message });
  block.createDiv({ cls: "ai3d-load-feedback-hint", text: failure.hint });
  return shell;
}

export function renderModelPerformanceFeedback(host: HTMLElement, summary: ModelPreviewSummary): HTMLDivElement | null {
  if (!summary.performanceTier || summary.performanceTier === "light") {
    return null;
  }

  const count = (summary.splatCount ?? summary.triangleCount).toLocaleString();
  const unit = summary.splatCount !== undefined ? "splats" : "triangles";
  const shell = host.createDiv({ cls: `ai3d-performance-feedback is-${summary.performanceTier}` });
  shell.createDiv({ cls: "ai3d-performance-feedback-tier", text: summary.performanceTier });
  shell.createDiv({
    cls: "ai3d-performance-feedback-meta",
    text: `${count} ${unit} · ${summary.materialCount.toLocaleString()} materials`,
  });
  if (summary.performanceHint) {
    shell.title = summary.performanceHint;
  }
  window.setTimeout(() => shell.classList.add("is-subtle"), 4200);
  return shell;
}
