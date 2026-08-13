import type { RegisteredPartMatch } from "../domain/models";
import { formatT, t } from "../i18n";

function formatSourceModelLabel(path: string | undefined): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function renderRegisteredPartMatchRow(parent: HTMLElement, partName: string, match: RegisteredPartMatch): HTMLDivElement {
  const row = parent.createDiv({ cls: "ai3d-direct-workbench-match" });
  const main = row.createDiv({ cls: "ai3d-direct-workbench-match-main" });
  main.createDiv({ cls: "ai3d-direct-workbench-match-title", text: partName });
  main.createDiv({
    cls: "ai3d-direct-workbench-match-source",
    text: match.sourcePartName || match.sourcePartId,
  });
  if (match.sourceModelPath) {
    main.createDiv({
      cls: "ai3d-direct-workbench-match-model",
      text: formatT("directWorkbench.registeredSourceModel", { model: formatSourceModelLabel(match.sourceModelPath) }),
    });
  }
  main.createDiv({
    cls: "ai3d-direct-workbench-match-target",
    text: match.sourceNotePath
      ? t("directWorkbench.registeredTargetPartNote")
      : match.sourceModelPath
        ? t("directWorkbench.registeredTargetSourceModel")
        : t("directWorkbench.registeredTargetUnavailable"),
  });
  if (match.reasons.length > 0) {
    main.createDiv({
      cls: "ai3d-direct-workbench-match-reasons",
      text: match.reasons.slice(0, 2).join(" / "),
    });
  }

  const side = row.createDiv({ cls: "ai3d-direct-workbench-match-side" });
  side.createDiv({
    cls: "ai3d-direct-workbench-match-score",
    text: `${Math.round(match.matchScore * 100)}%`,
  });
  const review = side.createDiv({ cls: "ai3d-direct-workbench-match-review" });
  if (match.reviewDecision) {
    review.createSpan({
      cls: `ai3d-direct-workbench-match-review-status is-${match.reviewDecision}`,
      text: match.reviewDecision === "confirmed"
        ? t("directWorkbench.registeredConfirmed")
        : t("directWorkbench.registeredRejected"),
    });
    review.createEl("button", {
      cls: "ai3d-direct-workbench-action ai3d-direct-workbench-match-review-action",
      text: t("directWorkbench.registeredUndoReview"),
      attr: {
        type: "button",
        "data-ai3d-action": "review-registered-part",
        "data-ai3d-review-decision": "clear",
      },
    });
  } else {
    review.createEl("button", {
      cls: "ai3d-direct-workbench-action ai3d-direct-workbench-match-review-action",
      text: t("directWorkbench.registeredConfirm"),
      attr: {
        type: "button",
        "data-ai3d-action": "review-registered-part",
        "data-ai3d-review-decision": "confirmed",
      },
    });
    review.createEl("button", {
      cls: "ai3d-direct-workbench-action ai3d-direct-workbench-match-review-action",
      text: t("directWorkbench.registeredReject"),
      attr: {
        type: "button",
        "data-ai3d-action": "review-registered-part",
        "data-ai3d-review-decision": "rejected",
      },
    });
  }
  const openButton = side.createEl("button", {
    cls: "ai3d-direct-workbench-action ai3d-direct-workbench-match-open",
    text: match.sourceNotePath
      ? t("directWorkbench.registeredOpenNote")
      : t("directWorkbench.registeredOpenModel"),
    attr: {
      type: "button",
      "data-ai3d-action": "open-registered-part",
      "data-ai3d-target-path": match.sourceNotePath ?? match.sourceModelPath ?? "",
    },
  });
  openButton.disabled = !match.sourceNotePath && !match.sourceModelPath;
  return row;
}
