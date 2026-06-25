import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { ConversionManager, ConversionTimeoutError } from "./manager";
import type { ConversionRequest, ConversionResult, ModelConverter } from "./types";

function createMockConverter(
  delayMs: number,
  result: ConversionResult,
): ModelConverter {
  return {
    id: "mock",
    sourceExts: [".test"],
    targetExt: "glb",
    getCacheKey: async () => "mock-cache-key",
    convert: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return result;
    },
  };
}

const successResult: ConversionResult = {
  outputPath: "/out/mock.glb",
  outputExt: "glb",
  fromCache: false,
  warnings: [],
};

describe("ConversionManager", () => {
  beforeAll(() => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("converts a supported file", async () => {
    const manager = new ConversionManager();
    manager.registerConverter(createMockConverter(0, successResult));
    const result = await manager.convert({
      sourcePath: "/in/model.test",
      sourceExt: ".test",
      targetExt: "glb",
    });
    expect(result.outputPath).toBe("/out/mock.glb");
  });

  it("throws when no converter is registered", async () => {
    const manager = new ConversionManager();
    await expect(
      manager.convert({
        sourcePath: "/in/model.unknown",
        sourceExt: ".unknown",
        targetExt: "glb",
      }),
    ).rejects.toThrow("No converter registered");
  });

  it("times out a hanging conversion", async () => {
    const manager = new ConversionManager();
    manager.registerConverter(createMockConverter(10_000, successResult));
    await expect(
      manager.convert({
        sourcePath: "/in/model.test",
        sourceExt: ".test",
        targetExt: "glb",
        timeoutMs: 50,
      }),
    ).rejects.toThrow(ConversionTimeoutError);
  });

  it("deduplicates concurrent conversions for the same source", async () => {
    const manager = new ConversionManager();
    let calls = 0;
    manager.registerConverter({
      id: "mock",
      sourceExts: [".test"],
      targetExt: "glb",
      getCacheKey: async () => "key",
      convert: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return successResult;
      },
    });
    const req: ConversionRequest = {
      sourcePath: "/in/model.test",
      sourceExt: ".test",
      targetExt: "glb",
    };
    const [a, b] = await Promise.all([manager.convert(req), manager.convert(req)]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
