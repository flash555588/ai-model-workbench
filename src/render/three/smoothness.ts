import {
  PreviewSmoothnessTracker,
  type PreviewSmoothnessSnapshot,
} from "../preview/smoothness";

export type ThreeSmoothnessSnapshot = PreviewSmoothnessSnapshot;

/** Frame-timing tracker shared with the Babylon backend. */
export const ThreeSmoothnessTracker = PreviewSmoothnessTracker;
export type ThreeSmoothnessTracker = PreviewSmoothnessTracker;

export interface ThreeRenderLoopActivity {
  cameraMoved: boolean;
  animating: boolean;
  renderDirty: boolean;
  renderObserverCount: number;
  renderObserverSettleFrames: number;
}

export function shouldContinueThreeRenderLoop(activity: ThreeRenderLoopActivity): boolean {
  return activity.cameraMoved
    || activity.animating
    || activity.renderDirty
    || (activity.renderObserverCount > 0 && activity.renderObserverSettleFrames > 0);
}
