import { FileToolsOptions } from "@babylonjs/core/Misc/fileTools.js";
import { Tools } from "@babylonjs/core/Misc/tools.js";
import { WebRequest } from "@babylonjs/core/Misc/webRequest.js";

let networkGuardConfigured = false;

function isExplicitRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  // Matches the Three.js guard: https, http, ws, wss, and ftp schemes plus
  // protocol-relative (//) URLs are all refused.
  return /^(https?:|wss?:|ftp:)\/\//i.test(trimmed) || /^\/\//.test(trimmed);
}

function guardBabylonUrl(url: string, channel: string): string {
  if (isExplicitRemoteUrl(url)) {
    throw new Error(
      `[AI3D] Babylon ${channel} is limited to local vault resources. Refused remote URL: ${url}`,
    );
  }
  return url;
}

function rejectBabylonScriptLoad(scriptUrl: string): never {
  throw new Error(
    `[AI3D] Babylon script loading is disabled in this plugin build. Refused script URL: ${scriptUrl}`,
  );
}

export function configureBabylonNetworkGuards(): void {
  if (networkGuardConfigured) return;

  const guardAssetUrl = (url: string) => guardBabylonUrl(url, "asset loading");
  const guardScriptUrl = (url: string) => guardBabylonUrl(url, "script loading");
  const disableRetry = () => -1;

  Tools.PreprocessUrl = guardAssetUrl;
  Tools.ScriptPreprocessUrl = guardScriptUrl;
  Tools.DefaultRetryStrategy = disableRetry;
  Tools.LoadScript = (scriptUrl, onSuccess, onError) => {
    try {
      guardScriptUrl(scriptUrl);
      rejectBabylonScriptLoad(scriptUrl);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error), error);
      return;
    }
    onSuccess?.();
  };
  Tools.LoadScriptAsync = async (scriptUrl) => {
    guardScriptUrl(scriptUrl);
    rejectBabylonScriptLoad(scriptUrl);
  };
  Tools.LoadBabylonScript = (scriptUrl, onSuccess, onError) => {
    try {
      rejectBabylonScriptLoad(scriptUrl);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error), error);
      return;
    }
    onSuccess();
  };
  Tools.LoadBabylonScriptAsync = async (scriptUrl) => {
    rejectBabylonScriptLoad(scriptUrl);
  };

  FileToolsOptions.PreprocessUrl = guardAssetUrl;
  FileToolsOptions.ScriptPreprocessUrl = guardScriptUrl;
  FileToolsOptions.DefaultRetryStrategy = disableRetry;

  WebRequest.CustomRequestModifiers.push((_request, url) => guardBabylonUrl(url, "request"));

  networkGuardConfigured = true;
}
