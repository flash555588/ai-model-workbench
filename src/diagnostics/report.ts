import { apiVersion } from "obsidian";
import type { PluginManifest } from "obsidian";
import type { PluginSettings, PluginState } from "../domain/models";
import { listSupportedModelExtensions } from "../io/formats/registry";
import { describePreviewRouteCapabilities, formatPreviewCapabilityProfile } from "../render/preview/capabilities";
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

function formatKnowledgeGenerationAttention(state: PluginState): string {
  const last = state.lastKnowledgeGeneration;
  if (!last) {
    return "none";
  }
  if (last.status === "pending") {
    return "pending or interrupted; rerun generation to replace the marker";
  }
  if (last.status === "failed") {
    return "failed; inspect console details and rerun after fixing the issue";
  }
  if (last.warningCount > 0) {
    return "completed with warnings";
  }
  return "none";
}

const CONVERTER_DIAGNOSTIC_SPECS: Array<{
  id: string;
  label: string;
  settingsKey: keyof Pick<
    PluginSettings,
    "freecadCommand" | "obj2gltfCommand" | "fbx2gltfCommand" | "assimpCommand" | "freecadcmdCommand"
  >;
}> = [
  { id: "freecad", label: "Python/CadQuery", settingsKey: "freecadCommand" },
  { id: "obj2gltf", label: "obj2gltf", settingsKey: "obj2gltfCommand" },
  { id: "fbx2gltf", label: "FBX2glTF", settingsKey: "fbx2gltfCommand" },
  { id: "assimp", label: "Python/trimesh", settingsKey: "assimpCommand" },
  { id: "freecadcmd", label: "FreeCADCmd", settingsKey: "freecadcmdCommand" },
];

const UNSAFE_COMMAND_CHARS = /[;|&<>$`\r\n\t]/;
const CONVERSION_TIMEOUT_MS = 300_000;

function formatConverterCommandDiagnostics(settings: PluginSettings): string {
  const enabled = new Set(settings.enabledConverterIds);
  return CONVERTER_DIAGNOSTIC_SPECS.map((spec) => {
    const command = settings[spec.settingsKey].trim();
    const commandStatus = command.length === 0
      ? "command not configured"
      : UNSAFE_COMMAND_CHARS.test(command)
        ? "command configured, unsafe command rejected"
        : "command configured, path redacted";
    return `${spec.label}: ${enabled.has(spec.id) ? "enabled" : "disabled"}, ${commandStatus}`;
  }).join("; ");
}

function formatConversionCacheDiagnostics(state: PluginState): string {
  const records = state.convertedAssetRecords;
  if (records.length === 0) {
    return "none";
  }
  const sourceCount = new Set(records.map((record) => `${record.sourcePath}:${record.sourceExt}:${record.targetExt}`)).size;
  const warningCount = records.filter((record) => record.warnings.length > 0).length;
  return [
    `${records.length} record(s) for ${sourceCount} source(s)`,
    "validated before reuse for cache version, converter identity, output presence, and source freshness",
    warningCount > 0 ? `${warningCount} record(s) carry warning text` : "",
  ].filter(Boolean).join("; ");
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
  const routeCapabilityProfile = route ? describePreviewRouteCapabilities(route) : null;
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
    `- Converted GLB Three fast path: ${formatValue(settings.useThreeForConvertedDirectView)}`,
    `- Preview rollout: ${settings.previewRendererRollout}`,
    `- Experimental Three workbench: ${formatValue(settings.experimentalThreeWorkbench)}`,
    `- Current route: ${route ? `${route.backend} (${route.reason})` : "no current model"}`,
    `- Route capability profile: ${routeCapabilityProfile ? formatPreviewCapabilityProfile(routeCapabilityProfile) : "no current model"}`,
    `- Route color pipeline: ${routeCapabilityProfile?.colorPipeline ?? "no current model"}`,
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
    `- Last generation attention: ${formatKnowledgeGenerationAttention(state)}`,
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
    `- Auxiliary file folder: ${settings.auxiliaryFileFolder.trim() ? formatPathValue(settings.auxiliaryFileFolder, includeVaultPaths, "empty") : "default config folder"}`,
    `- Cached conversions: ${state.convertedAssetRecords.length}`,
    `- Converter command status: ${formatConverterCommandDiagnostics(settings)}`,
    `- Conversion cache status: ${formatConversionCacheDiagnostics(state)}`,
    `- Conversion timeout: ${CONVERSION_TIMEOUT_MS}ms outer budget`,
    "- Converter safety: missing converters report their converter id; unsafe configured commands are rejected before execution; command paths are redacted.",
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
