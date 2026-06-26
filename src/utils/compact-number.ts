export const PERSISTED_NUMBER_SIGNIFICANT_DIGITS = 6;

export function compactPersistedNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const compact = Number(value.toPrecision(PERSISTED_NUMBER_SIGNIFICANT_DIGITS));
  return Object.is(compact, -0) ? 0 : compact;
}

export function compactPersistedNumberTuple(values: readonly number[]): [number, number, number] {
  return [
    compactPersistedNumber(values[0]),
    compactPersistedNumber(values[1]),
    compactPersistedNumber(values[2]),
  ];
}

export function isCompactPersistedNumber(value: number): boolean {
  return Object.is(compactPersistedNumber(value), value);
}
