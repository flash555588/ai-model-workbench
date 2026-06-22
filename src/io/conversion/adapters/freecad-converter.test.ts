import { beforeEach, describe, expect, it, vi } from "vitest";
import { FreecadConverter } from "./freecad-converter";

type ExecOutput = string | { toString(): string };
type ExecCallback = (error: Error | null, stdout?: ExecOutput, stderr?: ExecOutput) => void;

const nodeShim = vi.hoisted(() => ({
  access: vi.fn<() => Promise<void>>(),
  mkdir: vi.fn<() => Promise<void>>(),
  readFile: vi.fn<() => Promise<Uint8Array>>(),
  rm: vi.fn<() => Promise<void>>(),
  writeFile: vi.fn<(path: string, content: string, encoding: string) => Promise<void>>(),
  execFile: vi.fn((_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(null, "", "");
  }),
}));

const resolveConverterInvocation = vi.hoisted(() => vi.fn(async () => ({
  command: "python",
  args: ["-I"],
})));

vi.mock("../../../utils/node-shim", () => ({
  F_OK: 0,
  access: nodeShim.access,
  mkdir: nodeShim.mkdir,
  readFile: nodeShim.readFile,
  rm: nodeShim.rm,
  writeFile: nodeShim.writeFile,
  execFile: nodeShim.execFile,
  osTmpdir: () => "/tmp",
  pathIsAbsolute: (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path),
  pathJoin: (...segments: string[]) => segments.join("/").replace(/\/+/g, "/"),
  pathDirname: (path: string) => path.replace(/[\\/][^\\/]*$/, "") || "/",
  pathBasename: (path: string, ext?: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  },
  pathExtname: (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? "";
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index) : "";
  },
}));

vi.mock("../command-discovery", () => ({
  resolveConverterInvocation,
}));

function latestScript(): string {
  const call = nodeShim.writeFile.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call?.[1] ?? "";
}

describe("FreecadConverter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodeShim.access.mockResolvedValue(undefined);
    nodeShim.mkdir.mockResolvedValue(undefined);
    nodeShim.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    nodeShim.rm.mockResolvedValue(undefined);
    nodeShim.writeFile.mockResolvedValue(undefined);
    resolveConverterInvocation.mockResolvedValue({ command: "python", args: ["-I"] });
  });

  it("requires absolute source paths before writing conversion scripts", async () => {
    const converter = new FreecadConverter("python");

    await expect(converter.convert({
      sourcePath: "models/gear.step",
      sourceExt: "step",
      targetExt: "glb",
    })).rejects.toThrow("requires an absolute source path");

    expect(nodeShim.writeFile).not.toHaveBeenCalled();
    expect(nodeShim.execFile).not.toHaveBeenCalled();
  });

  it("writes a STEP script with OCCT glTF writer and ai3d metadata postprocessing", async () => {
    const converter = new FreecadConverter("python");

    const result = await converter.convert({
      sourcePath: "/vault/models/gear.step",
      sourceExt: "step",
      targetExt: "glb",
    });
    const script = latestScript();

    expect(result).toEqual({
      outputPath: "/vault/models/gear.ai3d-converted.glb",
      outputExt: "glb",
      fromCache: false,
      warnings: ["Converted by local Python/CadQuery(OCCT) bridge."],
    });
    expect(nodeShim.mkdir).toHaveBeenCalledWith("/tmp/ai3d-freecad", { recursive: true });
    expect(nodeShim.writeFile.mock.calls[0]?.[0]).toMatch(/^\/tmp\/ai3d-freecad\/gear-\d+\.py$/);
    expect(nodeShim.writeFile.mock.calls[0]?.[2]).toBe("utf8");
    expect(nodeShim.execFile).toHaveBeenCalledWith(
      "python",
      ["-I", expect.stringMatching(/^\/tmp\/ai3d-freecad\/gear-\d+\.py$/)],
      expect.objectContaining({ timeout: 300_000, windowsHide: true }),
      expect.any(Function),
    );
    expect(script).toContain('source_ext = "step"');
    expect(script).toContain("STEPCAFControl_Reader");
    expect(script).toContain("RWGltf_CafWriter");
    expect(script).toContain("postprocess_occt_glb");
    expect(script).toContain("extras.setdefault('ai3d', {})");
    expect(script).toContain("componentPath");
  });

  it("writes an IGES script without STEP-only XDE export flow", async () => {
    const converter = new FreecadConverter("python");

    await converter.convert({
      sourcePath: "/vault/models/bracket.iges",
      sourceExt: "iges",
      targetExt: "glb",
    });
    const script = latestScript();

    expect(script).toContain('source_ext = "iges"');
    expect(script).toContain("IGESControl_Reader");
    expect(script).toContain("from OCP.BRepTools import BRepTools");
    expect(script).not.toContain("STEPCAFControl_Reader");
    expect(script).not.toContain("RWGltf_CafWriter");
    expect(script).not.toContain("convert_step_to_glb");
  });

  it("surfaces missing or empty converter output after the process exits", async () => {
    const converter = new FreecadConverter("python");
    nodeShim.access.mockRejectedValueOnce(new Error("missing"));

    await expect(converter.convert({
      sourcePath: "/vault/models/missing.step",
      sourceExt: "step",
      targetExt: "glb",
    })).rejects.toThrow("output was not found");

    nodeShim.access.mockResolvedValue(undefined);
    nodeShim.readFile.mockResolvedValueOnce(new Uint8Array());

    await expect(converter.convert({
      sourcePath: "/vault/models/empty.step",
      sourceExt: "step",
      targetExt: "glb",
    })).rejects.toThrow("output is empty");
  });
});
