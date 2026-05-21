export interface PreviewDisassemblyController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): boolean;
  toggle(): boolean;
  reset(): void;
  dispose(): void;
}

export interface PreviewDisassemblySubscriptions {
  onPointerDown(target: unknown, event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onRender(): void;
}

export interface PreviewDisassemblyAdapter<TPart, TTransform, TDragState> {
  getParts(): readonly TPart[];
  getPartId(part: TPart): number | string;
  isDisposed(part: TPart): boolean;
  captureTransform(part: TPart): TTransform;
  restoreTransform(part: TPart, transform: TTransform): void;
  subscribe(subscriptions: PreviewDisassemblySubscriptions): () => void;
  resolvePart(target: unknown): TPart | null;
  setSelected(part: TPart | null): void;
  beginDrag(part: TPart, event: PointerEvent): TDragState | null;
  updateDrag(state: TDragState, event: PointerEvent): void;
  endDrag(state: TDragState | null): void;
  updateSelectionOcclusion(part: TPart): void;
}

class PreviewDisassemblySessionController<TPart, TTransform, TDragState> implements PreviewDisassemblyController {
  private readonly adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>;
  private readonly originals = new Map<number | string, TTransform>();
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private drag: TDragState | null = null;
  private selected: TPart | null = null;
  private frameCount = 0;

  constructor(adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>) {
    this.adapter = adapter;
    for (const part of adapter.getParts()) {
      this.originals.set(adapter.getPartId(part), adapter.captureTransform(part));
    }
  }

  isEnabled(): boolean {
    return this.active;
  }

  setEnabled(enabled: boolean): boolean {
    if (this.active === enabled) return this.active;
    this.active = enabled;
    this.finishDrag();
    this.setSelected(null);

    if (enabled) {
      this.unsubscribe = this.adapter.subscribe({
        onPointerDown: (target, event) => this.handlePointerDown(target, event),
        onPointerMove: (event) => this.handlePointerMove(event),
        onPointerUp: (event) => this.handlePointerUp(event),
        onRender: () => this.handleRender(),
      });
    } else {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }

    return this.active;
  }

  toggle(): boolean {
    return this.setEnabled(!this.active);
  }

  reset(): void {
    this.finishDrag();
    this.setSelected(null);
    for (const part of this.adapter.getParts()) {
      if (this.adapter.isDisposed(part)) continue;
      const original = this.originals.get(this.adapter.getPartId(part));
      if (!original) continue;
      this.adapter.restoreTransform(part, original);
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.originals.clear();
  }

  private handlePointerDown(target: unknown, event: PointerEvent): void {
    if (event.button !== 0) return;
    const part = this.adapter.resolvePart(target);
    if (!part) {
      this.drag = null;
      this.setSelected(null);
      return;
    }

    this.setSelected(part);
    this.drag = this.adapter.beginDrag(part, event);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    this.adapter.updateDrag(this.drag, event);
  }

  private handlePointerUp(_event: PointerEvent): void {
    this.finishDrag();
  }

  private handleRender(): void {
    if (!this.selected || this.adapter.isDisposed(this.selected)) return;
    this.frameCount++;
    if (this.frameCount % 3 !== 0) return;
    this.adapter.updateSelectionOcclusion(this.selected);
  }

  private finishDrag(): void {
    this.adapter.endDrag(this.drag);
    this.drag = null;
  }

  private setSelected(part: TPart | null): void {
    this.selected = part;
    this.frameCount = 0;
    this.adapter.setSelected(part);
  }
}

export function createPreviewDisassemblyController<TPart, TTransform, TDragState>(
  adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>,
): PreviewDisassemblyController {
  return new PreviewDisassemblySessionController(adapter);
}
