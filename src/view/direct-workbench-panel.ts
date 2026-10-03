import type { ModelPreviewSummary } from "../domain/models";
import { t } from "../i18n";

export interface DirectWorkbenchRouteSummary {
  backend: string;
  reason: string;
}

export interface DirectWorkbenchOverviewOptions {
  panel: HTMLElement;
  summary: ModelPreviewSummary;
  route: DirectWorkbenchRouteSummary;
  registeredPartCount: number | undefined;
}

export function formatDirectWorkbenchCount(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString();
}

export function formatDirectWorkbenchBounds(summary: ModelPreviewSummary): string {
  return [
    summary.boundingSize.x,
    summary.boundingSize.y,
    summary.boundingSize.z,
  ].map((value) => value.toFixed(2)).join(" x ");
}

export function formatDirectWorkbenchBackendName(backend: string): string {
  return backend === "three" ? "Three.js" : "Babylon.js";
}

export function formatDirectWorkbenchPerformance(tier: ModelPreviewSummary["performanceTier"]): string {
  if (tier === "extreme") return t("directWorkbench.performanceExtreme");
  if (tier === "heavy") return t("directWorkbench.performanceHeavy");
  if (tier === "medium") return t("directWorkbench.performanceMedium");
  return t("directWorkbench.performanceLight");
}

export function renderDirectWorkbenchOverview(options: DirectWorkbenchOverviewOptions): void {
  const { panel, summary, route, registeredPartCount } = options;
  const diagnosticsOpen = panel.querySelector<HTMLDetailsElement>(".ai3d-direct-workbench-diagnostics")?.open ?? false;
  panel.empty();
  panel.removeClass("is-hidden");
  panel.dataset.ai3dBackend = route.backend;
  panel.dataset.ai3dRouteReason = route.reason;

  const overview = panel.createDiv({ cls: "ai3d-direct-workbench-overview" });
  overview.createDiv({ cls: "ai3d-direct-workbench-label", text: t("workbench.summaryTitle") });
  const metrics = overview.createDiv({ cls: "ai3d-direct-workbench-metrics" });
  renderDirectWorkbenchMetric(metrics, t("workbench.meshesLabel"), formatDirectWorkbenchCount(summary.meshCount));
  renderDirectWorkbenchMetric(metrics, t("directWorkbench.partCandidatesLabel"), formatDirectWorkbenchCount(registeredPartCount));
  renderDirectWorkbenchMetric(
    metrics,
    summary.splatCount !== undefined ? t("workbench.splatsLabel") : t("workbench.trianglesLabel"),
    formatDirectWorkbenchCount(summary.splatCount ?? summary.triangleCount),
  );
  renderDirectWorkbenchMetric(metrics, t("workbench.materialsLabel"), formatDirectWorkbenchCount(summary.materialCount));
  renderDirectWorkbenchMetric(metrics, t("workbench.boundingSizeLabel"), formatDirectWorkbenchBounds(summary));
  renderDirectWorkbenchMetric(metrics, t("directWorkbench.performanceLabel"), formatDirectWorkbenchPerformance(summary.performanceTier));
  const diagnostics = overview.createEl("details", { cls: "ai3d-direct-workbench-diagnostics" });
  diagnostics.open = diagnosticsOpen;
  diagnostics.createEl("summary", { text: t("directWorkbench.diagnosticsTitle") });
  const status = diagnostics.createDiv({ cls: "ai3d-direct-workbench-status" });
  const backendLine = status.createDiv({ cls: "ai3d-direct-workbench-line" });
  backendLine.createSpan({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.backendLabel") });
  backendLine.createSpan({ cls: "ai3d-direct-workbench-value", text: formatDirectWorkbenchBackendName(route.backend) });

  const routeLine = status.createDiv({ cls: "ai3d-direct-workbench-line ai3d-direct-workbench-route" });
  routeLine.createSpan({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.routeLabel") });
  routeLine.createSpan({ cls: "ai3d-direct-workbench-value", text: route.reason });

}

function renderDirectWorkbenchMetric(parent: HTMLElement, label: string, value: string): void {
  const metric = parent.createDiv({ cls: "ai3d-direct-workbench-metric" });
  metric.createSpan({ cls: "ai3d-direct-workbench-label", text: label });
  metric.createSpan({ cls: "ai3d-direct-workbench-value", text: value });
}
