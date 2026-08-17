import { MeasurementMarkerRegistry } from "./measurement-markers";
import type { MeasurementSessionController } from "./measurement-session";

export type MeasurementMarkerVisualState = "default" | "pending" | "hover";

export interface MeasurementOverlaySegment<TPoint> {
  start: TPoint;
  end: TPoint;
}

export interface MeasurementOverlayDrawingAdapter<
  TPoint,
  TMarker,
  TSegment extends MeasurementOverlaySegment<TPoint>,
> {
  clonePoint(point: TPoint): TPoint;
  isSamePoint(left: TPoint, right: TPoint): boolean;
  measureMarkerDistance(left: TPoint, right: TPoint): number;
  createMarker(point: TPoint): TMarker;
  disposeMarker(marker: TMarker): void;
  setMarkerState(marker: TMarker, state: MeasurementMarkerVisualState): void;
  updateMarkerPosition(marker: TMarker, point: TPoint): void;
  createSegment(start: TPoint, end: TPoint): TSegment;
  disposeSegment(segment: TSegment): void;
  updateSegmentLine(segment: TSegment): void;
  updateSegmentLabel(segment: TSegment): void;
  ensurePreviewLine(): void;
  removePreviewLine(): void;
}

export type MeasurementOverlayPointResult = "started" | "completed" | "ignored";

export class MeasurementOverlayController<
  TTarget,
  TPoint,
  TMarker,
  TSegment extends MeasurementOverlaySegment<TPoint>,
> {
  private readonly markers = new MeasurementMarkerRegistry<TPoint, TMarker>();
  private readonly segments: TSegment[] = [];
  private pendingMarker: TMarker | null = null;
  private hoveredMarkerIndex = -1;

  constructor(
    private readonly session: MeasurementSessionController<TTarget, TPoint>,
    private readonly adapter: MeasurementOverlayDrawingAdapter<TPoint, TMarker, TSegment>,
  ) {}

  get markerCount(): number {
    return this.markers.size;
  }

  get segmentCount(): number {
    return this.segments.length;
  }

  getMarkers(): TMarker[] {
    return this.markers.getMarkers();
  }

  getSegments(): readonly TSegment[] {
    return this.segments.slice();
  }

  includesMarker(marker: TMarker): boolean {
    return this.markers.includesMarker(marker);
  }

  selectPoint(point: TPoint, markerReuseDistance: number): MeasurementOverlayPointResult {
    const existingIndex = this.markers.findNearestIndex(
      point,
      markerReuseDistance,
      (left, right) => this.adapter.measureMarkerDistance(left, right),
    );
    const existingPoint = this.markers.getPoint(existingIndex);
    const usePoint = this.adapter.clonePoint(existingPoint ?? point);
    const transition = this.session.selectPoint(
      usePoint,
      (left, right) => this.adapter.isSamePoint(left, right),
    );
    if (transition.kind === "ignored") return "ignored";

    const marker = existingIndex >= 0
      ? this.markers.getMarker(existingIndex)
      : this.addMarker(usePoint);
    if (marker === null) {
      this.session.cancelPendingPoint();
      return "ignored";
    }

    if (transition.kind === "started") {
      this.pendingMarker = marker;
      this.applyMarkerState(marker);
      this.adapter.ensurePreviewLine();
      return "started";
    }

    const previousPendingMarker = this.pendingMarker;
    this.segments.push(this.adapter.createSegment(transition.start, transition.end));
    this.pendingMarker = null;
    if (previousPendingMarker !== null) {
      this.applyMarkerState(previousPendingMarker);
    }
    this.applyMarkerState(marker);
    this.adapter.removePreviewLine();
    return "completed";
  }

  setHoveredMarker(marker: TMarker | null): boolean {
    const nextIndex = marker === null ? -1 : this.markers.indexOfMarker(marker);
    if (nextIndex === this.hoveredMarkerIndex) return false;

    const previousMarker = this.markers.getMarker(this.hoveredMarkerIndex);
    this.hoveredMarkerIndex = nextIndex;
    if (previousMarker !== null) {
      this.applyMarkerState(previousMarker);
    }
    const nextMarker = this.markers.getMarker(nextIndex);
    if (nextMarker !== null) {
      this.applyMarkerState(nextMarker);
    }
    return true;
  }

  cancelPendingPoint(): boolean {
    const pendingPoint = this.session.cancelPendingPoint();
    const pendingMarker = this.pendingMarker;
    this.pendingMarker = null;
    this.hoveredMarkerIndex = -1;
    this.adapter.removePreviewLine();

    if (pendingMarker !== null && pendingPoint !== null && !this.isPointUsed(pendingPoint)) {
      this.markers.removeMarker(pendingMarker);
      this.adapter.disposeMarker(pendingMarker);
    } else if (pendingMarker !== null) {
      this.applyMarkerState(pendingMarker);
    }
    return pendingPoint !== null;
  }

  updateMarkerPositions(): void {
    this.markers.forEach(({ point, marker }) => {
      this.adapter.updateMarkerPosition(marker, point);
    });
  }

  updateSegmentLines(): void {
    for (const segment of this.segments) {
      this.adapter.updateSegmentLine(segment);
    }
  }

  updateSegmentLabels(): void {
    for (const segment of this.segments) {
      this.adapter.updateSegmentLabel(segment);
    }
  }

  clear(): boolean {
    const hadContent = this.session.hasPendingPoint || this.markers.size > 0 || this.segments.length > 0;
    this.cancelPendingPoint();
    for (const segment of this.segments.splice(0)) {
      this.adapter.disposeSegment(segment);
    }
    for (const { marker } of this.markers.drain()) {
      this.adapter.disposeMarker(marker);
    }
    this.pendingMarker = null;
    this.hoveredMarkerIndex = -1;
    return hadContent;
  }

  private addMarker(point: TPoint): TMarker {
    const marker = this.adapter.createMarker(point);
    this.markers.add(this.adapter.clonePoint(point), marker);
    return marker;
  }

  private applyMarkerState(marker: TMarker): void {
    const markerIndex = this.markers.indexOfMarker(marker);
    const state: MeasurementMarkerVisualState = markerIndex === this.hoveredMarkerIndex
      ? "hover"
      : marker === this.pendingMarker
        ? "pending"
        : "default";
    this.adapter.setMarkerState(marker, state);
  }

  private isPointUsed(point: TPoint): boolean {
    return this.segments.some((segment) =>
      this.adapter.isSamePoint(segment.start, point) || this.adapter.isSamePoint(segment.end, point));
  }
}
