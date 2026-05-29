import { App, Component, MarkdownRenderer } from "obsidian";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { HeadingSearchResult } from "../../utils/note-reader";
import { formatT, t } from "../../i18n";
import { getPortableStem } from "../../utils/resolve-path";
import type { AnnotationViewportProvider, PreviewProjectionResult, PreviewWorldPoint } from "./types";
import { clonePreviewWorldPoint } from "./geometry";

const DEFAULT_COLORS = [
  "#4a9eff",
  "#ff6b6b",
  "#51cf66",
  "#ffd43b",
  "#845ef7",
  "#ff922b",
  "#22b8cf",
  "#f06595",
  "#94d82d",
  "#ffa8a8",
];
let globalNextId = 1;
const MOVING_OCCLUSION_BATCH_SIZE = 4;
const MOVING_OCCLUSION_STRIDE = 2;
const IDLE_OCCLUSION_STRIDE = 6;
const LABEL_AVOIDANCE_PADDING = 6;
const LABEL_AVOIDANCE_MAX_SHIFT = 72;
const LABEL_AVOIDANCE_MAX_PINS = 80;

function generateId(): string {
  return `pin-${Date.now()}-${globalNextId++}`;
}

function cloneWorldPoint(point: PreviewWorldPoint): PreviewWorldPoint {
  return clonePreviewWorldPoint(point);
}

function rectsOverlap(a: DOMRect, b: DOMRect, padding: number): boolean {
  return a.left < b.right + padding
    && a.right > b.left - padding
    && a.top < b.bottom + padding
    && a.bottom > b.top - padding;
}

export type AnnotationMode = "edit" | "readonly";

interface ProjectedPinEntry {
  el: HTMLDivElement;
  screenX: number;
  screenY: number;
  depth: number;
}

export interface AnnotationPreviewOptions {
  app?: App;
  previewMode?: PluginSettings["annotationPreviewMode"];
}

export class AnnotationManager {
  private overlay: HTMLDivElement;
  private pinEls = new Map<string, { el: HTMLDivElement; worldPos: PreviewWorldPoint }>();
  private observer: { remove: () => void } | null = null;
  private resizeObs: ResizeObserver | null = null;
  private annotations: AnnotationPin[] = [];
  private editorEl: HTMLDivElement | null = null;
  private disposeCallbacks: (() => void)[] = [];
  private frameCount = 0;
  // Camera idle detection
  private lastCamState = "";
  private idleFrames = 0;
  private cameraIdle = false;
  private movingOcclusionCursor = 0;
  private static readonly IDLE_THRESHOLD = 15; // ~250ms at 60fps
  private static readonly _scratchProjection: PreviewProjectionResult = { screenX: 0, screenY: 0, depth: 0 };
  private hoverPopover: HTMLDivElement | null = null;
  private hoverTimeout: number | null = null;
  private hoverRequestId = 0;
  private _highlightHandler: ((e: Event) => void) | null = null;
  private _pulseTimeout: number | null = null;
  private _headingDropdown: HTMLDivElement | null = null;
  private _headingDebounce: number | null = null;
  private _selectedHeading: HeadingSearchResult | null = null;
  private readonly previewRenderRoot = new Component();
  private readonly previewRenderChildren = new WeakMap<HTMLElement, Component>();
  private readonly previewApp?: App;
  private readonly previewMode: PluginSettings["annotationPreviewMode"];

  constructor(
    private provider: AnnotationViewportProvider,
    private hostEl: HTMLElement,
    private mode: AnnotationMode,
    initial: AnnotationPin[],
    private onChange?: (pins: AnnotationPin[]) => void,
    private noteReader?: (notePath: string, heading: string) => Promise<string | null>,
    private headingSearch?: (query: string) => HeadingSearchResult[],
    previewOptions: AnnotationPreviewOptions = {},
  ) {
    this.previewApp = previewOptions.app;
    this.previewMode = previewOptions.previewMode ?? "plain-text";
    this.previewRenderRoot.load();

    // Create overlay container on hostEl (in DOM) to inherit Obsidian CSS variables
    this.overlay = this.hostEl.createDiv({ cls: "ai3d-annotation-overlay" });

    // Set initial annotations
    this.setAnnotations(initial);

    // Listen for pin highlight events from note headings
    this._highlightHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Record<string, string> | undefined;
      const pinId = detail?.pinId;
      if (pinId) this.pulsePin(pinId);
    };
    activeDocument.addEventListener("ai3d-pin-highlight", this._highlightHandler);
    this.disposeCallbacks.push(() =>
      activeDocument.removeEventListener("ai3d-pin-highlight", this._highlightHandler!),
    );
    this.disposeCallbacks.push(() => this.previewRenderRoot.unload());

    // Start projection update loop
    this.startProjectionLoop();
  }

  // ── Public API ──────────────────────────────────────────────

  setAnnotations(pins: AnnotationPin[]): void {
    // Remove old pins
    for (const [, entry] of this.pinEls) entry.el.remove();
    this.pinEls.clear();

    this.annotations = [...pins];
    for (const pin of pins) {
      this.createPinElement(pin);
    }
    this.updateProjections();
  }

  addPin(worldPos: PreviewWorldPoint, label: string, color?: string): AnnotationPin {
    const pin: AnnotationPin = {
      id: generateId(),
      position: [worldPos.x, worldPos.y, worldPos.z],
      label,
      color: color ?? DEFAULT_COLORS[this.annotations.length % DEFAULT_COLORS.length],
      createdAt: new Date().toISOString(),
    };
    this.annotations.push(pin);
    this.createPinElement(pin);
    this.updateProjections();
    this.onChange?.(this.annotations);
    return pin;
  }

  removePin(id: string): void {
    const entry = this.pinEls.get(id);
    if (entry) {
      entry.el.remove();
      this.pinEls.delete(id);
    }
    this.annotations = this.annotations.filter(p => p.id !== id);
    this.onChange?.(this.annotations);
  }

  updatePin(id: string, partial: Partial<AnnotationPin>): void {
    const pin = this.annotations.find(p => p.id === id);
    if (!pin) return;
    Object.assign(pin, partial);
    const entry = this.pinEls.get(id);
    if (entry) {
      if (partial.position) {
        entry.worldPos = { x: partial.position[0], y: partial.position[1], z: partial.position[2] };
      }
      const labelEl = entry.el.querySelector(".ai3d-pin-label");
      if (labelEl && partial.label !== undefined) labelEl.textContent = partial.label;
      const dotEl = entry.el.querySelector<HTMLElement>(".ai3d-pin-dot");
      if (dotEl && partial.color !== undefined) dotEl.style.setProperty("--pin-color", partial.color);
    }
    this.updateProjections();
    this.onChange?.(this.annotations);
  }

  /** Show inline editor at screen position for creating a new pin. */
  showEditor(screenX: number, screenY: number, worldPos: PreviewWorldPoint): void {
    this.showEditorInternal(screenX, screenY, worldPos);
  }

  /** Show inline editor pre-filled for editing an existing pin. */
  editPin(id: string): void {
    const pin = this.annotations.find(p => p.id === id);
    if (!pin) return;
    const entry = this.pinEls.get(id);
    if (!entry) return;

    // Position editor near the pin element
    const rect = entry.el.getBoundingClientRect();
    const screenX = rect.left + rect.width / 2;
    const screenY = rect.top;

    this.showEditorInternal(screenX, screenY, cloneWorldPoint(entry.worldPos), pin);
  }

  /** Get the world position of a pin (for camera focus). */
  getPinPosition(id: string): PreviewWorldPoint | null {
    const entry = this.pinEls.get(id);
    return entry ? cloneWorldPoint(entry.worldPos) : null;
  }

  /** Get all annotations (read-only snapshot). */
  getAnnotations(): readonly AnnotationPin[] {
    return this.annotations;
  }

  private showEditorInternal(screenX: number, screenY: number, worldPos: PreviewWorldPoint, existingPin?: AnnotationPin): void {
    this.hideEditor();
    this._selectedHeading = null;

    // Create on overlay (in DOM) so Obsidian's createEl reads CSS variables
    const editor = this.overlay.createDiv({ cls: "ai3d-annotation-editor" });

    // ── Input wrapper (input + binding indicator) ──
    const inputWrap = editor.createDiv({ cls: "ai3d-editor-input-wrap" });

    const input = inputWrap.createEl("input", { cls: "ai3d-annotation-editor-input" });
    input.type = "text";
    input.placeholder = this.headingSearch ? "Label or search heading..." : "Label...";
    if (existingPin) input.value = existingPin.label;

    // Show existing binding indicator
    const bindingTag = inputWrap.createSpan({ cls: "ai3d-editor-binding-tag is-hidden" });
    const clearBindingBtn = bindingTag.createEl("button", { cls: "ai3d-editor-binding-clear" });
    clearBindingBtn.textContent = "\u00d7";
    clearBindingBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._selectedHeading = null;
      bindingTag.classList.add("is-hidden");
      contentPreview.classList.add("is-hidden");
      contentPreview.textContent = "";
      input.value = "";
      input.focus();
    });

    // ── Content preview (shows heading section content after binding) ──
    const contentPreview = editor.createDiv({ cls: "ai3d-editor-content-preview is-hidden" });

    // ── Heading autocomplete dropdown ──
    const dropdown = editor.createDiv({ cls: "ai3d-heading-dropdown is-hidden" });
    this._headingDropdown = dropdown;

    let dropdownIndex = -1;
    let lastResults: HeadingSearchResult[] = [];

    const setDropdownIndex = (idx: number) => {
      const items = dropdown.querySelectorAll<HTMLElement>(".ai3d-heading-dropdown-item");
      items.forEach(i => i.classList.remove("active"));
      dropdownIndex = idx;
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add("active");
        items[idx].scrollIntoView({ block: "nearest" });
      }
    };

    const selectResult = (result: HeadingSearchResult) => {
      this._selectedHeading = result;
      input.value = result.heading;
      // Show binding tag
      const shortPath = getPortableStem(result.notePath);
      bindingTag.querySelector(".ai3d-editor-binding-text")?.remove();
      const textSpan = bindingTag.createSpan({ cls: "ai3d-editor-binding-text" });
      textSpan.textContent = `\ud83d\udcc4 ${shortPath}`;
      bindingTag.classList.remove("is-hidden");
      hideDropdown();
      input.focus();
      // Load and show content preview
      void this.loadContentPreview(contentPreview, result.notePath, result.heading);
    };

    const hideDropdown = () => {
      dropdown.classList.add("is-hidden");
      dropdown.replaceChildren();
      dropdownIndex = -1;
    };

    const showResults = (results: HeadingSearchResult[]) => {
      dropdown.replaceChildren();
      dropdownIndex = -1;
      lastResults = results;
      if (results.length === 0) {
        dropdown.classList.add("is-hidden");
        return;
      }
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const item = dropdown.createDiv({ cls: "ai3d-heading-dropdown-item" });

        const headingEl = item.createSpan({ cls: "ai3d-heading-dropdown-heading" });
        headingEl.textContent = `${"#".repeat(r.level)} ${r.heading}`;

        const noteEl = item.createSpan({ cls: "ai3d-heading-dropdown-note" });
        noteEl.textContent = getPortableStem(r.notePath);
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectResult(r);
        });
        item.addEventListener("mouseenter", () => setDropdownIndex(i));
      }
      dropdown.classList.remove("is-hidden");
    };

    // ── Input event: heading search ──
    input.addEventListener("input", () => {
      if (!this.headingSearch) return;
      if (this._headingDebounce) window.clearTimeout(this._headingDebounce);
      const query = input.value.trim();
      if (query.length < 1) {
        hideDropdown();
        return;
      }
      this._headingDebounce = window.setTimeout(() => {
        const results = this.headingSearch!(query);
        showResults(results);
      }, 150);
    });

    // ── Keyboard navigation in dropdown ──
    input.addEventListener("keydown", (e) => {
      if (dropdown.classList.contains("is-hidden")) {
        // No dropdown open — normal editor keys
        if (e.key === "Enter") {
          e.preventDefault();
          confirmBtn.click();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.hideEditor();
        }
        return;
      }
      const items = dropdown.querySelectorAll<HTMLElement>(".ai3d-heading-dropdown-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setDropdownIndex(Math.min(dropdownIndex + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setDropdownIndex(Math.max(dropdownIndex - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (dropdownIndex >= 0 && dropdownIndex < items.length) {
          // Select highlighted heading
          if (lastResults[dropdownIndex]) selectResult(lastResults[dropdownIndex]);
        } else {
          confirmBtn.click();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideDropdown();
      }
    });

    // Close dropdown on blur (after a short delay to allow mousedown on items)
    input.addEventListener("blur", () => {
      window.setTimeout(hideDropdown, 150);
    });

    // ── Color swatches ──
    const colorRow = editor.createDiv({ cls: "ai3d-annotation-editor-colors" });
    const initialColor = existingPin?.color?.trim();
    let selectedColor = initialColor || DEFAULT_COLORS[0];
    const paletteColors = initialColor && !DEFAULT_COLORS.includes(initialColor)
      ? [initialColor, ...DEFAULT_COLORS]
      : DEFAULT_COLORS;
    for (const c of paletteColors) {
      const swatch = colorRow.createEl("button", { cls: "ai3d-pin-color-swatch" });
      swatch.type = "button";
      swatch.title = c;
      swatch.setAttribute("aria-label", formatT("annotation.selectColor", { color: c }));
      swatch.style.setProperty("--swatch-color", c);
      swatch.style.backgroundColor = c;
      if (c === selectedColor) swatch.classList.add("is-selected");
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedColor = c;
        colorRow.querySelectorAll(".ai3d-pin-color-swatch").forEach(s => s.classList.remove("is-selected"));
        swatch.classList.add("is-selected");
      });
    }

    // ── Action buttons ──
    const btnRow = editor.createDiv({ cls: "ai3d-annotation-editor-actions" });

    // Delete button (only for existing pins) — created first so it appears left of confirm/cancel
    if (existingPin) {
      const deleteBtn = btnRow.createEl("button", { cls: "ai3d-annotation-editor-btn ai3d-annotation-editor-delete" });
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removePin(existingPin.id);
        this.hideEditor();
      });
    }

    const confirmBtn = btnRow.createEl("button", { cls: "ai3d-annotation-editor-btn ai3d-annotation-editor-confirm" });
    confirmBtn.textContent = existingPin ? "Save" : "OK";
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const label = input.value.trim() || "Pin";
      const binding = this._selectedHeading;
      if (existingPin) {
        const partial: Partial<AnnotationPin> = { label, color: selectedColor };
        if (binding) {
          partial.notePath = binding.notePath;
          partial.headingRef = binding.heading;
          partial.headingLevel = binding.level;
        }
        this.updatePin(existingPin.id, partial);
      } else {
        const pin = this.addPin(worldPos, label, selectedColor);
        if (binding) {
          this.updatePin(pin.id, {
            notePath: binding.notePath,
            headingRef: binding.heading,
            headingLevel: binding.level,
          });
        }
      }
      this.hideEditor();
    });

    const cancelBtn = btnRow.createEl("button", { cls: "ai3d-annotation-editor-btn ai3d-annotation-editor-cancel" });
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hideEditor();
    });

    // Position within overlay bounds
    const rect = this.overlay.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    editor.style.setProperty("--editor-left", `${Math.max(0, Math.min(x, rect.width - 220))}px`);
    editor.style.setProperty("--editor-top", `${Math.max(0, Math.min(y - 10, rect.height - 160))}px`);

    this.editorEl = editor;

    // If editing existing pin with binding, show the tag and content
    if (existingPin?.notePath && existingPin?.headingRef) {
      const shortPath = getPortableStem(existingPin.notePath);
      const textSpan = bindingTag.createSpan({ cls: "ai3d-editor-binding-text" });
      textSpan.textContent = `\ud83d\udcc4 ${shortPath}`;
      bindingTag.classList.remove("is-hidden");
      this._selectedHeading = { notePath: existingPin.notePath, heading: existingPin.headingRef, level: existingPin.headingLevel ?? 2 };
      void this.loadContentPreview(contentPreview, existingPin.notePath, existingPin.headingRef);
    }

    // Focus input after DOM insert
    window.requestAnimationFrame(() => input.focus());

    // Stop click propagation to prevent canvas picking while editing
    editor.addEventListener("pointerdown", (e) => e.stopPropagation());
    editor.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  hideEditor(): void {
    if (this._headingDebounce) { window.clearTimeout(this._headingDebounce); this._headingDebounce = null; }
    this._headingDropdown = null;
    this._selectedHeading = null;
    if (this.editorEl) {
      const previewEl = this.editorEl.querySelector<HTMLDivElement>(".ai3d-editor-content-preview");
      if (previewEl) {
        this.clearRenderedPreview(previewEl);
      }
      this.editorEl.remove();
      this.editorEl = null;
    }
  }

  private async loadContentPreview(el: HTMLDivElement, notePath: string, heading: string): Promise<void> {
    if (!this.noteReader) return;
    this.clearRenderedPreview(el);
    el.classList.add("is-hidden");
    const content = await this.noteReader(notePath, heading);
    if (!content) {
      el.textContent = t("annotation.sectionEmpty");
      el.className = "ai3d-editor-content-preview ai3d-editor-content-preview--empty";
      el.classList.remove("is-hidden");
      return;
    }
    await this.renderPreviewContent(el, content, notePath, "editor");
  }

  private async showHoverPopover(requestId: number, pinEl: HTMLDivElement, pin: AnnotationPin): Promise<void> {
    if (!this.noteReader || !pin.notePath || !pin.headingRef) return;
    this.hideHoverPopover();

    const content = await this.noteReader(pin.notePath, pin.headingRef);
    if (!content || requestId !== this.hoverRequestId || !pinEl.isConnected || !this.hostEl.isConnected) return;

    const popover = createDiv({ cls: "ai3d-pin-popover" });

    const title = popover.createDiv({ cls: "ai3d-pin-popover-title" });
    title.textContent = pin.headingRef;

    const body = popover.createDiv({ cls: "ai3d-pin-popover-body" });
    await this.renderPreviewContent(body, content, pin.notePath, "popover");

    if (requestId !== this.hoverRequestId || !pinEl.isConnected || !this.hostEl.isConnected) {
      this.clearRenderedPreview(body);
      return;
    }

    // Position relative to pin
    const rect = pinEl.getBoundingClientRect();
    popover.style.setProperty("--popover-left", `${rect.left + rect.width / 2}px`);
    popover.style.setProperty("--popover-top", `${rect.bottom + 4}px`);

    activeDocument.body.appendChild(popover);
    this.hoverPopover = popover;
  }

  private hideHoverPopover(): void {
    if (this.hoverTimeout) { window.clearTimeout(this.hoverTimeout); this.hoverTimeout = null; }
    if (this.hoverPopover) {
      const body = this.hoverPopover.querySelector<HTMLDivElement>(".ai3d-pin-popover-body");
      if (body) {
        this.clearRenderedPreview(body);
      }
      this.hoverPopover.remove();
      this.hoverPopover = null;
    }
  }

  private clearRenderedPreview(el: HTMLElement): void {
    const child = this.previewRenderChildren.get(el);
    if (child) {
      this.previewRenderRoot.removeChild(child);
      this.previewRenderChildren.delete(el);
    }
    el.replaceChildren();
  }

  private async renderPreviewContent(
    el: HTMLDivElement,
    content: string,
    notePath: string,
    target: "editor" | "popover",
  ): Promise<void> {
    const shouldRenderMarkdown = this.previewMode === "markdown" && !!this.previewApp;
    const isEditor = target === "editor";

    if (!shouldRenderMarkdown) {
      const truncated = isEditor && content.length > 300 ? content.slice(0, 300) + "..." : content;
      el.textContent = truncated;
      el.className = isEditor ? "ai3d-editor-content-preview" : "ai3d-pin-popover-body";
      if (isEditor) {
        el.classList.remove("is-hidden");
      }
      return;
    }

    el.className = isEditor
      ? "ai3d-editor-content-preview ai3d-editor-content-preview--markdown markdown-rendered"
      : "ai3d-pin-popover-body ai3d-pin-popover-body--markdown markdown-rendered";
    if (isEditor) {
      el.classList.remove("is-hidden");
    }

    const renderChild = this.previewRenderRoot.addChild(new Component());
    this.previewRenderChildren.set(el, renderChild);

    try {
      await MarkdownRenderer.render(this.previewApp, content, el, notePath, renderChild);
    } catch (error) {
      this.previewRenderRoot.removeChild(renderChild);
      this.previewRenderChildren.delete(el);
      el.textContent = isEditor && content.length > 300 ? content.slice(0, 300) + "..." : content;
      el.className = isEditor ? "ai3d-editor-content-preview" : "ai3d-pin-popover-body";
      if (isEditor) {
        el.classList.remove("is-hidden");
      }
      console.warn("[AI3D] Annotation markdown preview fallback:", error);
    }
  }

  /** Pulse animation on a pin (triggered by note heading hover). */
  pulsePin(pinId: string): void {
    const entry = this.pinEls.get(pinId);
    if (!entry) return;
    if (this._pulseTimeout) { window.clearTimeout(this._pulseTimeout); this._pulseTimeout = null; }
    entry.el.classList.remove("ai3d-pin-pulse");
    // Force reflow to restart animation
    void entry.el.offsetWidth;
    entry.el.classList.add("ai3d-pin-pulse");
    this._pulseTimeout = window.setTimeout(() => {
      entry.el.classList.remove("ai3d-pin-pulse");
      this._pulseTimeout = null;
    }, 1200);
  }

  destroy(): void {
    this.hoverRequestId++;
    this.hideHoverPopover();
    if (this._pulseTimeout) { window.clearTimeout(this._pulseTimeout); this._pulseTimeout = null; }
    if (this._headingDebounce) { window.clearTimeout(this._headingDebounce); this._headingDebounce = null; }
    this._headingDropdown = null;
    this._selectedHeading = null;
    this.observer?.remove();
    this.observer = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const cb of this.disposeCallbacks) cb();
    this.disposeCallbacks = [];
    this.overlay.remove();
    this.pinEls.clear();
    this.editorEl?.remove();
    this.editorEl = null;
  }

  // ── Private ─────────────────────────────────────────────────

  private createPinElement(pin: AnnotationPin): void {
    // Create on overlay (in DOM) to inherit Obsidian CSS variables
    const el = this.overlay.createDiv({ cls: "ai3d-annotation-pin" });
    el.dataset.pinId = pin.id;

    const dot = el.createDiv({ cls: "ai3d-pin-dot" });
    dot.style.setProperty("--pin-color", pin.color);

    const label = el.createSpan({ cls: "ai3d-pin-label" });
    label.textContent = pin.label;

    // Readonly mode: no delete button
    if (this.mode === "edit") {
      const del = el.createEl("button", { cls: "ai3d-pin-delete" });
      del.textContent = "\u00d7";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removePin(pin.id);
      });

      // Click pin to edit (not delete button)
      el.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".ai3d-pin-delete")) return;
        e.stopPropagation();
        this.editPin(pin.id);
      });
    }

    // Enable pointer events on pin (overlay has pointer-events: none)
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.provider.canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        deltaMode: e.deltaMode,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      }));
    }, { passive: false });

    // Hover popover for linked notes
    if (pin.notePath && pin.headingRef && this.noteReader) {
      el.addEventListener("mouseenter", () => {
        if (this.hoverTimeout) { window.clearTimeout(this.hoverTimeout); }
        const requestId = ++this.hoverRequestId;
        this.hoverTimeout = window.setTimeout(() => {
          this.hoverTimeout = null;
          if (requestId !== this.hoverRequestId) return;
          void this.showHoverPopover(requestId, el, pin);
        }, 300);
      });
      el.addEventListener("mouseleave", () => {
        if (this.hoverTimeout) { window.clearTimeout(this.hoverTimeout); this.hoverTimeout = null; }
        this.hoverRequestId++;
        this.hideHoverPopover();
      });
    }

    this.pinEls.set(pin.id, {
      el,
      worldPos: { x: pin.position[0], y: pin.position[1], z: pin.position[2] },
    });
  }

  private startProjectionLoop(): void {
    this.observer = this.provider.observeRender(() => this.updateProjections());

    // Also update on resize
    this.resizeObs = new ResizeObserver(() => this.updateProjections());
    this.resizeObs.observe(this.provider.canvas);
  }

  private updateProjections(): void {
    if (this.pinEls.size === 0) return;
    const { canvas } = this.provider;

    if (!this.hostEl.isConnected || !canvas.isConnected || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      return;
    }

    // Detect camera idle: hash alpha/beta/radius/target
    const camState = this.provider.getCameraStateKey();
    if (camState === this.lastCamState) {
      this.idleFrames++;
    } else {
      this.idleFrames = 0;
      this.cameraIdle = false;
    }
    this.lastCamState = camState;
    if (this.idleFrames >= AnnotationManager.IDLE_THRESHOLD && !this.cameraIdle) {
      this.cameraIdle = true;
    }

    // While the camera is moving, pin overlay updates can become a noticeable
    // JS/DOM hotspot. Lower the projection refresh rate in motion, but keep
    // occlusion checks moving in small batches so the bookmark fade does not
    // visibly lag behind model rotation.
    this.frameCount++;
    const projectionStride = this.cameraIdle ? 1 : this.pinEls.size >= 12 ? 3 : 2;
    if (!this.cameraIdle && this.frameCount % projectionStride !== 0) {
      return;
    }

    const entries = Array.from(this.pinEls.values());
    const shouldCheckOcclusion = this.cameraIdle
      ? this.frameCount % IDLE_OCCLUSION_STRIDE === 0
      : this.frameCount % MOVING_OCCLUSION_STRIDE === 0;
    const checkAllOcclusion = this.cameraIdle || entries.length <= MOVING_OCCLUSION_BATCH_SIZE;
    const movingOcclusionStart = checkAllOcclusion ? 0 : this.movingOcclusionCursor % entries.length;
    const movingOcclusionEnd = movingOcclusionStart + MOVING_OCCLUSION_BATCH_SIZE;
    const projected = AnnotationManager._scratchProjection;
    const projectedPins: ProjectedPinEntry[] = [];

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!this.provider.projectWorldPoint(entry.worldPos, projected)) {
        this.hidePin(entry.el);
        continue;
      }

      // Z > 1 means behind camera
      if (projected.depth > 1 || projected.depth < 0) {
        this.hidePin(entry.el);
      } else {
        entry.el.style.setProperty("--pin-left", `${projected.screenX}px`);
        entry.el.style.setProperty("--pin-top", `${projected.screenY}px`);
        this.updatePinPriority(entry.el, projected.depth);
        projectedPins.push({
          el: entry.el,
          screenX: projected.screenX,
          screenY: projected.screenY,
          depth: projected.depth,
        });

        const inMovingOcclusionBatch = checkAllOcclusion
          || (index >= movingOcclusionStart && index < movingOcclusionEnd)
          || (movingOcclusionEnd > entries.length && index < movingOcclusionEnd % entries.length);
        if (shouldCheckOcclusion && inMovingOcclusionBatch) {
          const occluded = this.provider.isWorldPointOccluded(entry.worldPos);
          this.showPin(entry.el);
          entry.el.classList.toggle("ai3d-pin-occluded", occluded);
        } else if (!shouldCheckOcclusion) {
          // Camera moved → ensure previously hidden pins (behind geometry but now
          // potentially visible) get shown again immediately instead of waiting
          // for the next occlusion check frame.
          if (!this.cameraIdle && entry.el.classList.contains("ai3d-pin-hidden")) {
            this.showPin(entry.el);
          }
        }
      }
    }
    if (shouldCheckOcclusion && !checkAllOcclusion && entries.length > 0) {
      this.movingOcclusionCursor = (movingOcclusionStart + MOVING_OCCLUSION_BATCH_SIZE) % entries.length;
    }
    this.applyLabelAvoidance(projectedPins);
  }

  private updatePinPriority(el: HTMLDivElement, depth: number): void {
    const depthScore = Math.max(0, Math.min(1, 1 - depth));
    const movingBoost = this.cameraIdle ? 0 : 160;
    const occlusionPenalty = el.classList.contains("ai3d-pin-occluded") ? 80 : 0;
    el.style.zIndex = String(100 + movingBoost + Math.round(depthScore * 120) - occlusionPenalty);
  }

  private applyLabelAvoidance(projectedPins: ProjectedPinEntry[]): void {
    if (projectedPins.length === 0) return;
    if (projectedPins.length > LABEL_AVOIDANCE_MAX_PINS) {
      for (const pin of projectedPins) {
        pin.el.style.removeProperty("--pin-offset-y");
      }
      return;
    }

    const placed: DOMRect[] = [];
    const ordered = projectedPins
      .filter((pin) => !pin.el.classList.contains("ai3d-pin-hidden"))
      .sort((a, b) => a.depth - b.depth);

    for (const pin of ordered) {
      let offset = 0;
      pin.el.setCssProps({ "--pin-offset-y": "0px" });
      let rect = pin.el.getBoundingClientRect();
      for (const placedRect of placed) {
        if (!rectsOverlap(rect, placedRect, LABEL_AVOIDANCE_PADDING)) continue;
        const direction = pin.screenY >= placedRect.top + placedRect.height / 2 ? 1 : -1;
        offset = Math.max(
          -LABEL_AVOIDANCE_MAX_SHIFT,
          Math.min(LABEL_AVOIDANCE_MAX_SHIFT, offset + direction * (placedRect.height + LABEL_AVOIDANCE_PADDING)),
        );
        pin.el.setCssProps({ "--pin-offset-y": `${offset}px` });
        rect = pin.el.getBoundingClientRect();
      }
      placed.push(rect);
    }
  }

  private hidePin(el: HTMLDivElement): void {
    el.classList.remove("ai3d-pin-occluded");
    el.classList.add("ai3d-pin-hidden");
  }

  private showPin(el: HTMLDivElement): void {
    el.classList.remove("ai3d-pin-hidden");
  }
}
