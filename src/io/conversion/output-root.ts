import type { App } from "obsidian";
import type { PluginSettings } from "../../domain/models";
import { joinVaultConfigPath, resolveVaultAbsolutePath } from "../../utils/resolve-path";

export const DEFAULT_CONVERSION_OUTPUT_CONFIG_PATH = "ai-model-workbench/converted-assets";

export function resolveConversionOutputRoot(
  app: App,
  settings: Pick<PluginSettings, "auxiliaryFileFolder">,
): string | undefined {
  const customFolder = settings.auxiliaryFileFolder.trim();
  const vaultPath = customFolder || joinVaultConfigPath(app, DEFAULT_CONVERSION_OUTPUT_CONFIG_PATH);
  return resolveVaultAbsolutePath(app, vaultPath) ?? undefined;
}
