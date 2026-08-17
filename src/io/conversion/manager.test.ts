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

  it("keeps a timed-out conversion registered until the underlying job settles", async () => {
    vi.useFakeTimers();
    const manager = new ConversionManager();
    let calls = 0;
    let finish!: (result: ConversionResult) => void;
    manager.registerConverter({
      id: "mock",
      sourceExts: [".test"],
      targetExt: "glb",
      getCacheKey: async () => "key",
      convert: () => {
        calls++;
        return new Promise<ConversionResult>((resolve) => { finish = resolve; });
      },
    });
    const req: ConversionRequest = {
      sourcePath: "/in/model.test",
      sourceExt: ".test",
      targetExt: "glb",
      timeoutMs: 25,
    };

    const first = manager.convert(req);
    const firstAssertion = expect(first).rejects.toThrow(ConversionTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await firstAssertion;

    const retry = manager.convert({ ...req, timeoutMs: 1_000 });
    finish(successResult);
    await expect(retry).resolves.toBe(successResult);
    expect(calls).toBe(1);
    vi.useRealTimers();
  });
});
