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
  if ((!summary.performanceTier || summary.performanceTier === "light") && !summary.resourceWarnings?.length) {
    return null;
  }

  const tier = summary.performanceTier ?? "light";
  const count = (summary.splatCount ?? summary.triangleCount).toLocaleString();
  const unit = summary.splatCount !== undefined ? "splats" : "triangles";
  const shell = host.createDiv({ cls: `ai3d-performance-feedback is-${tier}` });
  shell.createDiv({
    cls: "ai3d-performance-feedback-tier",
    text: summary.resourceWarnings?.length ? "assets" : summary.performanceTier ?? "light",
  });
  shell.createDiv({
    cls: "ai3d-performance-feedback-meta",
    text: summary.resourceWarnings?.length
      ? summary.resourceWarnings[0]
      : `${count} ${unit} · ${summary.materialCount.toLocaleString()} materials`,
  });
  window.setTimeout(() => shell.classList.add("is-subtle"), 4200);
  return shell;
}
