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
  requestRender?(): void;
}

class PreviewDisassemblySessionController<TPart, TTransform, TDragState> implements PreviewDisassemblyController {
  private static readonly DRAG_START_DISTANCE = 4;
  private readonly adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>;
  private readonly originals = new Map<number | string, { part: TPart; transform: TTransform }>();
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private drag: TDragState | null = null;
  private pendingDrag: { part: TPart; event: PointerEvent; x: number; y: number } | null = null;
  private selected: TPart | null = null;
  private activePointerId: number | null = null;
  private frameCount = 0;
  private pendingDragEvent: PointerEvent | null = null;
  private dragUpdateFrame: number | null = null;

  constructor(adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>) {
    this.adapter = adapter;
  }

  isEnabled(): boolean {
    return this.active;
  }

  setEnabled(enabled: boolean): boolean {
    if (this.active === enabled) return this.active;
    this.active = enabled;
    this.finishDrag();
    this.setSelected(null);
    this.activePointerId = null;

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

    this.adapter.requestRender?.();
    return this.active;
  }

  toggle(): boolean {
    return this.setEnabled(!this.active);
  }

  reset(): void {
    this.finishDrag();
    this.setSelected(null);
    for (const { part, transform } of this.originals.values()) {
      if (this.adapter.isDisposed(part)) continue;
      this.adapter.restoreTransform(part, transform);
    }
    this.activePointerId = null;
    this.adapter.requestRender?.();
  }

  dispose(): void {
    this.setEnabled(false);
    this.originals.clear();
  }

  private handlePointerDown(target: unknown, event: PointerEvent): void {
    if (event.button !== 0 || event.isPrimary === false) return;
    const part = this.adapter.resolvePart(target);
    if (!part) {
      this.drag = null;
      this.pendingDrag = null;
      this.activePointerId = null;
      this.setSelected(null);
      return;
    }

    this.activePointerId = event.pointerId;
    this.setSelected(part);
    this.pendingDrag = { part, event, x: event.clientX, y: event.clientY };
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
    if (!this.drag && this.pendingDrag) {
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
        this.pendingDrag = null;
        this.activePointerId = null;
        return;
      }
      const distance = Math.hypot(event.clientX - this.pendingDrag.x, event.clientY - this.pendingDrag.y);
      if (distance < PreviewDisassemblySessionController.DRAG_START_DISTANCE) {
        return;
      }
      const pending = this.pendingDrag;
      this.pendingDrag = null;
      if (this.adapter.isDisposed(pending.part)) return;
      this.captureOriginalTransform(pending.part);
      this.drag = this.adapter.beginDrag(pending.part, pending.event);
      if (this.drag) {
        this.adapter.updateDrag(this.drag, event);
      }
      return;
    }
    if (!this.drag) return;
    this.scheduleDragUpdate(event);
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
    this.pendingDrag = null;
    this.flushDragUpdate();
    this.finishDrag();
    this.activePointerId = null;
  }

  private handleRender(): void {
    if (!this.selected || this.adapter.isDisposed(this.selected)) return;
    if (this.drag || this.pendingDrag) return;
    this.frameCount++;
    if (this.frameCount % 6 !== 0) return;
    this.adapter.updateSelectionOcclusion(this.selected);
  }

  private finishDrag(): void {
    this.pendingDrag = null;
    this.flushDragUpdate();
    this.adapter.endDrag(this.drag);
    this.drag = null;
    this.adapter.requestRender?.();
  }

  private scheduleDragUpdate(event: PointerEvent): void {
    this.pendingDragEvent = event;
    if (this.dragUpdateFrame !== null) return;
    this.dragUpdateFrame = requestDragAnimationFrame(() => {
      this.dragUpdateFrame = null;
      this.flushDragUpdate();
    });
  }

  private flushDragUpdate(): void {
    if (this.dragUpdateFrame !== null) {
      cancelDragAnimationFrame(this.dragUpdateFrame);
      this.dragUpdateFrame = null;
    }
    const event = this.pendingDragEvent;
    this.pendingDragEvent = null;
    if (!this.drag || !event) return;
    this.adapter.updateDrag(this.drag, event);
  }

  private setSelected(part: TPart | null): void {
    this.selected = part;
    this.frameCount = 0;
    this.adapter.setSelected(part);
  }

  private captureOriginalTransform(part: TPart): void {
    const id = this.adapter.getPartId(part);
    if (this.originals.has(id)) {
      return;
    }
    this.originals.set(id, { part, transform: this.adapter.captureTransform(part) });
  }
}

function requestDragAnimationFrame(callback: FrameRequestCallback): number {
  const frameWindow = typeof activeWindow === "undefined" ? window : activeWindow;
  if (typeof frameWindow.requestAnimationFrame === "function") {
    return frameWindow.requestAnimationFrame(callback);
  }
  return frameWindow.setTimeout(() => callback(frameWindow.performance.now()), 16);
}

function cancelDragAnimationFrame(handle: number): void {
  const frameWindow = typeof activeWindow === "undefined" ? window : activeWindow;
  if (typeof frameWindow.cancelAnimationFrame === "function") {
    frameWindow.cancelAnimationFrame(handle);
    return;
  }
  frameWindow.clearTimeout(handle);
}

export function createPreviewDisassemblyController<TPart, TTransform, TDragState>(
  adapter: PreviewDisassemblyAdapter<TPart, TTransform, TDragState>,
): PreviewDisassemblyController {
  return new PreviewDisassemblySessionController(adapter);
}
