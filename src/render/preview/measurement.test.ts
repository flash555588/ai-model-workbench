import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrDeactivateMeasurement,
  createBoundsMeasurementScale,
  createMeasurementDraftingLayout,
  createMeasurementGeometryEdgesFromTriangles,
  createMeasurementLabel,
  createMeasurementMarkdown,
  createMeasurementReading,
  createMeasurementState,
  createMeasurementTrianglesFromIndices,
  createReferenceMeasurementScale,
  drawMeasurementLabelCanvas,
  formatMeasurementNumber,
  formatMeasurementValue,
  normalizeMeasurementUnit,
  sanitizeMeasurementScale,
  scaleMeasurementPointFromBase,
  setMeasurementCanvasActive,
  snapMeasurementPointToGeometry,
  unscaleMeasurementPointToBase,
} from "./measurement";
import type { MeasurementPhase, MeasurementPreview, MeasurementState } from "./types";

describe("measurement helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sanitizes invalid scale values", () => {
    expect(sanitizeMeasurementScale({ x: 2, y: -1, z: Number.NaN })).toEqual({ x: 2, y: 1, z: 1 });
  });

  it("normalizes unsupported units to millimeters", () => {
    expect(normalizeMeasurementUnit("μm")).toBe("um");
    expect(normalizeMeasurementUnit("\u00b5m")).toBe("um");
    expect(normalizeMeasurementUnit("\u03bcm")).toBe("um");
    expect(normalizeMeasurementUnit("cm")).toBe("cm");
    expect(normalizeMeasurementUnit("inch")).toBe("mm");
  });

  it("formats micrometer values with an ascii unit label", () => {
    expect(formatMeasurementValue(0.0004, "mm")).toBe("0.4 um");
    expect(formatMeasurementValue(12, "um", false)).toBe("12 um");
  });

  it("formats calibration numbers without unnecessary trailing zeros", () => {
    expect(formatMeasurementNumber(12)).toBe("12");
    expect(formatMeasurementNumber(12.3456)).toBe("12.35");
    expect(formatMeasurementNumber(0.1256)).toBe("0.126");
  });

  it("creates a uniform calibration scale from a measured reference distance", () => {
    expect(createReferenceMeasurementScale({ x: 1, y: 1, z: 1 }, 12.5, 25)).toEqual({ x: 2, y: 2, z: 2 });
    expect(createReferenceMeasurementScale({ x: 2, y: 3, z: 4 }, 10, 5)).toEqual({ x: 1, y: 1.5, z: 2 });
    expect(createReferenceMeasurementScale({ x: 1, y: 1, z: 1 }, 0, 25)).toBeNull();
    expect(createReferenceMeasurementScale({ x: 1, y: 1, z: 1 }, 12.5, -1)).toBeNull();
  });

  it("round trips calibrated model points between base and displayed space", () => {
    const pivot = { x: 1, y: 2, z: 3 };
    const base = { x: 4, y: 6, z: 9 };
    const scale = { x: 2, y: 2, z: 2 };
    const displayed = scaleMeasurementPointFromBase(base, pivot, scale);

    expect(displayed).toEqual({ x: 7, y: 10, z: 15 });
    expect(unscaleMeasurementPointToBase(displayed, pivot, scale)).toEqual(base);
  });

  it("keeps post-calibration picks in calibrated physical units", () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const scale = { x: 2, y: 2, z: 2 };
    const displayStart = scaleMeasurementPointFromBase({ x: 0, y: 0, z: 0 }, pivot, scale);
    const displayEnd = scaleMeasurementPointFromBase({ x: 3, y: 4, z: 0 }, pivot, scale);
    const baseStart = unscaleMeasurementPointToBase(displayStart, pivot, scale);
    const baseEnd = unscaleMeasurementPointToBase(displayEnd, pivot, scale);
    const reading = createMeasurementReading(baseStart, baseEnd, scale, "cm");

    expect(reading.distance).toBe(10);
    expect(reading.unit).toBe("cm");
  });

  it("snaps measurement points to the nearest mesh vertex", () => {
    const snapped = snapMeasurementPointToGeometry(
      { x: 0.05, y: 0.02, z: 0 },
      {
        vertices: [
          { point: { x: 0, y: 0, z: 0 }, targetId: "mesh-a" },
          { point: { x: 1, y: 0, z: 0 }, targetId: "mesh-a" },
        ],
        edges: [],
        vertexRadius: 0.2,
      },
    );

    expect(snapped?.kind).toBe("vertex");
    expect(snapped?.point).toEqual({ x: 0, y: 0, z: 0 });
    expect(snapped?.targetId).toBe("mesh-a");
  });

  it("projects measurement points onto triangle edges", () => {
    const snapped = snapMeasurementPointToGeometry(
      { x: 0.5, y: 0.2, z: 0 },
      {
        vertices: [
          { point: { x: 0, y: 0, z: 0 } },
          { point: { x: 1, y: 0, z: 0 } },
        ],
        edges: [
          { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        ],
        vertexRadius: 0.05,
      },
    );

    expect(snapped?.kind).toBe("edge");
    expect(snapped?.point.x).toBeCloseTo(0.5);
    expect(snapped?.point.y).toBeCloseTo(0);
    expect(snapped?.point.z).toBeCloseTo(0);
  });

  it("prefers vertices over edges within the corner radius", () => {
    const snapped = snapMeasurementPointToGeometry(
      { x: 0.03, y: 0.02, z: 0 },
      {
        vertices: [
          { point: { x: 0, y: 0, z: 0 } },
          { point: { x: 1, y: 0, z: 0 } },
        ],
        edges: [
          { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        ],
        vertexRadius: 0.05,
      },
    );

    expect(snapped?.kind).toBe("vertex");
    expect(snapped?.point).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("uses edge projection once the pointer is outside the corner radius", () => {
    const snapped = snapMeasurementPointToGeometry(
      { x: -0.06, y: 0, z: 0 },
      {
        vertices: [
          { point: { x: 0, y: 0, z: 0 } },
          { point: { x: 1, y: 0, z: 0 } },
        ],
        edges: [
          { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        ],
        vertexRadius: 0.05,
      },
    );

    expect(snapped?.kind).toBe("edge");
    expect(snapped?.point).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("rejects geometry snaps beyond the target snap distance", () => {
    const snapped = snapMeasurementPointToGeometry(
      { x: 3, y: 3, z: 0 },
      {
        vertices: [
          { point: { x: 0, y: 0, z: 0 } },
        ],
        edges: [
          { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        ],
        vertexRadius: 0.05,
        maxDistance: 0.5,
      },
    );

    expect(snapped).toBeNull();
  });

  it("creates geometry snap edges from indexed and non-indexed triangles without face diagonals", () => {
    const squareVertices = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    const indexedTriangles = createMeasurementTrianglesFromIndices(4, [0, 1, 2, 0, 2, 3]);
    const indexedEdges = createMeasurementGeometryEdgesFromTriangles(squareVertices, indexedTriangles, "square");
    const nonIndexedVertices = [
      squareVertices[0],
      squareVertices[1],
      squareVertices[2],
      squareVertices[0],
      squareVertices[2],
      squareVertices[3],
    ];
    const nonIndexedTriangles = createMeasurementTrianglesFromIndices(6, null);
    const nonIndexedEdges = createMeasurementGeometryEdgesFromTriangles(nonIndexedVertices, nonIndexedTriangles, "square");

    expect(indexedTriangles).toEqual([[0, 1, 2], [0, 2, 3]]);
    expect(nonIndexedTriangles).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(indexedEdges).toHaveLength(4);
    expect(nonIndexedEdges).toHaveLength(4);
    expect(indexedEdges.every((edge) => edge.targetId === "square")).toBe(true);
    expect(nonIndexedEdges.every((edge) => edge.targetId === "square")).toBe(true);
    expect(indexedEdges).not.toContainEqual({
      start: { x: 1, y: 1, z: 0 },
      end: { x: 0, y: 0, z: 0 },
      targetId: "square",
    });
  });

  it("keeps spatially shared crease edges when triangle normals differ", () => {
    const creaseVertices = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    const edges = createMeasurementGeometryEdgesFromTriangles(
      creaseVertices,
      createMeasurementTrianglesFromIndices(6, null),
      "crease",
    );

    expect(edges).toHaveLength(5);
    expect(edges).toContainEqual({
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 0, z: 0 },
      targetId: "crease",
    });
  });

  it("creates drafting dimension lines with extensions and arrowheads", () => {
    const layout = createMeasurementDraftingLayout(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      {
        viewPosition: { x: 5, y: 0, z: 10 },
        viewUp: { x: 0, y: 1, z: 0 },
        offset: 2,
        extensionGap: 0.4,
        extensionOvershoot: 0.5,
        arrowLength: 1,
        arrowWidth: 0.4,
        labelGap: 0.6,
      },
    );

    expect(layout?.lineSegments).toHaveLength(7);
    expect(layout?.lineSegments[0][0]).toEqual({ x: 0, y: 0.4, z: 0 });
    expect(layout?.lineSegments[0][1]).toEqual({ x: 0, y: 2.5, z: 0 });
    expect(layout?.lineSegments[2]).toEqual([
      { x: 0, y: 2, z: 0 },
      { x: 10, y: 2, z: 0 },
    ]);
    expect(layout?.labelPoint).toEqual({ x: 5, y: 2.6, z: 0 });
  });

  it("creates locked bounds scale from a single known axis", () => {
    expect(createBoundsMeasurementScale(
      { x: 10, y: 20, z: 30 },
      { x: 100 },
      { x: 1, y: 1, z: 1 },
      true,
    )).toEqual({ x: 10, y: 10, z: 10 });
  });

  it("creates per-axis bounds scale while preserving untouched axes", () => {
    expect(createBoundsMeasurementScale(
      { x: 10, y: 20, z: 30 },
      { y: 100 },
      { x: 2, y: 2, z: 2 },
      false,
    )).toEqual({ x: 2, y: 5, z: 2 });
    expect(createBoundsMeasurementScale(
      { x: 10, y: 20, z: 30 },
      {},
      { x: 2, y: 2, z: 2 },
      false,
    )).toBeNull();
  });

  it("derives measurement phases from active, pending, and record state", () => {
    const base = {
      unit: "mm" as const,
      scale: { x: 1, y: 1, z: 1 },
      bounds: null,
    };
    const record = {
      index: 1,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 0, z: 0 },
      reading: createMeasurementReading(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        "mm",
      ),
    };

    expect(createMeasurementState({ ...base, active: false, pending: false, records: [] }).phase).toBe("inactive");
    expect(createMeasurementState({ ...base, active: true, pending: false, records: [] }).phase).toBe("select-target");
    expect(createMeasurementState({ ...base, active: true, pending: false, records: [], targetLocked: true }).phase).toBe("ready");
    expect(createMeasurementState({ ...base, active: true, pending: true, records: [] }).phase).toBe("picking-end");
    expect(createMeasurementState({ ...base, active: false, pending: false, records: [record] }).phase).toBe("reviewing");
    expect(createMeasurementState({ ...base, active: true, pending: false, records: [record], targetLocked: true }).phase).toBe("ready");
  });

  it("handles Escape by canceling pending picks or leaving inactive previews alone", () => {
    expect(runMeasurementEscape({ active: false, phase: "inactive" })).toEqual({ handled: false, calls: [] });
    expect(runMeasurementEscape({ active: true, phase: "picking-end" })).toEqual({ handled: true, calls: ["cancel"] });
    expect(runMeasurementEscape({ active: true, phase: "ready" })).toEqual({ handled: true, calls: ["toggle"] });
  });

  it("triggers a focus aggregation class when measurement activates", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout });
    const canvas = createFakeCanvas();

    setMeasurementCanvasActive(canvas, true);

    expect(canvas.classList.contains("ai3d-measurement-active")).toBe(true);
    expect(canvas.classList.contains("ai3d-measurement-focus-aggregation")).toBe(true);
    expect(canvas.getBoundingClientRect).toHaveBeenCalled();

    vi.advanceTimersByTime(1100);

    expect(canvas.classList.contains("ai3d-measurement-active")).toBe(true);
    expect(canvas.classList.contains("ai3d-measurement-focus-aggregation")).toBe(false);

    setMeasurementCanvasActive(canvas, false);

    expect(canvas.classList.contains("ai3d-measurement-active")).toBe(false);
    expect(canvas.classList.contains("ai3d-measurement-focus-aggregation")).toBe(false);
  });

  it("creates distance and axis-delta labels from calibrated scale", () => {
    const reading = createMeasurementReading(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 12 },
      { x: 2, y: 1, z: 0.5 },
      "mm",
    );
    const label = createMeasurementLabel(reading);

    expect(reading.distance).toBeCloseTo(Math.sqrt(6 * 6 + 4 * 4 + 6 * 6));
    expect(label.primary).toContain("mm");
    expect(label.secondary).toContain("X 6");
    expect(label.secondary).toContain("Y 4");
    expect(label.secondary).toContain("Z 6");
  });

  it("draws scene labels with a compact drafting tag", () => {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push("beginPath"),
      clearRect: () => calls.push("clearRect"),
      closePath: () => calls.push("closePath"),
      fill: () => calls.push("fill"),
      fillRect: () => calls.push("fillRect"),
      fillText: () => calls.push("fillText"),
      lineTo: () => calls.push("lineTo"),
      moveTo: () => calls.push("moveTo"),
      quadraticCurveTo: () => calls.push("quadraticCurveTo"),
      stroke: () => calls.push("stroke"),
      strokeText: () => calls.push("strokeText"),
    } as unknown as CanvasRenderingContext2D;

    drawMeasurementLabelCanvas(ctx, { primary: "12 mm", secondary: "X 12  Y 0  Z 0  mm" });

    expect(calls).toContain("clearRect");
    expect(calls).toContain("beginPath");
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
    expect(calls.filter((call) => call === "fillText")).toHaveLength(1);
    expect(calls).not.toContain("strokeText");
    expect(calls).not.toContain("fillRect");
  });

  it("exports measurement records as Markdown", () => {
    const reading = createMeasurementReading(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 10, y: 10, z: 10 },
      "cm",
    );
    const markdown = createMeasurementMarkdown([
      { index: 1, start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, reading },
    ]);

    expect(markdown).toContain("## Measurements");
    expect(markdown).toContain("| # | Distance | Delta X | Delta Y | Delta Z | Start | End |");
    expect(markdown).toContain("10 cm");
  });
});

function createFakeCanvas(): HTMLCanvasElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (...tokens: string[]) => {
        for (const token of tokens) classes.add(token);
      },
      remove: (...tokens: string[]) => {
        for (const token of tokens) classes.delete(token);
      },
      toggle: (token: string, force?: boolean) => {
        const next = force ?? !classes.has(token);
        if (next) {
          classes.add(token);
        } else {
          classes.delete(token);
        }
        return next;
      },
      contains: (token: string) => classes.has(token),
    },
    dataset: {},
    getBoundingClientRect: vi.fn(() => ({ width: 320, height: 180 })),
  } as unknown as HTMLCanvasElement;
}

function runMeasurementEscape(state: { active: boolean; phase: MeasurementPhase }): { handled: boolean; calls: string[] } {
  const calls: string[] = [];
  const previewState: MeasurementState = {
    active: state.active,
    phase: state.phase,
    records: [],
    unit: "mm",
    scale: { x: 1, y: 1, z: 1 },
    bounds: null,
  };
  const preview = {
    cancelMeasurement: () => {
      calls.push("cancel");
    },
    toggleMeasurement: () => {
      calls.push("toggle");
      return false;
    },
    getMeasurementState: () => previewState,
  } as MeasurementPreview;

  return { handled: cancelOrDeactivateMeasurement(preview), calls };
}
