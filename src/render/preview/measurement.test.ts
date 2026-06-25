import { describe, expect, it } from "vitest";
import {
  createMeasurementLabel,
  createMeasurementMarkdown,
  createMeasurementReading,
  formatMeasurementValue,
  normalizeMeasurementUnit,
  sanitizeMeasurementScale,
} from "./measurement";

describe("measurement helpers", () => {
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
