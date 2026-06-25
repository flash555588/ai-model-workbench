export interface ThreeSmoothnessSnapshot {
  renderedFrameCount: number;
  idleFrameSkipCount: number;
  slowFrameCount: number;
  averageRenderMs: number;
  p95RenderMs: number;
  maxRenderMs: number;
  adaptiveScaleChangeCount: number;
}

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

export class ThreeSmoothnessTracker {
  private readonly samples: number[] = [];
  private renderedFrameCount = 0;
  private idleFrameSkipCount = 0;
  private slowFrameCount = 0;
  private maxRenderMs = 0;
  private adaptiveScaleChangeCount = 0;

  constructor(private readonly maxSamples = 120) {}

  recordRenderedFrame(durationMs: number, slowThresholdMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.renderedFrameCount++;
    if (durationMs >= slowThresholdMs) {
      this.slowFrameCount++;
    }
    this.maxRenderMs = Math.max(this.maxRenderMs, durationMs);
    this.samples.push(durationMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  recordIdleFrameSkip(): void {
    this.idleFrameSkipCount++;
  }

  recordAdaptiveScaleChange(): void {
    this.adaptiveScaleChangeCount++;
  }

  snapshot(): ThreeSmoothnessSnapshot {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const total = this.samples.reduce((sum, value) => sum + value, 0);
    const p95Index = sorted.length === 0 ? -1 : Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
      renderedFrameCount: this.renderedFrameCount,
      idleFrameSkipCount: this.idleFrameSkipCount,
      slowFrameCount: this.slowFrameCount,
      averageRenderMs: sorted.length ? Number((total / sorted.length).toFixed(2)) : 0,
      p95RenderMs: p95Index >= 0 ? Number(sorted[p95Index].toFixed(2)) : 0,
      maxRenderMs: Number(this.maxRenderMs.toFixed(2)),
      adaptiveScaleChangeCount: this.adaptiveScaleChangeCount,
    };
  }
}
