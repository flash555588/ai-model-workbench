import { describe, expect, it } from "vitest";
import { MeasurementMarkerRegistry } from "./measurement-markers";

describe("MeasurementMarkerRegistry", () => {
  it("keeps marker and point data paired through lookup and removal", () => {
    const registry = new MeasurementMarkerRegistry<number, object>();
    const firstMarker = {};
    const secondMarker = {};

    registry.add(10, firstMarker);
    registry.add(20, secondMarker);

    expect(registry.size).toBe(2);
    expect(registry.getPoint(1)).toBe(20);
    expect(registry.getMarker(0)).toBe(firstMarker);
    expect(registry.getMarkers()).toEqual([firstMarker, secondMarker]);
    expect(registry.includesMarker(secondMarker)).toBe(true);
    expect(registry.indexOfMarker(secondMarker)).toBe(1);

    expect(registry.removeMarker(firstMarker)).toEqual({ point: 10, marker: firstMarker });
    expect(registry.getPoint(0)).toBe(20);
    expect(registry.getMarker(0)).toBe(secondMarker);
  });

  it("finds the nearest point inside a strict distance threshold", () => {
    const registry = new MeasurementMarkerRegistry<number, string>();
    registry.add(10, "first");
    registry.add(14, "second");
    registry.add(30, "third");

    expect(registry.findNearestIndex(13, 5, (point, query) => Math.abs(point - query))).toBe(1);
    expect(registry.findNearestIndex(20, 6, (point, query) => Math.abs(point - query))).toBe(-1);
    expect(registry.findNearestIndex(20, 6.1, (point, query) => Math.abs(point - query))).toBe(1);
  });

  it("drains all entries for renderer-owned disposal", () => {
    const registry = new MeasurementMarkerRegistry<number, string>();
    registry.add(1, "first");
    registry.add(2, "second");

    expect(registry.drain()).toEqual([
      { point: 1, marker: "first" },
      { point: 2, marker: "second" },
    ]);
    expect(registry.size).toBe(0);
    expect(registry.drain()).toEqual([]);
  });
});
