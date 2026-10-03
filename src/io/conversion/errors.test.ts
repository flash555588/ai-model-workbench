import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../i18n";
import { describeModelLoadFailure, ThreeRendererRequiredError } from "./errors";

afterEach(() => setLocale("en"));

describe("Three-only format feedback", () => {
  it.each(["en", "zh-CN"] as const)("explains how to enable the renderer in %s", (locale) => {
    setLocale(locale);
    const failure = describeModelLoadFailure(new ThreeRendererRequiredError("pcd"));
    expect(failure.level).toBe("warning");
    expect(failure.message).toContain(".pcd");
    expect(failure.message).toContain("Three.js");
    expect(failure.hint).toContain(locale === "en" ? "Reading + file view" : "阅读 + 文件视图");
  });
});
