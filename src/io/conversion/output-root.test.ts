import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

vi.mock("../../utils/node-shim", () => ({
  pathIsAbsolute: (path: string) => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path),
  pathJoin: (...segments: string[]) => segments.join("/"),
  pathNormalize: (path: string) => path.replace(/\\/g, "/"),
}));

import { resolveConversionOutputRoot } from "./output-root";

function makeApp(): App {
  return {
    vault: {
      configDir: ".custom-obsidian",
      adapter: {
        getBasePath: () => "/vault",
      },
    },
  } as unknown as App;
}

describe("resolveConversionOutputRoot", () => {
  it("uses the active config folder when no auxiliary folder is configured", () => {
    expect(resolveConversionOutputRoot(makeApp(), { auxiliaryFileFolder: "" }))
      .toBe("/vault/.custom-obsidian/ai-model-workbench/converted-assets");
  });

  it("uses the configured auxiliary vault folder when set", () => {
    expect(resolveConversionOutputRoot(makeApp(), { auxiliaryFileFolder: "AI3D/Side Files" }))
      .toBe("/vault/AI3D/Side Files");
  });
});
