import type { App, TFile } from "obsidian";
import type { ModelPreviewSummary, PluginSettings } from "../domain/models";

export type RenderQualityBudget = Pick<PluginSettings, "renderQuality" | "renderScale">;

const MEDIUM_FILE_SIZE_BYTES = 64 * 1024 * 1024;
const HEAVY_FILE_SIZE_BYTES = 192 * 1024 * 1024;

function settingsBudget(settings: RenderQualityBudget): RenderQualityBudget {
  return {
    renderQuality: settings.renderQuality,
    renderScale: settings.renderScale,
  };
}

export function getFileSizeRenderBudget(
  settings: RenderQualityBudget,
  byteSize: number | null | undefined,
): RenderQualityBudget {
  if (!Number.isFinite(byteSize ?? Number.NaN) || (byteSize ?? 0) <= 0) {
    return settingsBudget(settings);
  }

  if ((byteSize ?? 0) >= HEAVY_FILE_SIZE_BYTES) {
    return {
      renderQuality: "low",
      renderScale: Math.min(settings.renderScale, 0.65),
    };
  }

  if ((byteSize ?? 0) >= MEDIUM_FILE_SIZE_BYTES) {
    return {
      renderQuality: settings.renderQuality === "low" ? "low" : "medium",
      renderScale: Math.min(settings.renderScale, 0.85),
    };
  }

  return settingsBudget(settings);
}

export function getSummaryRenderBudget(
  settings: RenderQualityBudget,
  summary: ModelPreviewSummary,
): RenderQualityBudget {
  if (summary.performanceTier === "extreme") {
    return {
      renderQuality: "low",
      renderScale: Math.min(settings.renderScale, 0.65),
    };
  }
  if (summary.performanceTier === "heavy") {
    return {
      renderQuality: settings.renderQuality === "low" ? "low" : "medium",
      renderScale: Math.min(settings.renderScale, 0.85),
    };
  }
  if (summary.performanceTier === "medium") {
    return {
      renderQuality: settings.renderQuality,
      renderScale: Math.min(settings.renderScale, 1),
    };
  }
  return settingsBudget(settings);
}

export function looksLikeAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

export async function getModelPathByteSize(app: App, path: string): Promise<number | null> {
  if (looksLikeAbsoluteFilesystemPath(path)) {
    try {
      const { stat } = await import("../utils/node-shim");
      const stats = await stat(path);
      return stats.size;
    } catch {
      return null;
    }
  }

  const file = app.vault.getAbstractFileByPath(path);
  return isFileWithSize(file) ? file.stat.size : null;
}

function isFileWithSize(value: unknown): value is TFile {
  const file = value as Partial<TFile> | null | undefined;
  return !!file &&
    typeof file === "object" &&
    !!file.stat &&
    typeof file.stat.size === "number";
}

export async function getPreviewPathRenderBudget(
  app: App,
  path: string,
  settings: RenderQualityBudget,
): Promise<RenderQualityBudget> {
  return getFileSizeRenderBudget(settings, await getModelPathByteSize(app, path));
}
