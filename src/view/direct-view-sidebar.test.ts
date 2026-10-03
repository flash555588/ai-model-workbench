import { describe, expect, it } from "vitest";
import { clampDirectSidebarWidth } from "./direct-view-sidebar";

describe("direct sidebar resize bounds", () => {
  it("keeps sidebar actions readable when dragged below the minimum", () => {
    expect(clampDirectSidebarWidth(48, 1000)).toBe(200);
  });
  it("reserves viewport space near the stacked-layout breakpoint", () => {
    expect(clampDirectSidebarWidth(400, 650)).toBe(366);
  });
  it("limits wide leaves without losing intermediate user widths", () => {
    expect(clampDirectSidebarWidth(700, 1400)).toBe(400);
    expect(clampDirectSidebarWidth(272, 1000)).toBe(272);
  });
  it("uses the default for non-finite requested widths", () => {
    expect(clampDirectSidebarWidth(Number.NaN, 1000)).toBe(200);
    expect(clampDirectSidebarWidth(Infinity, 1000)).toBe(200);
  });
});
