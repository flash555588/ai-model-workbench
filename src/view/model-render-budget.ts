import type { App, TFile } from "obsidian";
import type { ModelPreviewSummary, PluginSettings } from "../domain/models";

export type RenderQualityBudget = Pick<PluginSettings, "renderQuality" | "renderScale">;

const MEDIUM_FILE_SIZE_BYTES = 64 * 1024 * 1024;
const HEAVY_FILE_SIZE_BYTES = 192 * 1024 * 1024;
const REMOTE_URI_RE = /^[a-z][a-z0-9+.-]*:/i;

interface GltfExternalResource {
  uri?: string;
  byteLength?: number;
}

interface GltfSizeManifest {
  buffers?: GltfExternalResource[];
  images?: GltfExternalResource[];
}

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

function stripUriSuffix(uri: string): string {
  return uri.split(/[?#]/, 1)[0] ?? uri;
}

function decodePortableUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

function normalizePortableRelativePath(path: string): string {
  const decoded = decodePortableUri(path).replace(/\\/g, "/");
  const parts: string[] = [];
  for (const part of decoded.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function joinPortablePath(basePath: string, relativePath: string): string {
  if (!basePath) {
    return normalizePortableRelativePath(stripUriSuffix(relativePath));
  }
  return normalizePortableRelativePath(`${basePath}/${stripUriSuffix(relativePath)}`);
}

function getPortableDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const sepIdx = normalized.lastIndexOf("/");
  return sepIdx > 0 ? normalized.slice(0, sepIdx) : "";
}

function shouldSkipExternalResourceUri(uri: string | undefined): boolean {
  if (!uri || uri.startsWith("data:")) {
    return true;
  }
  return REMOTE_URI_RE.test(uri) && !looksLikeAbsoluteFilesystemPath(uri);
}

function normalizedResourceKey(modelPath: string, uri: string): string {
  if (looksLikeAbsoluteFilesystemPath(modelPath)) {
    return normalizePortableRelativePath(stripUriSuffix(uri));
  }
  return joinPortablePath(getPortableDirname(modelPath), uri);
}

export async function getModelPathByteSize(app: App, path: string): Promise<number | null> {
  const baseSize = await getSinglePathByteSize(app, path);
  if (baseSize === null) {
    return null;
  }
  if (!path.toLowerCase().split(/[?#]/, 1)[0].endsWith(".gltf")) {
    return baseSize;
  }
  return estimateGltfAggregateByteSize(app, path, baseSize);
}

async function getSinglePathByteSize(app: App, path: string): Promise<number | null> {
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

async function readGltfText(app: App, path: string): Promise<string | null> {
  if (looksLikeAbsoluteFilesystemPath(path)) {
    try {
      const { readFile } = await import("../utils/node-shim");
      return new TextDecoder().decode(await readFile(path));
    } catch {
      return null;
    }
  }

  const file = app.vault.getAbstractFileByPath(path);
  const vault = app.vault as typeof app.vault & { read?: (file: TFile) => Promise<string> };
  if (!file || typeof vault.read !== "function") {
    return null;
  }
  try {
    return await vault.read(file as TFile);
  } catch {
    return null;
  }
}

async function getExternalResourceByteSize(app: App, modelPath: string, uri: string): Promise<number | null> {
  if (looksLikeAbsoluteFilesystemPath(modelPath)) {
    try {
      const { pathJoin, pathNormalize, stat } = await import("../utils/node-shim");
      const cleanUri = stripUriSuffix(decodePortableUri(uri));
      const modelDir = pathNormalize(modelPath.replace(/[\\/][^\\/]*$/, ""));
      const resourcePath = looksLikeAbsoluteFilesystemPath(cleanUri)
        ? pathNormalize(cleanUri)
        : pathNormalize(pathJoin(modelDir, cleanUri));
      const stats = await stat(resourcePath);
      return stats.size;
    } catch {
      return null;
    }
  }

  const modelDir = getPortableDirname(modelPath);
  const resourcePath = joinPortablePath(modelDir, uri);
  const file = app.vault.getAbstractFileByPath(resourcePath);
  return isFileWithSize(file) ? file.stat.size : null;
}

async function estimateGltfAggregateByteSize(app: App, path: string, baseSize: number): Promise<number> {
  const text = await readGltfText(app, path);
  if (!text) {
    return baseSize;
  }

  let manifest: GltfSizeManifest;
  try {
    manifest = JSON.parse(text) as GltfSizeManifest;
  } catch {
    return baseSize;
  }

  let total = baseSize;
  const seen = new Set<string>();
  const addResource = async (resource: GltfExternalResource | undefined, fallbackByteLength?: number): Promise<void> => {
    const uri = resource?.uri;
    if (!uri || shouldSkipExternalResourceUri(uri)) {
      return;
    }
    const key = normalizedResourceKey(path, uri);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);

    const size = await getExternalResourceByteSize(app, path, uri);
    if (size !== null && Number.isFinite(size) && size > 0) {
      total += size;
      return;
    }
    const declaredSize = resource?.byteLength ?? fallbackByteLength;
    if (Number.isFinite(declaredSize) && (declaredSize ?? 0) > 0) {
      total += declaredSize ?? 0;
    }
  };

  for (const buffer of manifest.buffers ?? []) {
    await addResource(buffer, buffer.byteLength);
  }
  for (const image of manifest.images ?? []) {
    await addResource(image);
  }
  return total;
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
