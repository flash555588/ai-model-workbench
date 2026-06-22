import brepTemplate from "../scripts/freecad-export-brep.py";
import igesTemplate from "../scripts/freecad-export-iges.py";
import stepTemplate from "../scripts/freecad-export-step.py";
import { toPythonPathLiteral } from "../python-path";

const SOURCE_PATH_PLACEHOLDER = "__AI3D_SOURCE_PATH__";
const OUTPUT_PATH_PLACEHOLDER = "__AI3D_OUTPUT_PATH__";
const SOURCE_EXT_PLACEHOLDER = "__AI3D_SOURCE_EXT__";

function normalizeSourceExt(sourceExt: string): string {
  return sourceExt.toLowerCase().replace(/^\./, "");
}

function selectTemplate(sourceExt: string): string {
  const ext = normalizeSourceExt(sourceExt);
  if (ext === "step" || ext === "stp") {
    return stepTemplate;
  }
  if (ext === "iges" || ext === "igs") {
    return igesTemplate;
  }
  return brepTemplate;
}

function replaceAllText(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

export function buildCadScript(sourcePath: string, outputPath: string, sourceExt: string): string {
  const ext = normalizeSourceExt(sourceExt);
  const withSourcePath = replaceAllText(selectTemplate(ext), SOURCE_PATH_PLACEHOLDER, toPythonPathLiteral(sourcePath));
  const withOutputPath = replaceAllText(withSourcePath, OUTPUT_PATH_PLACEHOLDER, toPythonPathLiteral(outputPath));
  return replaceAllText(withOutputPath, SOURCE_EXT_PLACEHOLDER, ext);
}
