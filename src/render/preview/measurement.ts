import type { MeasurementScale, MeasurementUnit, PreviewWorldPoint } from "./types";

export interface MeasurementReading {
  distance: number;
  delta: PreviewWorldPoint;
  absDelta: PreviewWorldPoint;
  unit: MeasurementUnit;
}

export interface MeasurementRecord {
  index: number;
  start: PreviewWorldPoint;
  end: PreviewWorldPoint;
  reading: MeasurementReading;
}

const UNIT_FACTORS_TO_METERS: Record<MeasurementUnit, number> = {
  um: 0.000001,
  mm: 0.001,
  cm: 0.01,
  m: 1,
};

const UNIT_LABELS: Record<MeasurementUnit, string> = {
  um: "μm",
  mm: "mm",
  cm: "cm",
  m: "m",
};

export function normalizeMeasurementUnit(unit: string | undefined): MeasurementUnit {
  switch (unit) {
    case "μm":
      return "um";
    case "um":
    case "mm":
    case "cm":
    case "m":
      return unit;
    default:
      return "mm";
  }
}

export function sanitizeMeasurementScale(scale: MeasurementScale): MeasurementScale {
  return {
    x: Number.isFinite(scale.x) && scale.x > 0 ? scale.x : 1,
    y: Number.isFinite(scale.y) && scale.y > 0 ? scale.y : 1,
    z: Number.isFinite(scale.z) && scale.z > 0 ? scale.z : 1,
  };
}

export function createMeasurementReading(
  start: PreviewWorldPoint,
  end: PreviewWorldPoint,
  scale: MeasurementScale,
  unit: MeasurementUnit,
): MeasurementReading {
  const safeScale = sanitizeMeasurementScale(scale);
  const delta = {
    x: (end.x - start.x) * safeScale.x,
    y: (end.y - start.y) * safeScale.y,
    z: (end.z - start.z) * safeScale.z,
  };
  const absDelta = {
    x: Math.abs(delta.x),
    y: Math.abs(delta.y),
    z: Math.abs(delta.z),
  };
  return {
    distance: Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z),
    delta,
    absDelta,
    unit,
  };
}

function formatNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

function chooseDisplayUnit(value: number, unit: MeasurementUnit): MeasurementUnit {
  if (value === 0) return unit;
  const meters = Math.abs(value) * UNIT_FACTORS_TO_METERS[unit];
  if (meters < 0.001) return "um";
  if (meters < 0.1) return "mm";
  if (meters < 1) return "cm";
  return "m";
}

export function formatMeasurementValue(value: number, unit: MeasurementUnit, autoUnit = true): string {
  const displayUnit = autoUnit ? chooseDisplayUnit(value, unit) : unit;
  const converted = value * UNIT_FACTORS_TO_METERS[unit] / UNIT_FACTORS_TO_METERS[displayUnit];
  const abs = Math.abs(converted);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return `${formatNumber(converted, decimals)} ${UNIT_LABELS[displayUnit]}`;
}

export function formatMeasurementAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return formatNumber(abs, decimals);
}

export function createMeasurementLabel(reading: MeasurementReading): { primary: string; secondary: string } {
  return {
    primary: formatMeasurementValue(reading.distance, reading.unit),
    secondary: [
      `X ${formatMeasurementAxisValue(reading.absDelta.x)}`,
      `Y ${formatMeasurementAxisValue(reading.absDelta.y)}`,
      `Z ${formatMeasurementAxisValue(reading.absDelta.z)}`,
      UNIT_LABELS[reading.unit],
    ].join("  "),
  };
}

export function createMeasurementMarkdown(records: readonly MeasurementRecord[]): string {
  if (records.length === 0) return "";
  const lines = [
    "## Measurements",
    "",
    "| # | Distance | Delta X | Delta Y | Delta Z | Start | End |",
    "|---|----------|---------|---------|---------|-------|-----|",
  ];
  for (const record of records) {
    const unit = record.reading.unit;
    const start = formatPoint(record.start);
    const end = formatPoint(record.end);
    lines.push([
      record.index,
      formatMeasurementValue(record.reading.distance, unit),
      formatMeasurementValue(record.reading.absDelta.x, unit, false),
      formatMeasurementValue(record.reading.absDelta.y, unit, false),
      formatMeasurementValue(record.reading.absDelta.z, unit, false),
      start,
      end,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return lines.join("\n");
}

function formatPoint(point: PreviewWorldPoint): string {
  return `${formatNumber(point.x, 3)}, ${formatNumber(point.y, 3)}, ${formatNumber(point.z, 3)}`;
}
