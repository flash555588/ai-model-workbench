import { DEFAULT_SETTINGS } from "../domain/constants";
import type { PluginSettings } from "../domain/models";

const STRING_ENUM_VALUES = {
  analysisMode: ["local", "remote", "hybrid"],
  annotationPreviewMode: ["plain-text", "markdown"],
  annotationDisplayMode: ["snippet", "surface", "dot"],
  previewRendererRollout: ["babylon-safe", "three-readonly-glb", "three-direct-glb"],
  renderQuality: ["low", "medium", "high"],
  snapshotNaming: ["timestamp", "model-name"],
  logLevel: ["debug", "info", "warn", "error"],
  locale: ["en", "zh-CN"],
} as const satisfies Partial<Record<keyof PluginSettings, readonly string[]>>;

const NUMBER_RANGES = {
  maxFileSizeMb: { min: 1, max: 100_000 },
  defaultCanvasHeight: { min: 200, max: 800 },
  autoRotateSpeed: { min: 0.1, max: 2 },
  renderScale: { min: 0.25, max: 2 },
} as const satisfies Partial<Record<keyof PluginSettings, { min: number; max: number }>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assignSetting<K extends keyof PluginSettings>(
  settings: PluginSettings,
  key: K,
  value: PluginSettings[K],
): void {
  settings[key] = value;
}

function normalizeSettingValue<K extends keyof PluginSettings>(
  key: K,
  value: unknown,
): PluginSettings[K] | undefined {
  const fallback = DEFAULT_SETTINGS[key];
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      return undefined;
    }
    return [...value] as PluginSettings[K];
  }

  if (typeof fallback === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const range = NUMBER_RANGES[key as keyof typeof NUMBER_RANGES];
    if (range && (value < range.min || value > range.max)) return undefined;
    return value as PluginSettings[K];
  }

  if (typeof fallback === "boolean") {
    return typeof value === "boolean" ? value as PluginSettings[K] : undefined;
  }

  if (typeof fallback === "string") {
    if (typeof value !== "string") return undefined;
    const allowed = STRING_ENUM_VALUES[key as keyof typeof STRING_ENUM_VALUES] as readonly string[] | undefined;
    if (allowed && !allowed.includes(value)) return undefined;
    return value as PluginSettings[K];
  }

  return undefined;
}

export function normalizePluginSettings(value: unknown): PluginSettings {
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    enabledConverterIds: [...DEFAULT_SETTINGS.enabledConverterIds],
  };
  if (!isRecord(value)) return settings;

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>) {
    const normalized = normalizeSettingValue(key, value[key]);
    if (normalized !== undefined) {
      assignSetting(settings, key, normalized);
    }
  }
  return settings;
}

export function hasPersistedLocale(value: unknown): boolean {
  return isRecord(value) && (value.locale === "en" || value.locale === "zh-CN");
}
