import { describe, expect, it } from "vitest";
import {
  computeOrthographicHalfExtents,
  DEFAULT_VIEWPORT_FIT_MARGIN,
  fitDistanceForBoundingSphere,
  horizontalFovFromVertical,
  limitingFov,
  normalizeViewportAspect,
  shouldRefitForAspect,
} from "./viewport-fit";

describe("normalizeViewportAspect", () => {
  it("passes through usable aspects", () => {
    expect(normalizeViewportAspect(1.75)).toBeCloseTo(1.75, 10);
  });

  it("falls back to square for degenerate viewports", () => {
    // A collapsed pane reports 0 height, which would otherwise divide by zero.
    expect(normalizeViewportAspect(0)).toBe(1);
    expect(normalizeViewportAspect(-2)).toBe(1);
    expect(normalizeViewportAspect(Number.NaN)).toBe(1);
    expect(normalizeViewportAspect(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("limitingFov", () => {
  it("uses the vertical FOV on a wide viewport", () => {
    const vertical = (45 * Math.PI) / 180;
    expect(limitingFov(45, 2)).toBeCloseTo(vertical, 10);
  });

  it("uses the horizontal FOV on a tall viewport", () => {
    const horizontal = horizontalFovFromVertical((45 * Math.PI) / 180, 0.5);
    expect(limitingFov(45, 0.5)).toBeCloseTo(horizontal, 10);
    expect(limitingFov(45, 0.5)).toBeLessThan((45 * Math.PI) / 180);
  });

  it("treats a square viewport as isotropic", () => {
    expect(limitingFov(45, 1)).toBeCloseTo((45 * Math.PI) / 180, 10);
  });
});

describe("fitDistanceForBoundingSphere", () => {
  it("pulls back further as the viewport narrows", () => {
    const wide = fitDistanceForBoundingSphere(1, 45, 2);
    const square = fitDistanceForBoundingSphere(1, 45, 1);
    const tall = fitDistanceForBoundingSphere(1, 45, 0.4);

    expect(square).toBeGreaterThan(wide - 1e-9);
    expect(tall).toBeGreaterThan(square);
  });

  it("places the sphere tangent to the limiting frustum wall", () => {
    const radius = 3;
    const distance = fitDistanceForBoundingSphere(radius, 45, 1);
    // sin(halfFov) = radius / distance when the sphere is exactly framed.
    expect(Math.sin(limitingFov(45, 1) / 2)).toBeCloseTo(radius / distance, 10);
  });

  it("scales linearly with radius", () => {
    const single = fitDistanceForBoundingSphere(1, 45, 1.6);
    expect(fitDistanceForBoundingSphere(10, 45, 1.6)).toBeCloseTo(single * 10, 8);
  });

  it("returns a finite distance for degenerate input", () => {
    expect(Number.isFinite(fitDistanceForBoundingSphere(0, 45, 0))).toBe(true);
  });
});

describe("computeOrthographicHalfExtents", () => {
  it("shares a stable positive fit margin across projection modes", () => {
    expect(DEFAULT_VIEWPORT_FIT_MARGIN).toBeGreaterThan(1);
  });

  it("covers the span horizontally on a tall viewport", () => {
    const span = 4;
    const { halfWidth, halfHeight } = computeOrthographicHalfExtents(span, 0.5);

    // The narrow axis must still show the whole span, so width cannot shrink below it.
    expect(halfWidth).toBeGreaterThanOrEqual(span / 2 - 1e-9);
    expect(halfHeight).toBeGreaterThan(halfWidth);
  });

  it("carries the span on the vertical axis for a wide viewport", () => {
    const span = 4;
    const { halfWidth, halfHeight } = computeOrthographicHalfExtents(span, 2);

    expect(halfHeight).toBeCloseTo(span / 2, 10);
    expect(halfWidth).toBeCloseTo(span, 10);
  });

  it("keeps the frustum matching the viewport aspect", () => {
    for (const aspect of [0.25, 0.8, 1, 1.5, 3]) {
      const { halfWidth, halfHeight } = computeOrthographicHalfExtents(4, aspect);
      expect(halfWidth / halfHeight).toBeCloseTo(aspect, 10);
    }
  });

  it("never returns a zero extent", () => {
    const { halfWidth, halfHeight } = computeOrthographicHalfExtents(0, 1);
    expect(halfWidth).toBeGreaterThan(0);
    expect(halfHeight).toBeGreaterThan(0);
  });
});

describe("shouldRefitForAspect", () => {
  it("refits when there is no previous fit", () => {
    expect(shouldRefitForAspect(0, 1.5)).toBe(true);
  });

  it("ignores sub-threshold jitter", () => {
    expect(shouldRefitForAspect(1.5, 1.51)).toBe(false);
  });

  it("refits on a meaningful resize", () => {
    expect(shouldRefitForAspect(1.5, 0.6)).toBe(true);
  });

  it("ignores a degenerate new aspect", () => {
    // A collapsed pane should not overwrite a good fit with a garbage one.
    expect(shouldRefitForAspect(1.5, 0)).toBe(false);
  });
});
