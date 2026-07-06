import type { App } from "obsidian";
import { TFile } from "obsidian";
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
}));

import { joinPortablePath, joinVaultConfigPath, readBinaryPath, resolveVaultAbsolutePath } from "./resolve-path";

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

  it("resolves desktop absolute paths when a vault base path exists", () => {
    const app = {
      vault: {
        adapter: {
          getBasePath: () => "/vault",
        },
      },
    } as unknown as App;

    expect(resolveVaultAbsolutePath(app, "models/test.glb")).toBe("/vault/models/test.glb");
  });

  it("leaves direct mobile-style vault paths unresolved when no base path exists", () => {
    const app = {
      vault: {},
    } as unknown as App;

    expect(resolveVaultAbsolutePath(app, "models/test.glb")).toBeNull();
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

  it("reads vault-relative paths through Obsidian without requiring Node fs", async () => {
    const file = new TFile();
    const data = new Uint8Array([7, 8, 9]).buffer;
    const readBinary = vi.fn(async () => data);
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn(() => file),
        readBinary,
      },
    } as unknown as App;

    const result = await readBinaryPath(app, "models/test.glb");

    expect(result).toBe(data);
    expect(readBinary).toHaveBeenCalledWith(file);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });
});
