import { createMeasurementState } from "./measurement";
import type {
  MeasurementRecord,
  MeasurementScale,
  MeasurementSnapKind,
  MeasurementState,
  MeasurementUnit,
  PreviewWorldPoint,
} from "./types";

export interface MeasurementSessionStateOptions {
  records: MeasurementRecord[];
  unit: MeasurementUnit;
  scale: MeasurementScale;
  bounds: PreviewWorldPoint | null;
  targetName?: string | null;
  targetScope?: "model" | "part";
}

export type MeasurementPointTransition<TPoint> =
  | { kind: "started"; point: TPoint }
  | { kind: "completed"; start: TPoint; end: TPoint }
  | { kind: "ignored"; point: TPoint };

export class MeasurementSessionController<TTarget, TPoint> {
  private activeValue = false;
  private targetValue: TTarget | null = null;
  private pendingPointValue: TPoint | null = null;
  private snapKindValue: MeasurementSnapKind | null = null;
  private readonly observers = new Set<() => void>();

  get active(): boolean {
    return this.activeValue;
  }

  setActive(active: boolean): void {
    this.activeValue = active;
  }

  get target(): TTarget | null {
    return this.targetValue;
  }

  setTarget(target: TTarget | null): void {
    this.targetValue = target;
  }

  get pendingPoint(): TPoint | null {
    return this.pendingPointValue;
  }

  get hasPendingPoint(): boolean {
    return this.pendingPointValue !== null;
  }

  selectPoint(
    point: TPoint,
    isSamePoint: (left: TPoint, right: TPoint) => boolean,
  ): MeasurementPointTransition<TPoint> {
    const pendingPoint = this.pendingPointValue;
    if (pendingPoint === null) {
      this.pendingPointValue = point;
      return { kind: "started", point };
    }
    if (isSamePoint(pendingPoint, point)) {
      return { kind: "ignored", point };
    }

    this.pendingPointValue = null;
    return { kind: "completed", start: pendingPoint, end: point };
  }

  cancelPendingPoint(): TPoint | null {
    const pendingPoint = this.pendingPointValue;
    this.pendingPointValue = null;
    return pendingPoint;
  }

  get snapKind(): MeasurementSnapKind | null {
    return this.snapKindValue;
  }

  setSnapKind(kind: MeasurementSnapKind | null, notify = true): boolean {
    if (this.snapKindValue === kind) return false;
    this.snapKindValue = kind;
    if (notify) this.notify();
    return true;
  }

  createState(options: MeasurementSessionStateOptions): MeasurementState {
    return createMeasurementState({
      active: this.activeValue,
      pending: this.pendingPointValue !== null,
      records: options.records,
      unit: options.unit,
      scale: options.scale,
      bounds: options.bounds,
      targetLocked: this.targetValue !== null,
      targetName: options.targetName,
      targetScope: options.targetScope,
      snapKind: this.snapKindValue,
    });
  }

  observe(callback: () => void): () => void {
    this.observers.add(callback);
    callback();
    return () => {
      this.observers.delete(callback);
    };
  }

  notify(): void {
    for (const callback of Array.from(this.observers)) {
      callback();
    }
  }

  clearObservers(): void {
    this.observers.clear();
  }
}
