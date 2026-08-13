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

describe("preview perspective camera fit with viewport aspect", () => {
  const unitBounds = () => createPreviewBounds(
    { x: -0.5, y: -0.5, z: -0.5 },
    { x: 0.5, y: 0.5, z: 0.5 },
  );

  const fitDistance = (aspect: number): number => {
    const fit = createPreviewPerspectiveCameraFit(unitBounds(), { aspect, fovDegrees: 45 });
    return Math.hypot(
      fit.position.x - fit.target.x,
      fit.position.y - fit.target.y,
      fit.position.z - fit.target.z,
    );
  };

  it("pulls the camera back on a narrow viewport", () => {
    // A tall pane has the tighter horizontal FOV, so the model needs more distance.
    expect(fitDistance(0.4)).toBeGreaterThan(fitDistance(1));
    expect(fitDistance(1)).toBeGreaterThan(fitDistance(2.5) - 1e-9);
  });

  it("keeps the whole bounding sphere inside the frustum", () => {
    for (const aspect of [0.35, 0.75, 1, 1.9, 3.2]) {
      const distance = fitDistance(aspect);
      const vFov = (45 * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const radius = Math.hypot(0.5, 0.5, 0.5);
      // Half-extent of the view at the model's centre, on the limiting axis.
      const visibleHalfExtent = distance * Math.tan(Math.min(vFov, hFov) / 2);
      expect(visibleHalfExtent).toBeGreaterThan(radius);
    }
  });

  it("preserves the default view direction", () => {
    const fit = createPreviewPerspectiveCameraFit(unitBounds(), { aspect: 1.6, fovDegrees: 45 });
    const dx = fit.position.x - fit.target.x;
    const dy = fit.position.y - fit.target.y;
    const dz = fit.position.z - fit.target.z;

    expect(dx).toBeCloseTo(dz, 10);
    expect(dy / dx).toBeCloseTo(0.65, 10);
  });

  it("keeps the model between the near and far planes", () => {
    const fit = createPreviewPerspectiveCameraFit(unitBounds(), { aspect: 0.5, fovDegrees: 45 });
    const distance = fitDistance(0.5);
    const radius = Math.hypot(0.5, 0.5, 0.5);

    expect(fit.near).toBeLessThan(distance - radius);
    expect(fit.far).toBeGreaterThan(distance + radius);
  });

  it("matches legacy framing when aspect is omitted", () => {
    // Without an aspect the span-based framing is used verbatim: span 1 * 1.8.
    const legacy = createPreviewPerspectiveCameraFit(unitBounds());

    expect(legacy.position.x).toBeCloseTo(1.8, 10);
    expect(legacy.position.y).toBeCloseTo(1.8 * 0.65, 10);
    expect(legacy.position.z).toBeCloseTo(1.8, 10);
  });
});
