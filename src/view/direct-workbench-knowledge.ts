import type { KnowledgeGenerationRecord, ModelAssetProfile } from "../domain/models";
import { t, type TranslationKey } from "../i18n";
import type { KnowledgeGenerationProgress } from "./workbench/knowledge-generation-progress";

const phaseLabels: Record<KnowledgeGenerationProgress["phase"], TranslationKey> = {
  capture: "directWorkbench.phaseCapture",
  paths: "directWorkbench.phasePaths",
  analysis: "directWorkbench.phaseAnalysis",
  parts: "directWorkbench.phaseParts",
  remote: "directWorkbench.phaseRemote",
  write: "directWorkbench.phaseWrite",
  index: "directWorkbench.phaseIndex",
};

export function getDirectKnowledgeState(options: {
  modelPath: string;
  profile: ModelAssetProfile | undefined;
  record: KnowledgeGenerationRecord | null;
  progress: KnowledgeGenerationProgress | null;
  starting: boolean;
  error?: string;
}): {
  status: "generating" | "failed" | "interrupted" | "ready" | "empty";
  message: string;
  primary: "generate-note" | "open-note" | "open-index";
  generateLabel: string;
  generateDisabled: boolean;
} {
  const { modelPath, profile, progress, starting, error } = options;
  const record = options.record?.modelPath === modelPath ? options.record : null;
  const generating = progress?.modelPath === modelPath || starting;
  const failed = !generating && (!!error || record?.status === "failed");
  const interrupted = !generating && record?.status === "pending";
  const primary = failed || interrupted || !profile?.reportNotePath
    ? "generate-note"
    : profile.knowledgeIndexPath ? "open-index" : "open-note";
  const status = generating ? "generating" : failed ? "failed" : interrupted ? "interrupted" : profile?.reportNotePath ? "ready" : "empty";
  const message = generating
    ? progress?.modelPath === modelPath ? t(phaseLabels[progress.phase]) : t("directWorkbench.phaseStarting")
    : failed ? t("directWorkbench.generationFailed")
      : interrupted ? t("directWorkbench.generationInterrupted")
        : profile?.knowledgeIndexPath ? t("workbench.indexReady")
          : profile?.reportNotePath ? t("workbench.noteReady") : t("workbench.noReportYet");
  return {
    status,
    message,
    primary,
    generateLabel: generating ? t("directWorkbench.generatingAction")
      : failed || interrupted ? t("directWorkbench.retryGenerationAction")
        : profile?.reportNotePath ? t("directWorkbench.regenerateAction") : t("directWorkbench.generateKnowledgeAction"),
    generateDisabled: !!progress || starting,
  };
}
