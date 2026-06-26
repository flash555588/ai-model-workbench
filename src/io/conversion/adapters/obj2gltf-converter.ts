import type { ConversionRequest, ConversionResult, ModelConverter } from "../types";
import { F_OK, access, mkdir, readFile } from "../../../utils/node-shim";
import { pathDirname as dirname, pathBasename as basename, pathExtname as extname, pathJoin as join, pathIsAbsolute as isAbsolute } from "../../../utils/node-shim";
import { execFile } from "../../../utils/node-shim";
import { createLogger } from "../../../utils/log";
import { resolveConverterInvocation } from "../command-discovery";

const log = createLogger("obj2gltf-converter");
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

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
        `obj2gltf command failed: ${error.message}`,
        stdoutText ? `stdout: ${stdoutText}` : "",
        stderrText ? `stderr: ${stderrText}` : "",
      ].filter(Boolean);
      reject(new Error(parts.join(" | ")));
    });
  });
}

export class Obj2GltfConverter implements ModelConverter {
  readonly id = "obj2gltf";
  readonly sourceExts = ["obj"] as const;
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
        "Pass a file-system path to the conversion pipeline when invoking obj2gltf.",
      );
    }

    const invocation = await resolveConverterInvocation(this.id, this.configuredCommand);
    const sourceDir = dirname(req.sourcePath);
    const name = basename(req.sourcePath, extname(req.sourcePath));
    const outputPath = req.outputPath ?? join(sourceDir, `${name}.ai3d-converted.glb`);
    await mkdir(dirname(outputPath), { recursive: true });

    log.info("run obj2gltf conversion", {
      sourcePath: req.sourcePath,
      outputPath,
      command: invocation.command,
      args: invocation.args,
    });

    try {
      await execFileAsync(invocation.command, [...invocation.args, "-i", req.sourcePath, "-o", outputPath, "-b"], DEFAULT_TIMEOUT_MS);
    } catch (error) {
      throw new Error(
        `obj2gltf conversion failed for '${req.sourcePath}'. ` +
        `Set obj2gltf command path in plugin settings or AI3D_OBJ2GLTF_CMD if obj2gltf is not discoverable. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!(await fileExists(outputPath))) {
      throw new Error(`obj2gltf conversion finished but output was not found: '${outputPath}'.`);
    }

    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength === 0) {
      throw new Error(`obj2gltf output file is empty: '${outputPath}'.`);
    }

    return {
      outputPath,
      outputExt: "glb",
      fromCache: false,
      warnings: ["Converted by local obj2gltf CLI bridge."],
    };
  }
}
