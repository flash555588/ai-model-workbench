import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/node-shim", () => ({
  F_OK: 0,
  X_OK: 1,
  access: vi.fn(async () => {
    throw new Error("missing");
  }),
  execFile: vi.fn(),
  getRuntimeProcess: () => ({
    platform: "win32",
    env: {
      PATH: "",
      PATHEXT: ".EXE;.CMD",
    },
  }),
  pathDelimiter: ";",
  pathExtname: (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot) : "";
  },
  pathIsAbsolute: (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/"),
  pathJoin: (...segments: string[]) => segments.filter(Boolean).join("\\"),
  stat: vi.fn(async () => ({
    isFile: () => false,
  })),
}));

import { inspectConverterCommand, resolveConverterInvocation } from "./command-discovery";

describe("converter command discovery", () => {
  it("marks configured commands with shell metacharacters unavailable", async () => {
    const status = await inspectConverterCommand("fbx2gltf", "FBX2glTF.exe; calc.exe");

    expect(status.available).toBe(false);
    expect(status.source).toBe("settings");
    expect(status.detail).toBe("Command contains unsafe shell metacharacters.");
    expect(status.checkedCandidates).toEqual(["FBX2glTF.exe;"]);
  });

  it("refuses to resolve unsafe configured commands before execution", async () => {
    await expect(
      resolveConverterInvocation("freecad", "python3 && echo leaked"),
    ).rejects.toThrow("Refusing to resolve converter command 'freecad': Command contains unsafe shell metacharacters.");
  });

  it("does not treat quoted Windows paths as unsafe shell syntax", async () => {
    const status = await inspectConverterCommand("fbx2gltf", "\"C:\\Program Files (x86)\\FBX2glTF\\FBX2glTF.exe\"");

    expect(status.available).toBe(false);
    expect(status.executable).toBe("C:\\Program Files (x86)\\FBX2glTF\\FBX2glTF.exe");
    expect(status.detail).toBe("Configured path was not found or is not executable.");
  });
});
