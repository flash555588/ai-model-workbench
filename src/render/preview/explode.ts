import type { PreviewAxis, PreviewWorldPoint } from "./types";
import {
  clonePreviewWorldPoint,
  offsetPreviewWorldPointOnAxis,
} from "./geometry";

export interface PreviewExplodeState {
  originalPosition: PreviewWorldPoint;
  originalCenter: PreviewWorldPoint;
}

export interface PreviewExplodeAdapter<TPart> {
  getParts(): readonly TPart[];
  getRootCenter(): PreviewWorldPoint;
  getPartPosition(part: TPart): PreviewWorldPoint;
  getPartCenter(part: TPart): PreviewWorldPoint;
  setPartPosition(part: TPart, position: PreviewWorldPoint): void;
  getPartState(part: TPart): PreviewExplodeState | null;
  setPartState(part: TPart, state: PreviewExplodeState): void;
}

function clonePoint(point: PreviewWorldPoint): PreviewWorldPoint {
  return clonePreviewWorldPoint(point);
}

function createState(position: PreviewWorldPoint, center: PreviewWorldPoint): PreviewExplodeState {
  return {
    originalPosition: clonePoint(position),
    originalCenter: clonePoint(center),
  };
}

export function setPreviewExplode<TPart>(
  adapter: PreviewExplodeAdapter<TPart>,
  factor: number,
  axis: PreviewAxis,
): void {
  const rootCenter = adapter.getRootCenter();

  for (const part of adapter.getParts()) {
    let state = adapter.getPartState(part);
    if (!state) {
      state = createState(adapter.getPartPosition(part), adapter.getPartCenter(part));
      adapter.setPartState(part, state);
    }

    const delta = (state.originalCenter[axis] - rootCenter[axis]) * factor;
    adapter.setPartPosition(part, offsetPreviewWorldPointOnAxis(state.originalPosition, axis, delta));
  }
}

export function resetPreviewExplode<TPart>(adapter: PreviewExplodeAdapter<TPart>): void {
  for (const part of adapter.getParts()) {
    const state = adapter.getPartState(part);
    if (!state) continue;
    adapter.setPartPosition(part, state.originalPosition);
  }
}
