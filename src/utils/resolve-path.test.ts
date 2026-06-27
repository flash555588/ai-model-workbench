import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

vi.mock("./node-shim", () => ({
  readFile: fsMocks.readFile,
  pathIsAbsolute: (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path),
  pathJoin: (...segments: string[]) => segments.join("/"),
  pathNormalize: (path: string) => path.replace(/\\/g, "/"),
}));

import { joinPortablePath, joinVaultConfigPath, readBinaryPath } from "./resolve-path";

describe("portable path helpers", () => {
  it("resolves encoded parent-directory resource URIs from the model folder", () => {
    expect(joinPortablePath("models/nested", "../textures/panel%20diffuse.png?cache=1"))
      .toBe("models/textures/panel diffuse.png");
  });

  it("normalizes direct relative resources without escaping above the vault root", () => {
    expect(joinPortablePath("models", "./Geometry%20Data.BIN")).toBe("models/Geometry Data.BIN");
    expect(joinPortablePath("", "../outside.bin")).toBe("outside.bin");
  });

  it("joins plugin config paths using the vault config directory", () => {
    const app = {
      vault: {
        configDir: ".custom-obsidian",
      },
    } as App;

    expect(joinVaultConfigPath(app, "ai-model-workbench/converted-assets"))
      .toBe(".custom-obsidian/ai-model-workbench/converted-assets");
  });
});

describe("readBinaryPath", () => {
  beforeEach(() => {
    fsMocks.readFile.mockReset();
  });

  it("returns absolute-path file buffers without copying when the view covers the full buffer", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fsMocks.readFile.mockResolvedValue(bytes);

    const result = await readBinaryPath({} as App, "/vault/models/large.glb");

    expect(result).toBe(bytes.buffer);
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
  });

  it("trims offset file views to the exact model bytes", async () => {
    const backing = new Uint8Array([99, 1, 2, 3, 100]);
    fsMocks.readFile.mockResolvedValue(backing.subarray(1, 4));

    const result = await readBinaryPath({} as App, "C:\\vault\\models\\large.glb");

    expect(result).not.toBe(backing.buffer);
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3]);
  });
});
