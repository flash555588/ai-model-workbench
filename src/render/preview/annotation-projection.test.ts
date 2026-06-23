import { describe, expect, it, vi } from "vitest";
import {
  createAnnotationViewportProvider,
  formatAnnotationCameraStateKey,
  projectNormalizedDevicePointToCanvas,
  projectViewportPointToCanvas,
} from "./annotation-projection";

describe("annotation projection helpers", () => {
  it("formats camera state keys with stable precision", () => {
    expect(formatAnnotationCameraStateKey([
      { value: 1.23456, digits: 3 },
      { value: 9.87654, digits: 2 },
      { value: -0.004, digits: 2 },
    ])).toBe("1.235_9.88_-0.00");
  });

  it("projects normalized device coordinates onto the canvas", () => {
    const result = { screenX: 0, screenY: 0, depth: 0 };
    const projected = projectNormalizedDevicePointToCanvas(
      { x: 0.25, y: -0.5, z: 0.4 },
      { clientWidth: 200, clientHeight: 100 },
      result,
    );

    expect(projected).toBe(true);
    expect(result).toEqual({ screenX: 125, screenY: 75, depth: 0.7 });
  });

  it("scales viewport projection coordinates onto the canvas", () => {
    const result = { screenX: 0, screenY: 0, depth: 0 };
    const projected = projectViewportPointToCanvas(
      { x: 300, y: 150, z: 0.25 },
      600,
      300,
      { clientWidth: 200, clientHeight: 100 },
      result,
    );

    expect(projected).toBe(true);
    expect(result).toEqual({ screenX: 100, screenY: 50, depth: 0.25 });
  });

  it("rejects invalid projection inputs and zero-sized canvases", () => {
    const result = { screenX: 0, screenY: 0, depth: 0 };

    expect(projectNormalizedDevicePointToCanvas(
      { x: Number.NaN, y: 0, z: 0 },
      { clientWidth: 200, clientHeight: 100 },
      result,
    )).toBe(false);

    expect(projectViewportPointToCanvas(
      { x: 10, y: 20, z: 0 },
      0,
      300,
      { clientWidth: 200, clientHeight: 100 },
      result,
    )).toBe(false);
  });

  it("creates annotation providers from delegated callbacks", () => {
    const callback = vi.fn();
    const remove = vi.fn();
    const observeRender = vi.fn(() => ({ remove }));
    const projectWorldPoint = vi.fn(() => true);
    const isWorldPointOccluded = vi.fn(() => false);
    const getCameraStateKey = vi.fn(() => "camera-key");
    const canvas = { clientWidth: 200, clientHeight: 100 } as HTMLCanvasElement;

    const provider = createAnnotationViewportProvider({
      canvas,
      observeRender,
      getCameraStateKey,
      projectWorldPoint,
      isWorldPointOccluded,
    });

    const subscription = provider.observeRender(callback);
    const projection = { screenX: 0, screenY: 0, depth: 0 };

    expect(provider.canvas).toBe(canvas);
    expect(provider.getCameraStateKey()).toBe("camera-key");
    expect(provider.projectWorldPoint({ x: 1, y: 2, z: 3 }, projection)).toBe(true);
    expect(provider.isWorldPointOccluded({ x: 4, y: 5, z: 6 })).toBe(false);
    expect(observeRender).toHaveBeenCalledWith(callback);
    subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
