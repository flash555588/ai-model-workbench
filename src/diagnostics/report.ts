import { apiVersion } from "obsidian";
import type { PluginManifest } from "obsidian";
import type { PluginState } from "../domain/models";
import { listSupportedModelExtensions } from "../io/formats/registry";
import { resolvePreviewRoute } from "../render/preview/routing";
import { isMobile } from "../utils/device";

export interface BuildDiagnosticsReportOptions {
  manifest: PluginManifest;
  state: PluginState;
  generatedAt?: string;
  includeVaultPaths?: boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "unknown";
  if (typeof value === "string") return value.length > 0 ? value : "empty";
  return "unknown";
}

function getPathExtension(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return "";
  }
  return `.${filename.slice(dotIndex + 1).toLowerCase()}`;
}

function formatPathValue(path: string | null | undefined, includeVaultPaths: boolean, emptyValue: string): string {
  if (!path) {
    return emptyValue;
  }
  if (includeVaultPaths) {
    return path;
  }
  const ext = getPathExtension(path);
  return ext ? `<redacted ${ext}>` : "<redacted>";
}

function formatPathStatus(path: string | undefined, includeVaultPaths: boolean): string {
  return path ? `set (${formatPathValue(path, includeVaultPaths, "not set")})` : "not set";
}

function formatRemoteMode(state: PluginState): string {
  const settings = state.settings;
  if (settings.analysisMode === "local") {
    return "local only";
  }
  return [
    settings.analysisMode,
    settings.serviceBaseUrl.trim() ? "service configured" : "service missing",
    `geometry ${formatValue(settings.sendGeometrySummaryToRemote)}`,
    `preview refs ${formatValue(settings.sendPreviewImagesToRemote)}`,
    `raw model ${settings.sendRawModelToRemote ? "blocked if requested" : "off"}`,
  ].join(", ");
}

function getCurrentProfile(state: PluginState) {
  const path = state.currentModelPath;
  return path ? state.modelAssetProfiles[path] : undefined;
}

export function buildDiagnosticsReport(options: BuildDiagnosticsReportOptions): string {
  const { manifest, state } = options;
  const settings = state.settings;
  const profile = getCurrentProfile(state);
  const includeVaultPaths = options.includeVaultPaths === true;
  const route = state.currentModelPath
    ? resolvePreviewRoute({
        ext: state.currentModelPath.split(".").pop() ?? "",
        annotationMode: profile?.annotations.length ? "readonly" : "none",
        allowEditModeOnThree: true,
        allowWorkbenchFeaturesOnThree: settings.experimentalThreeWorkbench,
        rendererRollout: settings.previewRendererRollout,
        useThreeRenderer: settings.useThreeRenderer,
      })
    : null;
  const last = state.lastKnowledgeGeneration;

  return [
    "# AI Model Workbench Diagnostics",
    "",
    `Generated: ${options.generatedAt ?? new Date().toISOString()}`,
    "",
    "## Runtime",
    "",
    `- Plugin version: ${manifest.version}`,
    `- Minimum Obsidian version: ${manifest.minAppVersion}`,
    `- Obsidian API version: ${apiVersion}`,
    `- Platform: ${isMobile() ? "mobile" : "desktop"}`,
    `- Locale: ${settings.locale}`,
    "",
    "## Renderer",
    "",
    `- Use Three renderer: ${formatValue(settings.useThreeRenderer)}`,
    `- Preview rollout: ${settings.previewRendererRollout}`,
    `- Experimental Three workbench: ${formatValue(settings.experimentalThreeWorkbench)}`,
    `- Current route: ${route ? `${route.backend} (${route.reason})` : "no current model"}`,
    `- Render quality: ${settings.renderQuality}`,
    `- Render scale: ${settings.renderScale}`,
    "",
    "## Current Model",
    "",
    `- Path: ${formatPathValue(state.currentModelPath, includeVaultPaths, "none")}`,
    `- Preview summary: ${state.modelPreview ? `${state.modelPreview.meshCount} mesh(es), ${state.modelPreview.triangleCount.toLocaleString()} triangle(s), ${state.modelPreview.materialCount} material(s)` : "not captured"}`,
    `- Annotation count: ${profile?.annotations.length ?? 0}`,
    `- Registered part candidates: ${profile?.registeredParts?.length ?? 0}`,
    `- Report note: ${formatPathStatus(profile?.reportNotePath, includeVaultPaths)}`,
    `- Analysis sidecar: ${formatPathStatus(profile?.analysisSidecarPath, includeVaultPaths)}`,
    `- Knowledge index: ${formatPathStatus(profile?.knowledgeIndexPath, includeVaultPaths)}`,
    "",
    "## Knowledge Generation",
    "",
    `- Mode: ${formatRemoteMode(state)}`,
    `- Report folder: ${formatPathValue(settings.reportFolder, includeVaultPaths, "empty")}`,
    `- Part notes folder: ${formatPathValue(settings.partFolder, includeVaultPaths, "empty")}`,
    `- Snapshot folder: ${formatPathValue(settings.previewFolder, includeVaultPaths, "empty")}`,
    `- Last generation: ${last ? `${last.status} at ${last.generatedAt}` : "none"}`,
    `- Last generated model: ${formatPathValue(last?.modelPath, includeVaultPaths, "none")}`,
    `- Last report: ${formatPathStatus(last?.reportNotePath, includeVaultPaths)}`,
    `- Last index: ${formatPathStatus(last?.knowledgeIndexPath, includeVaultPaths)}`,
    `- Last part notes: ${last?.partNoteCount ?? 0}`,
    `- Last preview images: ${last?.previewImageCount ?? 0}`,
    `- Last warning count: ${last?.warningCount ?? 0}`,
    "",
    "## Conversion",
    "",
    `- Enabled converters: ${settings.enabledConverterIds.length ? settings.enabledConverterIds.join(", ") : "none"}`,
    `- Cached conversions: ${state.convertedAssetRecords.length}`,
    `- Supported direct/model extensions: ${listSupportedModelExtensions().join(", ")}`,
    "",
    "## Notes",
    "",
    "- Draft service URL and command paths are intentionally omitted from this report.",
    includeVaultPaths
      ? "- Vault-relative model and note paths are included because includeVaultPaths was requested."
      : "- Vault-relative model, report, index, and folder paths are redacted by default.",
    "- Attach this report with the model format, console error, and reproduction steps when filing a bug.",
    "",
  ].join("\n");
}
