import { describe, expect, it } from "vitest";
import { shouldContinueThreeRenderLoop, ThreeSmoothnessTracker } from "./smoothness";

describe("Three smoothness tracker", () => {
  it("tracks render frame timing and slow frames", () => {
    const tracker = new ThreeSmoothnessTracker(5);
    for (const duration of [8, 10, 12, 30, 16, 20]) {
      tracker.recordRenderedFrame(duration, 28);
    }

    const snapshot = tracker.snapshot();
    expect(snapshot.renderedFrameCount).toBe(6);
    expect(snapshot.slowFrameCount).toBe(1);
    expect(snapshot.averageRenderMs).toBe(17.6);
    expect(snapshot.p95RenderMs).toBe(30);
    expect(snapshot.maxRenderMs).toBe(30);
  });

  it("tracks idle skips and adaptive changes", () => {
    const tracker = new ThreeSmoothnessTracker();
    tracker.recordIdleFrameSkip();
    tracker.recordIdleFrameSkip();
    tracker.recordAdaptiveScaleChange();

    expect(tracker.snapshot()).toMatchObject({
      idleFrameSkipCount: 2,
      adaptiveScaleChangeCount: 1,
    });
  });
});

describe("Three render loop activity", () => {
  const idleActivity = {
    cameraMoved: false,
    animating: false,
    renderDirty: false,
    renderObserverCount: 0,
    renderObserverSettleFrames: 0,
  };

  it("lets an idle settled preview sleep", () => {
    expect(shouldContinueThreeRenderLoop(idleActivity)).toBe(false);
  });

  it("keeps the loop alive for active camera, animation, dirty, or observer-settle work", () => {
    expect(shouldContinueThreeRenderLoop({ ...idleActivity, cameraMoved: true })).toBe(true);
    expect(shouldContinueThreeRenderLoop({ ...idleActivity, animating: true })).toBe(true);
    expect(shouldContinueThreeRenderLoop({ ...idleActivity, renderDirty: true })).toBe(true);
    expect(shouldContinueThreeRenderLoop({
      ...idleActivity,
      renderObserverCount: 1,
      renderObserverSettleFrames: 3,
    })).toBe(true);
  });

  it("does not keep the loop awake for observer settle frames when nobody observes renders", () => {
    expect(shouldContinueThreeRenderLoop({
      ...idleActivity,
      renderObserverSettleFrames: 3,
    })).toBe(false);
  });
});
