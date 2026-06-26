import type { ConversionRequest, ConversionResult, ModelConverter } from "../types";
import { F_OK, access, mkdir, readFile, rm, writeFile } from "../../../utils/node-shim";
import { pathJoin as join, pathDirname as dirname, pathBasename as basename, pathExtname as extname, pathIsAbsolute as isAbsolute } from "../../../utils/node-shim";
import { osTmpdir as tmpdir } from "../../../utils/node-shim";
import { execFile } from "../../../utils/node-shim";
import { createLogger } from "../../../utils/log";
import { resolveConverterInvocation } from "../command-discovery";
import { buildCadScript } from "./freecad-script-builder";

const log = createLogger("freecad-converter");

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, F_OK);
    return true;
  } catch {
    return false;
  }
}

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      const stdoutText = (stdout ?? "").toString().trim();
      const stderrText = (stderr ?? "").toString().trim();
      const parts = [
        `CAD conversion failed: ${error.message}`,
        stdoutText ? `stdout: ${stdoutText}` : "",
        stderrText ? `stderr: ${stderrText}` : "",
      ].filter(Boolean);

      reject(new Error(parts.join(" | ")));
    });
  });
}

export class FreecadConverter implements ModelConverter {
  readonly id = "freecad";
  readonly sourceExts = ["step", "stp", "iges", "igs", "brep"] as const;
  readonly targetExt = "glb" as const;

  constructor(private configuredCommand?: string) {}

  async getCacheKey(): Promise<string> {
    const invocation = await resolveConverterInvocation(this.id, this.configuredCommand);
    return `${this.id}:${invocation.command} ${invocation.args.join(" ")}`.trim();
  }

  async convert(req: ConversionRequest): Promise<ConversionResult> {
    if (!isAbsolute(req.sourcePath)) {
      throw new Error(
        `Converter '${this.id}' requires an absolute source path, got '${req.sourcePath}'. ` +
        "Pass a file-system path to the conversion pipeline when invoking CAD conversion.",
      );
    }

    const invocation = await resolveConverterInvocation(this.id, this.configuredCommand);
    const sourceDir = dirname(req.sourcePath);
    const name = basename(req.sourcePath, extname(req.sourcePath));
    const outputPath = req.outputPath ?? join(sourceDir, `${name}.ai3d-converted.glb`);
    const scriptDir = join(tmpdir(), "ai3d-freecad");
    const scriptPath = join(scriptDir, `${name}-${Date.now()}.py`);

    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(scriptDir, { recursive: true });
    await writeFile(scriptPath, buildCadScript(req.sourcePath, outputPath, req.sourceExt), "utf8");

    log.info("run CAD conversion (CadQuery/OCCT)", {
      sourcePath: req.sourcePath,
      outputPath,
      command: invocation.command,
      args: invocation.args,
    });

    try {
      await execFileAsync(invocation.command, [...invocation.args, scriptPath], DEFAULT_TIMEOUT_MS);
    } catch (error) {
      throw new Error(
        `CAD conversion failed for '${req.sourcePath}'. ` +
        `Ensure Python with cadquery is installed: pip install cadquery trimesh. ` +
        `Set Python command path in plugin settings or AI3D_FREECAD_CMD if Python is not discoverable. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      void rm(scriptPath, { force: true });
    }

    if (!(await fileExists(outputPath))) {
      throw new Error(
        `CAD conversion finished but output was not found: '${outputPath}'. ` +
        "Check that CadQuery supports this CAD format.",
      );
    }

    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength === 0) {
      throw new Error(`CAD conversion output is empty: '${outputPath}'.`);
    }

    return {
      outputPath,
      outputExt: "glb",
      fromCache: false,
      warnings: ["Converted by local Python/CadQuery(OCCT) bridge."],
    };
  }
}
