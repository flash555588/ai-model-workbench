import { describe, expect, it } from "vitest";
import { MeasurementOverlayController, type MeasurementMarkerVisualState } from "./measurement-overlay";
import { MeasurementSessionController } from "./measurement-session";

interface TestMarker {
  id: number;
  point: number;
  state: MeasurementMarkerVisualState;
}

interface TestSegment {
  start: number;
  end: number;
  lineUpdates: number;
  labelUpdates: number;
}

function createHarness() {
  const session = new MeasurementSessionController<object, number>();
  const disposedMarkers: TestMarker[] = [];
  const disposedSegments: TestSegment[] = [];
  let markerId = 0;
  let previewVisible = false;
  const overlay = new MeasurementOverlayController<object, number, TestMarker, TestSegment>(session, {
    clonePoint: (point) => point,
    isSamePoint: (left, right) => Math.abs(left - right) < 0.0001,
    measureMarkerDistance: (left, right) => Math.abs(left - right),
    createMarker: (point) => ({ id: ++markerId, point, state: "default" }),
    disposeMarker: (marker) => disposedMarkers.push(marker),
    setMarkerState: (marker, state) => {
      marker.state = state;
    },
    updateMarkerPosition: (marker, point) => {
      marker.point = point * 2;
    },
    createSegment: (start, end) => ({ start, end, lineUpdates: 0, labelUpdates: 0 }),
    disposeSegment: (segment) => disposedSegments.push(segment),
    updateSegmentLine: (segment) => {
      segment.lineUpdates += 1;
    },
    updateSegmentLabel: (segment) => {
      segment.labelUpdates += 1;
    },
    ensurePreviewLine: () => {
      previewVisible = true;
    },
    removePreviewLine: () => {
      previewVisible = false;
    },
  });
  return {
    session,
    overlay,
    disposedMarkers,
    disposedSegments,
    isPreviewVisible: () => previewVisible,
  };
}

describe("MeasurementOverlayController", () => {
  it("owns endpoint pairing, marker state, and completed segment creation", () => {
    const harness = createHarness();

    expect(harness.overlay.selectPoint(2, 0.5)).toBe("started");
    expect(harness.session.pendingPoint).toBe(2);
    expect(harness.overlay.getMarkers()[0]?.state).toBe("pending");
    expect(harness.isPreviewVisible()).toBe(true);

    expect(harness.overlay.selectPoint(8, 0.5)).toBe("completed");
    expect(harness.session.pendingPoint).toBeNull();
    expect(harness.overlay.markerCount).toBe(2);
    expect(harness.overlay.getMarkers().map((marker) => marker.state)).toEqual(["default", "default"]);
    expect(harness.overlay.getSegments()).toEqual([{ start: 2, end: 8, lineUpdates: 0, labelUpdates: 0 }]);
    expect(harness.isPreviewVisible()).toBe(false);
  });

  it("reuses nearby endpoints and ignores a zero-length completion", () => {
    const harness = createHarness();

    harness.overlay.selectPoint(2, 0.5);
    expect(harness.overlay.selectPoint(2.1, 0.5)).toBe("ignored");
    expect(harness.overlay.markerCount).toBe(1);
    expect(harness.overlay.segmentCount).toBe(0);

    expect(harness.overlay.selectPoint(8, 0.5)).toBe("completed");
    expect(harness.overlay.selectPoint(2.2, 0.5)).toBe("started");
    expect(harness.overlay.markerCount).toBe(2);
    expect(harness.session.pendingPoint).toBe(2);
  });

  it("removes orphan pending markers but retains markers used by completed segments", () => {
    const harness = createHarness();

    harness.overlay.selectPoint(2, 0.5);
    expect(harness.overlay.cancelPendingPoint()).toBe(true);
    expect(harness.overlay.markerCount).toBe(0);
    expect(harness.disposedMarkers).toHaveLength(1);

    harness.overlay.selectPoint(2, 0.5);
    harness.overlay.selectPoint(8, 0.5);
    harness.overlay.selectPoint(2.1, 0.5);
    expect(harness.overlay.cancelPendingPoint()).toBe(true);
    expect(harness.overlay.markerCount).toBe(2);
    expect(harness.disposedMarkers).toHaveLength(1);
    expect(harness.overlay.getMarkers()[0]?.state).toBe("default");
  });

  it("coordinates hover precedence and backend refresh callbacks", () => {
    const harness = createHarness();
    harness.overlay.selectPoint(2, 0.5);
    const firstMarker = harness.overlay.getMarkers()[0];

    expect(harness.overlay.setHoveredMarker(firstMarker)).toBe(true);
    expect(firstMarker.state).toBe("hover");
    expect(harness.overlay.setHoveredMarker(firstMarker)).toBe(false);
    expect(harness.overlay.setHoveredMarker(null)).toBe(true);
    expect(firstMarker.state).toBe("pending");

    harness.overlay.selectPoint(8, 0.5);
    expect(firstMarker.state).toBe("default");

    harness.overlay.updateMarkerPositions();
    harness.overlay.updateSegmentLines();
    harness.overlay.updateSegmentLabels();
    expect(firstMarker.point).toBe(4);
    expect(harness.overlay.getSegments()[0]).toMatchObject({ lineUpdates: 1, labelUpdates: 1 });
  });

  it("disposes all backend primitives when cleared", () => {
    const harness = createHarness();
    harness.overlay.selectPoint(2, 0.5);
    harness.overlay.selectPoint(8, 0.5);

    expect(harness.overlay.clear()).toBe(true);
    expect(harness.overlay.markerCount).toBe(0);
    expect(harness.overlay.segmentCount).toBe(0);
    expect(harness.disposedMarkers).toHaveLength(2);
    expect(harness.disposedSegments).toHaveLength(1);
    expect(harness.overlay.clear()).toBe(false);
  });
});
