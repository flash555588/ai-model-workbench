export interface MeasurementMarkerEntry<TPoint, TMarker> {
  point: TPoint;
  marker: TMarker;
}

export class MeasurementMarkerRegistry<TPoint, TMarker> {
  private entries: Array<MeasurementMarkerEntry<TPoint, TMarker>> = [];

  get size(): number {
    return this.entries.length;
  }

  add(point: TPoint, marker: TMarker): number {
    this.entries.push({ point, marker });
    return this.entries.length - 1;
  }

  getPoint(index: number): TPoint | null {
    return this.entries[index]?.point ?? null;
  }

  getMarker(index: number): TMarker | null {
    return this.entries[index]?.marker ?? null;
  }

  getMarkers(): TMarker[] {
    return this.entries.map((entry) => entry.marker);
  }

  includesMarker(marker: TMarker): boolean {
    return this.entries.some((entry) => Object.is(entry.marker, marker));
  }

  indexOfMarker(marker: TMarker): number {
    return this.entries.findIndex((entry) => Object.is(entry.marker, marker));
  }

  findNearestIndex<TQuery>(
    query: TQuery,
    maxDistance: number,
    measureDistance: (point: TPoint, query: TQuery) => number,
  ): number {
    let nearestIndex = -1;
    let nearestDistance = Math.max(maxDistance, 0);
    for (let index = 0; index < this.entries.length; index++) {
      const distance = measureDistance(this.entries[index].point, query);
      if (!Number.isFinite(distance) || distance >= nearestDistance) continue;
      nearestIndex = index;
      nearestDistance = distance;
    }
    return nearestIndex;
  }

  forEach(callback: (entry: MeasurementMarkerEntry<TPoint, TMarker>, index: number) => void): void {
    this.entries.forEach(callback);
  }

  removeMarker(marker: TMarker): MeasurementMarkerEntry<TPoint, TMarker> | null {
    const index = this.indexOfMarker(marker);
    if (index < 0) return null;
    return this.entries.splice(index, 1)[0] ?? null;
  }

  drain(): Array<MeasurementMarkerEntry<TPoint, TMarker>> {
    return this.entries.splice(0);
  }
}
