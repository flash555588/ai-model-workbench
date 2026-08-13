import { formatT, t } from "../../i18n";

const CONVERTER_DISPLAY_NAMES: Record<string, string> = {
  freecad: "FreeCAD",
  obj2gltf: "obj2gltf",
  fbx2gltf: "FBX2glTF",
  assimp: "mesh",
  sldprt: "FreeCAD",
};

export interface ModelLoadFailureDetails {
  level: "warning" | "error";
  title: string;
  message: string;
  hint: string;
}

function formatSourceExt(sourceExt: string): string {
  return `.${sourceExt.trim().toLowerCase()}`;
}

export class MissingConverterError extends Error {
  readonly name = "MissingConverterError";

  constructor(
    readonly converterId: string,
    readonly sourceExt: string,
  ) {
    super(
      `Converter '${converterId}' is not registered for ${formatSourceExt(sourceExt)}. ` +
      "Enable the matching converter in plugin settings before loading this format.",
    );
  }
}

export class MobileConversionUnavailableError extends Error {
  readonly name = "MobileConversionUnavailableError";

  constructor(readonly sourceExt: string) {
    super(
      `Format ${formatSourceExt(sourceExt)} requires local conversion tools that are unavailable on iOS, iPadOS, and Android.`,
    );
  }
}

export function isMissingConverterError(err: unknown): err is MissingConverterError {
  return err instanceof MissingConverterError;
}

export function formatModelLoadFailure(err: unknown): string {
  if (err instanceof MissingConverterError) {
    const converterName = CONVERTER_DISPLAY_NAMES[err.converterId] ?? err.converterId;
    return formatT("modelLoad.warningMessage", {
      ext: formatSourceExt(err.sourceExt),
      converterName,
    });
  }

  if (err instanceof MobileConversionUnavailableError) {
    return formatT("modelLoad.mobileWarningMessage", {
      ext: formatSourceExt(err.sourceExt),
    });
  }

  return formatT("modelLoad.errorMessage", {
    reason: err instanceof Error ? err.message : String(err),
  });
}

export function describeModelLoadFailure(err: unknown): ModelLoadFailureDetails {
  if (err instanceof MissingConverterError) {
    return {
      level: "warning",
      title: t("modelLoad.warningTitle"),
      message: formatModelLoadFailure(err),
      hint: t("modelLoad.warningHint"),
    };
  }

  if (err instanceof MobileConversionUnavailableError) {
    return {
      level: "warning",
      title: t("modelLoad.warningTitle"),
      message: formatModelLoadFailure(err),
      hint: t("modelLoad.mobileWarningHint"),
    };
  }

  return {
    level: "error",
    title: t("modelLoad.errorTitle"),
    message: formatModelLoadFailure(err),
    hint: t("modelLoad.errorHint"),
  };
}
