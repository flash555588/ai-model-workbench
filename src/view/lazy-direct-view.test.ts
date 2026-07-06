import { describe, expect, it } from "vitest";
import { shouldDeferDirectAutoload } from "./direct-autoload-policy";

function makeFile(extension: string, size: number) {
  return {
    extension,
    stat: {
      size,
    },
  };
}

describe("shouldDeferDirectAutoload", () => {
  it("always defers conversion-backed direct file formats until the user confirms loading", () => {
    expect(shouldDeferDirectAutoload(makeFile("step", 1024), { restoredFromWorkspace: false })).toBe(true);
    expect(shouldDeferDirectAutoload(makeFile("stp", 1024), { restoredFromWorkspace: true })).toBe(true);
  });

  it("defers direct formats that are configured to prefer conversion", () => {
    expect(shouldDeferDirectAutoload(makeFile("obj", 1024), {
      restoredFromWorkspace: false,
      preferConversionExts: ["obj"],
    })).toBe(true);
  });

  it("allows normal direct formats to autoload when opened intentionally", () => {
    expect(shouldDeferDirectAutoload(makeFile("glb", 25 * 1024 * 1024), { restoredFromWorkspace: false })).toBe(false);
  });

  it("defers large direct formats when restored with the workspace", () => {
    expect(shouldDeferDirectAutoload(makeFile("glb", 10 * 1024 * 1024), { restoredFromWorkspace: true })).toBe(true);
  });

  it("autoloads small direct formats restored with the workspace", () => {
    expect(shouldDeferDirectAutoload(makeFile("obj", 1024 * 1024), { restoredFromWorkspace: true })).toBe(false);
  });
});
