import { describe, expect, it } from "vitest";
import { createPreviewBounds } from "./bounds";
import { createPreviewPerspectiveCameraFit } from "./camera-fit";

describe("preview perspective camera fit", () => {
  it("keeps tiny models on their real scale", () => {
    const fit = createPreviewPerspectiveCameraFit(createPreviewBounds(
      { x: 0, y: 0, z: 0 },
      { x: 0.001, y: 0.001, z: 0.001 },
    ));

    expect(fit.position.x).toBeLessThan(0.01);
    expect(fit.near).toBeLessThan(0.001);
    expect(fit.far).toBeLessThanOrEqual(1);
  });

  it("fits ordinary models without an excessive far plane", () => {
    const fit = createPreviewPerspectiveCameraFit(createPreviewBounds(
      { x: -0.5, y: -0.5, z: -0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
    ));

    expect(fit.near).toBeGreaterThan(0);
    expect(fit.far).toBeLessThan(100);
    expect(fit.far / fit.near).toBeLessThan(25000);
  });

  it("scales far plane for large models", () => {
    const fit = createPreviewPerspectiveCameraFit(createPreviewBounds(
      { x: -500, y: -250, z: -100 },
      { x: 500, y: 250, z: 100 },
    ));

    expect(fit.position.x).toBeGreaterThan(1000);
    expect(fit.far).toBeGreaterThan(10000);
    expect(fit.near).toBeGreaterThanOrEqual(1);
  });
});
