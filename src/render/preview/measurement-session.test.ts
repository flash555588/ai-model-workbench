import { describe, expect, it, vi } from "vitest";
import { MeasurementSessionController } from "./measurement-session";

describe("MeasurementSessionController", () => {
  it("derives target-selection and endpoint phases from shared session state", () => {
    const session = new MeasurementSessionController<object, object>();

    expect(session.createState(createStateOptions()).phase).toBe("inactive");

    session.setActive(true);
    expect(session.createState(createStateOptions()).phase).toBe("select-target");

    session.setTarget({});
    expect(session.createState(createStateOptions()).phase).toBe("ready");
    session.selectPoint({}, () => false);
    expect(session.createState(createStateOptions()).phase).toBe("picking-end");
  });

  it("reports the locked target and current snap kind", () => {
    const target = {};
    const session = new MeasurementSessionController<object, object>();
    session.setActive(true);
    session.setTarget(target);
    session.setSnapKind("edge", false);

    const state = session.createState(createStateOptions({
      targetName: "Cubie 022",
      targetScope: "part",
    }));

    expect(session.target).toBe(target);
    expect(state).toMatchObject({
      active: true,
      targetLocked: true,
      targetName: "Cubie 022",
      targetScope: "part",
      snapKind: "edge",
    });
  });

  it("notifies immediately on subscription and only when snap status changes", () => {
    const session = new MeasurementSessionController<object, object>();
    const observer = vi.fn();
    const unsubscribe = session.observe(observer);

    expect(observer).toHaveBeenCalledTimes(1);
    expect(session.setSnapKind("vertex")).toBe(true);
    expect(session.setSnapKind("vertex")).toBe(false);
    expect(observer).toHaveBeenCalledTimes(2);

    session.notify();
    expect(observer).toHaveBeenCalledTimes(3);
    session.clearObservers();
    session.notify();
    expect(observer).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("starts, rejects, and completes endpoint pairs without losing pending state", () => {
    const session = new MeasurementSessionController<object, number>();

    expect(session.selectPoint(10, (left, right) => left === right)).toEqual({
      kind: "started",
      point: 10,
    });
    expect(session.pendingPoint).toBe(10);
    expect(session.hasPendingPoint).toBe(true);

    expect(session.selectPoint(10, (left, right) => left === right)).toEqual({
      kind: "ignored",
      point: 10,
    });
    expect(session.pendingPoint).toBe(10);

    expect(session.selectPoint(15, (left, right) => left === right)).toEqual({
      kind: "completed",
      start: 10,
      end: 15,
    });
    expect(session.pendingPoint).toBeNull();
    expect(session.hasPendingPoint).toBe(false);
  });

  it("returns and clears a canceled pending endpoint", () => {
    const session = new MeasurementSessionController<object, number>();
    session.selectPoint(10, () => false);

    expect(session.cancelPendingPoint()).toBe(10);
    expect(session.cancelPendingPoint()).toBeNull();
  });
});

function createStateOptions(overrides: {
  targetName?: string | null;
  targetScope?: "model" | "part";
} = {}) {
  return {
    records: [],
    unit: "mm" as const,
    scale: { x: 1, y: 1, z: 1 },
    bounds: null,
    targetName: overrides.targetName,
    targetScope: overrides.targetScope,
  };
}
