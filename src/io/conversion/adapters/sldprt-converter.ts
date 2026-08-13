import type { ConversionRequest, ConversionResult, ModelConverter } from "../types";
import { F_OK, access, mkdir, readFile, rm, writeFile } from "../../../utils/node-shim";
import { pathJoin as join, pathDirname as dirname, pathBasename as basename, pathExtname as extname, pathIsAbsolute as isAbsolute } from "../../../utils/node-shim";
import { osTmpdir as tmpdir } from "../../../utils/node-shim";
import { execFile } from "../../../utils/node-shim";
import { createLogger } from "../../../utils/log";
import { resolveConverterInvocation } from "../command-discovery";
import { toPythonPathLiteral } from "../python-path";

const log = createLogger("sldprt-converter");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — FreeCAD import can be slow

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, F_OK);
    return true;
  } catch {
    return false;
  }
}

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
        return;
      }

      const stdoutText = (stdout ?? "").toString().trim();
      const stderrText = (stderr ?? "").toString().trim();
      const parts = [
        `SLDPRT conversion failed: ${error.message}`,
        stdoutText ? `stdout: ${stdoutText}` : "",
        stderrText ? `stderr: ${stderrText}` : "",
      ].filter(Boolean);

      reject(new Error(parts.join(" | ")));
    });
  });
}

/**
 * Build a Python script for FreeCADCmd that:
 * 1. Opens the SLDPRT file via FreeCAD's ImportGui
 * 2. Exports to STEP as intermediate format
 * 3. Uses OCP (OpenCASCADE) to triangulate and export GLB with vertex colors
 */
function buildFreeCadScript(sourcePath: string, outputPath: string): string {
  const src = toPythonPathLiteral(sourcePath);
  const out = toPythonPathLiteral(outputPath);
  // Intermediate STEP file in temp dir
  const stepOut = out.replace(/\.glb$/i, ".intermediate.step");

  return [
    "import sys",
    "import os",
    "",
    `src = r"${src}"`,
    `out = r"${out}"`,
    `step_out = r"${stepOut}"`,
    "",
    "# Step 1: Import SLDPRT via FreeCAD",
    "try:",
    "    import FreeCAD",
    "    import ImportGui",
    "    import Mesh",
    "except ImportError as e:",
    '    print(f"FreeCAD modules not available: {e}", file=sys.stderr)',
    '    print("Ensure this script runs under FreeCADCmd (not system Python).", file=sys.stderr)',
    "    sys.exit(1)",
    "",
    "print(f'Opening SLDPRT: {src}')",
    "try:",
    "    doc = FreeCAD.newDocument('Convert')",
    "    ImportGui.open(src, doc.Name)",
    "except Exception as e:",
    '    print(f"Failed to open SLDPRT file: {e}", file=sys.stderr)',
    "    sys.exit(1)",
    "",
    "if not doc.Objects:",
    '    print("SLDPRT file imported but contains no objects", file=sys.stderr)',
    "    sys.exit(1)",
    "",
    'print(f"Imported {len(doc.Objects)} object(s) from SLDPRT")',
    "",
    "# Step 2: Export to STEP (intermediate)",
    "try:",
    "    import Import",
    "    objs = [o for o in doc.Objects if hasattr(o, 'Shape')]",
    "    if not objs:",
    '        print("No shape objects found after import", file=sys.stderr)',
    "        sys.exit(1)",
    "    Import.export(objs, step_out)",
    '    print(f"Exported intermediate STEP: {step_out}")',
    "except Exception as e:",
    '    print(f"Failed to export STEP: {e}", file=sys.stderr)',
    "    sys.exit(1)",
    "",
    "FreeCAD.closeDocument(doc.Name)",
    "",
    "# Step 3: Convert STEP to GLB using OCP (same pipeline as FreecadConverter)",
    "import trimesh",
    "import trimesh.visual",
    "import numpy as np",
    "",
    "from OCP.STEPControl import STEPControl_Reader",
    "from OCP.TopoDS import TopoDS",
    "from OCP.TopAbs import TopAbs_FACE",
    "from OCP.TopExp import TopExp_Explorer",
    "from OCP.BRep import BRep_Tool",
    "from OCP.BRepMesh import BRepMesh_IncrementalMesh",
    "from OCP.TopLoc import TopLoc_Location",
    "from OCP.IFSelect import IFSelect_RetDone",
    "",
    "DEFAULT_COLOR = [180, 180, 180, 255]",
    "",
    "def triangulate_face(face, linear=0.1, angular=0.5):",
    "    BRepMesh_IncrementalMesh(face, linear, False, angular, True)",
    "    loc = TopLoc_Location()",
    "    tri = BRep_Tool.Triangulation_s(face, loc)",
    "    if tri is None:",
    "        return None, None",
    "    n = tri.NbNodes()",
    "    verts = []",
    "    for i in range(1, n + 1):",
    "        p = tri.Node(i)",
    "        if not loc.IsIdentity():",
    "            p = p.Transformed(loc.Transformation())",
    "        verts.append([p.X(), p.Y(), p.Z()])",
    "    ntri = tri.NbTriangles()",
    "    faces = []",
    "    for i in range(1, ntri + 1):",
    "        t = tri.Triangle(i)",
    "        n1, n2, n3 = t.Get()",
    "        faces.append([n1 - 1, n2 - 1, n3 - 1])",
    "    return verts, faces",
    "",
    "sr = STEPControl_Reader()",
    "status = sr.ReadFile(step_out)",
    "if status != IFSelect_RetDone:",
    '    print(f"Failed to read intermediate STEP: {step_out}", file=sys.stderr)',
    "    sys.exit(1)",
    "sr.TransferRoots()",
    "shape = sr.OneShape()",
    "",
    "all_verts = []",
    "all_faces = []",
    "all_colors = []",
    "total_faces = 0",
    "",
    "exp = TopExp_Explorer(shape, TopAbs_FACE)",
    "while exp.More():",
    "    face = TopoDS.Face_s(exp.Current())",
    "    total_faces += 1",
    "    verts, faces = triangulate_face(face)",
    "    if verts and faces:",
    "        offset = len(all_verts)",
    "        all_verts.extend(verts)",
    "        for tri in faces:",
    "            all_faces.append([tri[0] + offset, tri[1] + offset, tri[2] + offset])",
    "        all_colors.extend([DEFAULT_COLOR] * len(verts))",
    "    exp.Next()",
    "",
    "if not all_verts or not all_faces:",
    '    print(f"No geometry extracted from STEP ({total_faces} faces scanned)", file=sys.stderr)',
    "    sys.exit(1)",
    "",
    'print(f"Triangulated: {total_faces} faces, {len(all_verts)} verts")',
    "",
    "verts_arr = np.array(all_verts, dtype=float)",
    "faces_arr = np.array(all_faces, dtype=int)",
    "colors_arr = np.array(all_colors, dtype=np.uint8)",
    "",
    "mesh = trimesh.Trimesh(",
    "    vertices=verts_arr,",
    "    faces=faces_arr,",
    "    visual=trimesh.visual.ColorVisuals(vertex_colors=colors_arr),",
    "    process=True,",
    ")",
    "mesh.fix_normals()",
    "scene = trimesh.Scene([mesh])",
    "",
    "result = scene.export(file_type='glb')",
    "if isinstance(result, bytes):",
    "    data = result",
    "elif isinstance(result, str):",
    "    with open(result, 'rb') as f:",
    "        data = f.read()",
    "else:",
    "    data = bytes(result)",
    "",
    "with open(out, 'wb') as f:",
    "    f.write(data)",
    "",
    "# Cleanup intermediate STEP",
    "try:",
    "    os.remove(step_out)",
    "except OSError:",
    "    pass",
    "",
    "print(f'Converted {src} -> {out} ({len(data)} bytes, {total_faces} faces)')",
  ].join("\n");
}

/**
 * FreeCAD-native CAD converter. Runs a script under FreeCADCmd that imports the
 * source with FreeCAD's native importers (SolidWorks, Parasolid, CATIA), exports
 * a STEP intermediate, then triangulates to GLB via OpenCASCADE.
 */
export class SldprtConverter implements ModelConverter {
  readonly id = "sldprt";
  readonly sourceExts = ["sldprt", "x_t", "x_b", "catpart", "catproduct"] as const;
  readonly targetExt = "glb" as const;

  constructor(private configuredCommand?: string) {}

  async getCacheKey(): Promise<string> {
    const invocation = await resolveConverterInvocation("freecadcmd", this.configuredCommand);
    return `${this.id}:${invocation.command} ${invocation.args.join(" ")}`.trim();
  }

  async convert(req: ConversionRequest): Promise<ConversionResult> {
    if (!isAbsolute(req.sourcePath)) {
      throw new Error(
        `Converter '${this.id}' requires an absolute source path, got '${req.sourcePath}'. ` +
        "Pass a file-system path to the conversion pipeline when invoking SLDPRT conversion.",
      );
    }

    const invocation = await resolveConverterInvocation("freecadcmd", this.configuredCommand);
    const sourceDir = dirname(req.sourcePath);
    const name = basename(req.sourcePath, extname(req.sourcePath));
    const outputPath = req.outputPath ?? join(sourceDir, `${name}.ai3d-converted.glb`);
    const scriptDir = join(tmpdir(), "ai3d-sldprt");
    const scriptPath = join(scriptDir, `${name}-${Date.now()}.py`);

    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(scriptDir, { recursive: true });
    await writeFile(scriptPath, buildFreeCadScript(req.sourcePath, outputPath), "utf8");

    log.info("run SLDPRT conversion (FreeCAD + OCP)", {
      sourcePath: req.sourcePath,
      outputPath,
      command: invocation.command,
      args: invocation.args,
    });

    try {
      const { stdout, stderr } = await execFileAsync(invocation.command, [...invocation.args, scriptPath], DEFAULT_TIMEOUT_MS);
      if (stdout) log.info("FreeCAD stdout", { stdout: stdout.trim().slice(0, 500) });
      if (stderr) log.warn("FreeCAD stderr", { stderr: stderr.trim().slice(0, 500) });
    } catch (error) {
      throw new Error(
        `CAD conversion failed for '${req.sourcePath}'. ` +
        `Ensure FreeCAD is installed (https://www.freecad.org/downloads.php). ` +
        `Set FreeCADCmd path in plugin settings or AI3D_FREECADCMD env var. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      void rm(scriptPath, { force: true });
    }

    if (!(await fileExists(outputPath))) {
      throw new Error(
        `CAD conversion finished but output was not found: '${outputPath}'. ` +
        "Check that FreeCAD can import this file format.",
      );
    }

    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength === 0) {
      throw new Error(`SLDPRT conversion output is empty: '${outputPath}'.`);
    }

    return {
      outputPath,
      outputExt: "glb",
      fromCache: false,
      warnings: ["Converted by local FreeCAD + OpenCASCADE bridge."],
    };
  }
}
