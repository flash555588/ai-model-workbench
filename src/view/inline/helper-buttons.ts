import type { App } from "obsidian";
import type { PluginSettings } from "../../domain/models";
import { formatT, t } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import { createLogger } from "../../utils/log";

const log = createLogger("helper-buttons");
import {
  supportsAnimationPreview,
  supportsBoundingBoxPreview,
  supportsDisassemblyPreview,
  supportsFocusSelectionPreview,
  supportsOrientationGizmoPreview,
  supportsRenderScalePreview,
  supportsMeasurementPreview,
  supportsSlicePreview,
  supportsWireframePreview,
} from "../../render/preview/types";
import type {
  AnimationPreview,
  BoundingBoxPreview,
  CameraZoomPreview,
  DisassemblyPreview,
  FocusSelectionPreview,
  ModelPreview,
  OrientationGizmoPreview,
  RenderScalePreview,
  MeasurementPreview,
  MeasurementSnapKind,
  MeasurementState,
  MeasurementUnit,
  WireframePreview,
  SlicePreview,
  SliceInteractionMode,
  SliceState,
} from "../../render/preview/types";
import { isMobile } from "../../utils/device";
import { getPortableStem } from "../../utils/resolve-path";
import { dataUrlToBlob } from "../../utils/base64";
import {
  cancelOrDeactivateMeasurement,
  createBoundsMeasurementScale,
  createReferenceMeasurementScale,
  formatMeasurementNumber,
  formatMeasurementValue,
} from "../../render/preview/measurement";
import { createCameraZoomControl } from "./zoom-control";
import {
  isPreviewInteractionModeActive,
  resolvePreviewInteractionMode,
  type PreviewInteractionMode,
} from "../../render/preview/interaction";

/** Create an SVG icon that follows its button color via currentColor. */
function createSvgIcon(inner: string): SVGSVGElement {
  const svg = createSvg("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
    "image/svg+xml",
  );
  for (const child of Array.from(doc.documentElement.childNodes)) {
    svg.appendChild(activeDocument.importNode(child, true));
  }
  return svg;
}

const RENDER_SCALE_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;
const DEFAULT_RENDER_SCALE_INDEX = 2;

function normalizeRenderScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return 1.0;
  return Math.max(0.25, Math.min(scale, 2.0));
}

function findNearestRenderScaleIndex(scale: number): number {
  const normalized = normalizeRenderScale(scale);
  let bestIndex = DEFAULT_RENDER_SCALE_INDEX;
  RENDER_SCALE_PRESETS.forEach((value, index) => {
    const currentDelta = Math.abs(value - normalized);
    const bestDelta = Math.abs(RENDER_SCALE_PRESETS[bestIndex] - normalized);
    if (currentDelta < bestDelta) bestIndex = index;
  });
  return bestIndex;
}

function formatRenderScale(scale: number): string {
  return `${Math.round(normalizeRenderScale(scale) * 100)}%`;
}

function readRenderScale(preview: RenderScalePreview | null, fallback: number): number {
  return normalizeRenderScale(preview?.getRenderScale?.() ?? fallback);
}

/** Any preview that supports snapshot capture. */
export type SnapshotProvider =
  & Pick<ModelPreview, "captureSnapshot" | "resetView">
  & Partial<Pick<
    ModelPreview,
    | "exportModelInfo"
    | "exportSelectedPartInfo"
  >>
  & Partial<AnimationPreview & BoundingBoxPreview & CameraZoomPreview & DisassemblyPreview & FocusSelectionPreview & MeasurementPreview & OrientationGizmoPreview & RenderScalePreview & SlicePreview & WireframePreview>;

/** Handle returned by createHelperButtons — callers hold a direct reference. */
export interface HelperToolbar {
  showAnimButton(): void;
  showAnnotateButton(): void;
  updateAnnotationBadge(count: number): void;
  setMobileInteractionMode(active: boolean): void;
  syncCapabilities(): void;
}

interface AnnotationToggleCopy {
  labelKey: TranslationKey;
  activeTooltipKey: TranslationKey;
  inactiveTooltipKey: TranslationKey;
}

function setAction(button: HTMLButtonElement, action: string): HTMLButtonElement {
  button.dataset.ai3dAction = action;
  button.dataset.testid = `ai3d-action-${action}`;
  return button;
}

function setMobileInteractionMode(previewHost: HTMLElement, active: boolean): void {
  previewHost.classList.toggle("is-mobile-interactive", active);
  previewHost.classList.toggle("is-mobile-scroll-mode", !active);
}

/**
 * Create helper buttons BELOW the preview host (as a sibling).
 * @param parentEl  Parent element already in the live DOM — Obsidian's createEl
 *                  reads CSS variables from the live DOM to apply theme styling.
 * @param previewHost  The preview host element; toolbar is inserted after it.
 */
export function createHelperButtons(
  parentEl: HTMLElement,
  previewHost: HTMLElement,
  app: App,
  getPreview: () => SnapshotProvider | null,
  getModelPath: () => string,
  onRemove: () => void,
  getSettings?: () => PluginSettings,
  onToggleAnnotate?: () => boolean,
  onMobileInteractionModeChange?: (active: boolean) => void,
  annotationCopy?: AnnotationToggleCopy,
): HelperToolbar {
  const mobile = isMobile();
  const resolvedAnnotationCopy: AnnotationToggleCopy = annotationCopy ?? {
    labelKey: "helper.toggleAnnotationLabel",
    activeTooltipKey: "helper.annotateOn",
    inactiveTooltipKey: "helper.annotateOff",
  };

  // Create on parentEl (in DOM) so Obsidian's createEl inherits CSS variables
  const toolbar = parentEl.createDiv({ cls: "ai3d-helper-toolbar ai3d-helper-toolbar-adaptive" });
  const viewGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-view" });
  const inspectGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-inspect" });
  const outputGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-output" });
  const interactionStatus = toolbar.createSpan({ cls: "ai3d-interaction-status is-hidden" });
  const stopToolbarEvent = (event: Event): void => {
    event.stopPropagation();
  };
  toolbar.addEventListener("pointerdown", stopToolbarEvent);
  toolbar.addEventListener("mousedown", stopToolbarEvent);
  toolbar.addEventListener("click", stopToolbarEvent);
  const handleMeasurementEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Node && !toolbar.contains(target) && !previewHost.contains(target)) return;
    const preview = getMeasurementPreview();
    if (!preview || !cancelOrDeactivateMeasurement(preview)) return;
    syncMeasurementDetails();
    event.preventDefault();
    event.stopPropagation();
  };
  toolbar.addEventListener("keydown", handleMeasurementEscape);
  previewHost.addEventListener("keydown", handleMeasurementEscape);
  if (mobile) {
    toolbar.classList.add("is-mobile");
    setMobileInteractionMode(previewHost, false);
  }
  const zoomControl = createCameraZoomControl(previewHost, getPreview);
  let boundMeasurementPreview: MeasurementPreview | null = null;
  let releaseMeasurementObserver: (() => void) | null = null;
  let boundSlicePreview: SlicePreview | null = null;
  let releaseSliceObserver: (() => void) | null = null;
  let annotationActive = false;
  let lastInteractionMode: PreviewInteractionMode = "idle";

  const markSecondary = <T extends HTMLButtonElement>(button: T): T => {
    button.classList.add("is-secondary");
    return button;
  };
  const setTogglePressed = (button: HTMLButtonElement, active: boolean): void => {
    button.classList.toggle("ai3d-btn-active", active);
    button.setAttribute("aria-pressed", String(active));
  };
  const syncGroupVisibility = (): void => {
    for (const group of [viewGroup, inspectGroup, outputGroup]) {
      const visibleButtons = Array
        .from(group.querySelectorAll<HTMLElement>(".ai3d-inline-btn"))
        .filter((button) => !button.classList.contains("is-hidden"));
      const hasVisibleButton = visibleButtons.length > 0;
      const hasPrimaryButton = visibleButtons.some((button) => !button.classList.contains("is-secondary"));
      group.classList.toggle("is-hidden", !hasVisibleButton);
      group.classList.toggle("has-primary-visible", hasPrimaryButton);
    }
  };

  let mobileInteractive = false;
  let toolbarExpanded = false;

  const interactBtn = mobile
    ? viewGroup.createEl("button", {
      cls: "ai3d-inline-btn ai3d-mobile-mode-btn",
      attr: { "aria-label": t("helper.enableInteractionLabel"), "aria-pressed": "false" },
    })
    : null;
  interactBtn?.appendChild(createSvgIcon(`<path d="M12 2v8"/><path d="M8 6l4-4 4 4"/><path d="M6 14a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/>`));
  const interactLabel = interactBtn?.createSpan({ cls: "ai3d-mobile-mode-btn-label" }) ?? null;

  const renderToolbarButtons = (): void => {
    if (mobile && interactBtn) {
      setMobileInteractionMode(previewHost, mobileInteractive);
      setTogglePressed(interactBtn, mobileInteractive);
      interactLabel?.setText(mobileInteractive ? t("helper.scrollAction") : t("helper.interactAction"));
      interactBtn.setAttribute(
        "aria-label",
        mobileInteractive ? t("helper.disableInteractionLabel") : t("helper.enableInteractionLabel"),
      );
    }
    setTogglePressed(showMoreBtn, toolbarExpanded);
    toolbar.classList.toggle("show-secondary", toolbarExpanded);
    syncGroupVisibility();
  };

  const applyMobileInteractionMode = (active: boolean): void => {
    mobileInteractive = active;
    renderToolbarButtons();
  };

  interactBtn?.addEventListener("click", () => {
    const nextInteractive = !mobileInteractive;
    onMobileInteractionModeChange?.(nextInteractive);
    applyMobileInteractionMode(nextInteractive);
    showTooltip(interactBtn, nextInteractive ? t("helper.interactionOn") : t("helper.interactionOff"));
  });

  const toggleCapabilityButton = (button: HTMLElement, enabled: boolean): void => {
    button.classList.toggle("is-hidden", !enabled);
  };

  let lastSyncedPreview: unknown = null;
  const interactionModeLabel = (mode: PreviewInteractionMode): string => {
    switch (mode) {
      case "annotation": return t("helper.interactionModeAnnotation");
      case "focus": return t("helper.interactionModeFocus");
      case "disassembly": return t("helper.interactionModeDisassembly");
      case "measurement": return t("helper.interactionModeMeasurement");
      case "slice": return t("helper.interactionModeSlice");
      case "idle": return "";
    }
  };

  const syncInteractionPresentation = (
    focusPreview: FocusSelectionPreview | null,
    disassemblyPreview: DisassemblyPreview | null,
    measurementPreview: MeasurementPreview | null,
    slicePreview: SlicePreview | null,
  ): void => {
    const mode = resolvePreviewInteractionMode({
      annotation: annotationActive,
      focus: !!focusPreview?.isFocusSelectionEnabled(),
      disassembly: !!disassemblyPreview?.isDisassemblyEnabled(),
      measurement: !!measurementPreview?.isMeasurementActive(),
      slice: !!slicePreview?.isSliceActive(),
    });
    toolbar.dataset.ai3dInteractionMode = mode;
    previewHost.dataset.ai3dInteractionMode = mode;
    previewHost.classList.toggle("ai3d-interaction-active", isPreviewInteractionModeActive(mode));
    if (lastInteractionMode !== mode) {
      previewHost.classList.remove(`ai3d-interaction-${lastInteractionMode}`);
      if (mode !== "idle") previewHost.classList.add(`ai3d-interaction-${mode}`);
      lastInteractionMode = mode;
    }
    interactionStatus.textContent = interactionModeLabel(mode);
    interactionStatus.classList.toggle("is-hidden", mode === "idle");
    const linkedButtons: Array<[PreviewInteractionMode, HTMLButtonElement]> = [
      ["annotation", annotBtn],
      ["focus", focusBtn],
      ["disassembly", disassembleBtn],
      ["measurement", measureBtn],
      ["slice", sliceBtn],
    ];
    for (const [buttonMode, button] of linkedButtons) {
      button.classList.toggle("ai3d-linked-inactive", mode !== "idle" && mode !== buttonMode);
    }
  };

  const syncToggleStates = (): void => {
    const preview = getPreview();
    const focusPreview = preview && supportsFocusSelectionPreview(preview) ? preview : null;
    const disassemblyPreview = preview && supportsDisassemblyPreview(preview) ? preview : null;
    const measurementPreview = preview && supportsMeasurementPreview(preview) ? preview : null;
    const slicePreview = preview && supportsSlicePreview(preview) ? preview : null;
    setTogglePressed(focusBtn, !!focusPreview?.isFocusSelectionEnabled());
    setTogglePressed(disassembleBtn, !!disassemblyPreview?.isDisassemblyEnabled());
    setTogglePressed(measureBtn, !!measurementPreview?.isMeasurementActive());
    setTogglePressed(sliceBtn, !!slicePreview?.isSliceActive());
    setTogglePressed(annotBtn, annotationActive);
    if (preview && supportsOrientationGizmoPreview(preview)) {
      setTogglePressed(gizmoBtn, !!preview.isOrientationGizmoEnabled?.());
    }
    syncInteractionPresentation(focusPreview, disassemblyPreview, measurementPreview, slicePreview);
  };

  const deactivateAnnotationForPreviewMode = (): void => {
    if (!annotationActive || !onToggleAnnotate) return;
    annotationActive = onToggleAnnotate();
    setTogglePressed(annotBtn, annotationActive);
  };

  const deactivatePreviewModesForAnnotation = (): void => {
    const preview = getPreview();
    if (!preview) return;
    if (supportsSlicePreview(preview) && preview.isSliceActive()) preview.toggleSlice();
    if (supportsMeasurementPreview(preview) && preview.isMeasurementActive()) preview.toggleMeasurement();
    if (supportsDisassemblyPreview(preview) && preview.isDisassemblyEnabled()) preview.toggleDisassembly();
    if (supportsFocusSelectionPreview(preview) && preview.isFocusSelectionEnabled()) preview.toggleFocusSelection();
  };

  const syncCapabilities = (): void => {
    const preview = getPreview();
    const focusPreview = preview && supportsFocusSelectionPreview(preview) ? preview : null;
    const disassemblyPreview = preview && supportsDisassemblyPreview(preview) ? preview : null;
    const animationPreview = preview && supportsAnimationPreview(preview) ? preview : null;
    const renderScalePreview = preview && supportsRenderScalePreview(preview) ? preview : null;
    if (preview !== lastSyncedPreview) {
      lastSyncedPreview = preview;
      setTogglePressed(wireBtn, false);
      setTogglePressed(bboxBtn, false);
      setTogglePressed(animBtn, false);
      animBtn.replaceChildren(createSvgIcon(`<polygon points="5 3 19 12 5 21 5 3"/>`));
      toggleCapabilityButton(resetBtn, !!preview?.resetView);
      toggleCapabilityButton(infoBtn, !!preview?.exportModelInfo);
      toggleCapabilityButton(partInfoBtn, !!preview?.exportSelectedPartInfo);
      toggleCapabilityButton(wireBtn, !!preview && supportsWireframePreview(preview));
      toggleCapabilityButton(gizmoBtn, !!preview && supportsOrientationGizmoPreview(preview));
      toggleCapabilityButton(bboxBtn, !!preview && supportsBoundingBoxPreview(preview));
      toggleCapabilityButton(focusBtn, !!focusPreview);
      toggleCapabilityButton(disassembleBtn, !!disassemblyPreview);
      toggleCapabilityButton(resBtn, !!renderScalePreview);
      toggleCapabilityButton(sliceBtn, !!preview && supportsSlicePreview(preview));
      toggleCapabilityButton(animBtn, !!animationPreview?.hasAnimations());
    }
    syncRenderScaleButton(renderScalePreview);
    toggleCapabilityButton(measureBtn, !!preview && supportsMeasurementPreview(preview));
    syncToggleStates();
    syncMeasurementDetails();
    syncSliceDetails();
    syncGroupVisibility();
    zoomControl.sync();
  };

  // Reset view button (refresh arrow)
  const resetBtn = viewGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.resetViewLabel") } });
  setAction(resetBtn, "reset-view");
  resetBtn.appendChild(createSvgIcon(`<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`));
  resetBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (preview?.resetView) {
      preview.resetView();
      syncCapabilities();
      showTooltip(resetBtn, t("helper.resetViewDone"));
    }
  });

  // Export model info button (info circle)
  const infoBtn = markSecondary(inspectGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copyModelInfoLabel") } }));
  setAction(infoBtn, "copy-model-info");
  infoBtn.appendChild(createSvgIcon(`<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`));
  infoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.exportModelInfo) return;
    try {
      const md = preview.exportModelInfo(getModelPath());
      if (!md) return;
      void navigator.clipboard.writeText(md).then(() => {
        showTooltip(infoBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(infoBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Export model info failed:", err);
      showTooltip(infoBtn, t("helper.failed"));
    }
  });

  // Export currently selected part info button (target/list icon)
  const partInfoBtn = markSecondary(inspectGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copySelectedPartInfoLabel") } }));
  setAction(partInfoBtn, "copy-selected-part-info");
  partInfoBtn.appendChild(createSvgIcon(`<path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="4"/><path d="M17 19h5"/><path d="M17 16h5"/><path d="M17 22h5"/>`));
  partInfoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.exportSelectedPartInfo) return;
    try {
      const md = preview.exportSelectedPartInfo();
      if (!md) {
        showTooltip(partInfoBtn, t("helper.noSelectedPart"));
        return;
      }
      void navigator.clipboard.writeText(md).then(() => {
        showTooltip(partInfoBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(partInfoBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Export selected part info failed:", err);
      showTooltip(partInfoBtn, t("helper.failed"));
    }
  });

  // Wireframe toggle button (grid/square icon)
  const wireBtn = viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleWireframeLabel"), "aria-pressed": "false" },
  });
  setAction(wireBtn, "toggle-wireframe");
  wireBtn.appendChild(createSvgIcon(`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/>`));
  wireBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleWireframe) return;
    const on = preview.toggleWireframe();
    setTogglePressed(wireBtn, on);
    showTooltip(wireBtn, on ? t("helper.wireframeOn") : t("helper.wireframeOff"));
  });

  // Orientation gizmo toggle button (compass/axis icon)
  const gizmoBtn = viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleAxesLabel"), "aria-pressed": "false" },
  });
  setAction(gizmoBtn, "toggle-axes");
  gizmoBtn.appendChild(createSvgIcon(`<path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2l4 4"/><path d="M12 2l-4 4"/><path d="M22 12l-4-4"/><path d="M22 12l-4 4"/>`));
  gizmoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleOrientationGizmo) return;
    const on = preview.toggleOrientationGizmo();
    setTogglePressed(gizmoBtn, on);
    showTooltip(gizmoBtn, on ? t("helper.axesOn") : t("helper.axesOff"));
  });

  // Bounding box toggle button (cube outline icon)
  const bboxBtn = viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleBoundingBoxLabel"), "aria-pressed": "false" },
  });
  setAction(bboxBtn, "toggle-bounding-box");
  bboxBtn.appendChild(createSvgIcon(`<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`));
  bboxBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleBoundingBox) return;
    const on = preview.toggleBoundingBox();
    setTogglePressed(bboxBtn, on);
    showTooltip(bboxBtn, on ? t("helper.boundingBoxOn") : t("helper.boundingBoxOff"));
  });

  // Focus selected mesh button (click a part to isolate it visually)
  const focusBtn = inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleFocusSelectionLabel"), "aria-pressed": "false" },
  });
  setAction(focusBtn, "toggle-focus");
  focusBtn.appendChild(createSvgIcon(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M4.93 4.93l2.12 2.12"/><path d="M16.95 16.95l2.12 2.12"/><path d="M19.07 4.93l-2.12 2.12"/><path d="M7.05 16.95l-2.12 2.12"/>`));
  focusBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsFocusSelectionPreview(preview)) return;
    if (!preview.isFocusSelectionEnabled()) deactivateAnnotationForPreviewMode();
    const on = preview.toggleFocusSelection();
    syncCapabilities();
    showTooltip(focusBtn, on ? t("helper.focusSelectionOn") : t("helper.focusSelectionOff"));
  });

  // Disassembly mode toggle button (separate parts by dragging)
  const disassembleBtn = inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleDisassemblyLabel"), "aria-pressed": "false" },
  });
  setAction(disassembleBtn, "toggle-disassembly");
  disassembleBtn.appendChild(createSvgIcon(`<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 17h6"/><path d="M17 14v6"/>`));
  disassembleBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsDisassemblyPreview(preview)) return;
    if (!preview.isDisassemblyEnabled()) deactivateAnnotationForPreviewMode();
    const on = preview.toggleDisassembly();
    syncCapabilities();
    showTooltip(disassembleBtn, on ? t("helper.disassemblyOn") : t("helper.disassemblyOff"));
  });

  // Slice mode toggle button (stacked section planes)
  const sliceBtn = inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn ai3d-slice-btn is-hidden",
    attr: { "aria-label": t("helper.toggleSliceLabel"), "aria-pressed": "false" },
  });
  setAction(sliceBtn, "toggle-slice");
  sliceBtn.appendChild(createSvgIcon(`<path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/><path d="M4 12l3-1.5"/><path d="M17 10.5l3 1.5"/>`));
  sliceBtn.createSpan({ cls: "ai3d-slice-btn-text", text: t("helper.sliceButtonText") });
  sliceBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsSlicePreview(preview)) return;
    if (!preview.isSliceActive()) deactivateAnnotationForPreviewMode();
    const active = preview.toggleSlice();
    syncCapabilities();
    showTooltip(sliceBtn, active ? t("helper.sliceOn") : t("helper.sliceOff"));
  });

  // Render scale cycle button (canvas resolution percentage, not model size)
  const configuredScale = normalizeRenderScale(getSettings?.().renderScale ?? 1.0);
  let resIndex = findNearestRenderScaleIndex(configuredScale);
  const resBtn = markSecondary(viewGroup.createEl("button", { cls: "ai3d-inline-btn ai3d-res-btn", attr: { "aria-label": t("helper.changeResolutionLabel") } }));
  setAction(resBtn, "change-resolution");
  function syncRenderScaleButton(preview: RenderScalePreview | null = null): void {
    const scale = readRenderScale(preview, getSettings?.().renderScale ?? RENDER_SCALE_PRESETS[resIndex] ?? 1.0);
    resIndex = findNearestRenderScaleIndex(scale);
    const displayValue = formatRenderScale(scale);
    resBtn.textContent = displayValue;
  }
  syncRenderScaleButton();
  resBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsRenderScalePreview(preview)) return;
    const currentIndex = findNearestRenderScaleIndex(readRenderScale(preview, RENDER_SCALE_PRESETS[resIndex]));
    resIndex = (currentIndex + 1) % RENDER_SCALE_PRESETS.length;
    const applied = preview.setRenderScale(RENDER_SCALE_PRESETS[resIndex]);
    const displayScale = readRenderScale(preview, applied);
    syncRenderScaleButton(preview);
    showTooltip(resBtn, formatT("helper.resolutionValue", { value: formatRenderScale(displayScale) }));
  });

  // Animation play/pause button (play triangle — hidden until animations detected)
  const animBtn = markSecondary(viewGroup.createEl("button", {
    cls: "ai3d-inline-btn is-hidden",
    attr: { "aria-label": t("helper.toggleAnimationLabel"), "aria-pressed": "false" },
  }));
  setAction(animBtn, "toggle-animation");
  animBtn.appendChild(createSvgIcon(`<polygon points="5 3 19 12 5 21 5 3"/>`));
  animBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleAnimation) return;
    const playing = preview.toggleAnimation();
    animBtn.replaceChildren(createSvgIcon(playing
      ? `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
      : `<polygon points="5 3 19 12 5 21 5 3"/>`));
    setTogglePressed(animBtn, playing);
    showTooltip(animBtn, playing ? t("helper.playing") : t("helper.paused"));
  });

  // Measurement toggle button (ruler) — primary so users can discover it
  // without expanding the "more" menu.
  const measureBtn = inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn is-hidden",
    attr: { "aria-label": t("helper.toggleMeasurementLabel"), "aria-pressed": "false" },
  });
  setAction(measureBtn, "toggle-measurement");
  measureBtn.appendChild(createSvgIcon(`<line x1="2" y1="21" x2="22" y2="21"/><line x1="2" y1="3" x2="22" y2="3"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="6" y1="3" x2="6" y2="12"/><line x1="12" y1="3" x2="12" y2="12"/><line x1="18" y1="3" x2="18" y2="12"/>`));
  measureBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    if (!preview.isMeasurementActive()) deactivateAnnotationForPreviewMode();
    const active = preview.toggleMeasurement();
    syncCapabilities();
    showTooltip(measureBtn, active ? t("helper.measurementOn") : t("helper.measurementOff"));
    if (!active) {
      setTogglePressed(clearMeasureBtn, false);
    }
  });

  function clearMeasurementRecords(trigger: HTMLElement): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    preview.clearMeasurements();
    setTogglePressed(measureBtn, preview.isMeasurementActive());
    syncMeasurementDetails();
    showTooltip(trigger, t("helper.measurementsCleared"));
  }

  function copyMeasurementRecords(trigger: HTMLElement): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    const markdown = preview.exportMeasurements();
    if (!markdown) {
      showTooltip(trigger, t("helper.noMeasurements"));
      return;
    }
    void navigator.clipboard.writeText(markdown).then(() => {
      showTooltip(trigger, t("helper.measurementsCopied"));
    }).catch(() => {
      showTooltip(trigger, t("helper.failed"));
    });
  }

  const measurementStrip = inspectGroup.createEl("button", {
    cls: "ai3d-measurement-strip is-hidden",
    attr: {
      "aria-expanded": "false",
      "aria-label": t("helper.calibrateLabel"),
    },
  });
  setAction(measurementStrip, "toggle-measurement-details");
  measurementStrip.setAttribute("aria-live", "polite");
  const measurementStripValue = measurementStrip.createSpan({ cls: "ai3d-measurement-strip-value" });
  const measurementStripMeta = measurementStrip.createSpan({ cls: "ai3d-measurement-strip-meta" });

  function getMeasurementPreview(): MeasurementPreview | null {
    const preview = getPreview();
    return preview && supportsMeasurementPreview(preview) ? preview : null;
  }

  function bindMeasurementPreview(preview: MeasurementPreview | null): void {
    if (preview === boundMeasurementPreview) return;
    releaseMeasurementObserver?.();
    releaseMeasurementObserver = null;
    boundMeasurementPreview = preview;
    if (preview?.observeMeasurements) {
      releaseMeasurementObserver = preview.observeMeasurements(() => {
        syncToggleStates();
        syncMeasurementDetails();
      });
    }
  }

  function getMeasurementStatusValue(state: MeasurementState): string {
    if (state.phase === "select-target") {
      return t("helper.measurementSelectTarget");
    }
    if (state.phase === "picking-end" && state.snapKind) {
      return getMeasurementSnapLabel(state.snapKind);
    }
    if (state.phase === "picking-end") {
      return t("helper.measurementPickEnd");
    }
    const latest = state.records[state.records.length - 1] ?? null;
    if (latest) {
      return formatMeasurementValue(latest.reading.distance, latest.reading.unit);
    }
    if (state.snapKind) {
      return getMeasurementSnapLabel(state.snapKind);
    }
    if (state.phase === "ready") {
      return t("helper.measurementPickStart");
    }
    if (state.phase === "reviewing") {
      return t("helper.measurementReviewing");
    }
    return t("helper.measurementStripEmpty");
  }

  function getMeasurementSnapLabel(kind: MeasurementSnapKind): string {
    switch (kind) {
      case "vertex":
        return t("helper.measurementSnapVertex");
      case "edge":
        return t("helper.measurementSnapEdge");
      case "free":
        return t("helper.measurementSnapFree");
    }
  }

  function getMeasurementStatusMeta(state: MeasurementState): string {
    if (state.records.length > 0) {
      return formatT("helper.measurementStripSaved", { count: String(state.records.length) });
    }
    if (state.phase === "select-target") {
      return t("helper.measurementTargetMissing");
    }
    if (state.targetScope === "model") {
      return t("helper.measurementTargetModel");
    }
    if (state.targetName) {
      return formatT("helper.measurementTargetLabel", { target: state.targetName });
    }
    return state.unit;
  }

  function syncMeasurementDetails(): void {
    const preview = getMeasurementPreview();
    bindMeasurementPreview(preview);
    if (!preview) {
      measurementStrip.classList.add("is-hidden");
      measurementDetails.classList.add("is-hidden");
      measurementStrip.classList.remove("is-expanded");
      measurementStrip.setAttribute("aria-expanded", "false");
      copyMeasureBtn.disabled = true;
      clearMeasureBtn.disabled = true;
      return;
    }

    const state = preview.getMeasurementState();
    const active = state.active;
    const records = state.records;
    const hasRecords = records.length > 0;

    measurementStrip.classList.toggle("is-hidden", state.phase === "inactive");
    if (!active && !hasRecords) {
      measurementDetails.classList.add("is-hidden");
      measurementStrip.classList.remove("is-expanded");
      measurementStrip.setAttribute("aria-expanded", "false");
    }
    measurementStrip.classList.toggle("is-active", active);
    measurementStrip.classList.toggle("is-pending", state.phase === "picking-end");
    measurementStrip.classList.toggle("is-targeting", state.phase === "select-target");
    measurementStrip.classList.toggle("is-reviewing", state.phase === "reviewing");
    measurementStrip.classList.toggle("has-records", hasRecords);
    measurementStrip.dataset.ai3dMeasurementPhase = state.phase;
    measurementStripValue.textContent = getMeasurementStatusValue(state);
    measurementStripMeta.textContent = getMeasurementStatusMeta(state);
    measurementStrip.setAttribute("aria-label", [
      t("helper.measurementStripTitle"),
      measurementStripValue.textContent,
      measurementStripMeta.textContent,
      t("helper.calibrateLabel"),
    ].filter(Boolean).join(" "));
    recordsSummary.textContent = hasRecords
      ? formatT("helper.measurementStripSaved", { count: String(records.length) })
      : t("helper.measurementNoRecords");
    const canExport = hasRecords;
    copyMeasureBtn.disabled = !canExport;
    clearMeasureBtn.disabled = !canExport;
    setTogglePressed(measureBtn, active);
  }

  // Copy snapshot button (clipboard)
  const copyBtn = outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copySnapshotLabel") } });
  setAction(copyBtn, "copy-snapshot");
  copyBtn.appendChild(createSvgIcon(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>`));
  copyBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const blob = dataUrlToBlob(dataUrl);
      void navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]).then(() => {
        showTooltip(copyBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(copyBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Copy snapshot failed:", err);
      showTooltip(copyBtn, t("helper.failed"));
    }
  });

  // Save to vault button (disk)
  const saveBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.saveSnapshotLabel") } }));
  setAction(saveBtn, "save-snapshot");
  saveBtn.appendChild(createSvgIcon(`<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`));
  saveBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const modelPath = getModelPath();
      const baseName = getPortableStem(modelPath) || "model";
      const settings = getSettings?.();
      const folder = settings?.snapshotFolder ?? "Media/3D Previews";
      const naming = settings?.snapshotNaming ?? "model-name";
      const ts = Date.now();
      const fileName = naming === "timestamp"
        ? `snapshot_${ts}.png`
        : `${baseName}_snapshot_${ts}.png`;

      const blob = dataUrlToBlob(dataUrl);
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        void app.vault.adapter.exists(folder).then((exists) => {
          const create = exists ? Promise.resolve() : app.vault.createFolder(folder).catch((err: unknown) => {
            log.warn("Failed to create vault folder", { path: folder, error: String(err) });
          });
          return create;
        }).then(() => {
          return app.vault.createBinary(`${folder}/${fileName}`, buffer);
        }).then(() => {
          showTooltip(saveBtn, t("helper.saved"));
        }).catch((err: unknown) => {
          console.error("[AI3D] Save snapshot failed:", err);
          showTooltip(saveBtn, t("helper.failed"));
        });
      };
      reader.onerror = () => {
        console.error("[AI3D] FileReader error");
        showTooltip(saveBtn, t("helper.failed"));
      };
      reader.onabort = () => {
        console.error("[AI3D] FileReader aborted");
        showTooltip(saveBtn, t("helper.failed"));
      };
      reader.readAsArrayBuffer(blob);
    } catch (err) {
      console.error("[AI3D] Save snapshot failed:", err);
      showTooltip(saveBtn, t("helper.failed"));
    }
  });

  // Download snapshot button (download arrow)
  const downloadBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.downloadSnapshotLabel") } }));
  setAction(downloadBtn, "download-snapshot");
  downloadBtn.appendChild(createSvgIcon(`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`));
  downloadBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const modelPath = getModelPath();
      const baseName = getPortableStem(modelPath) || "model";
      const fileName = `${baseName}_snapshot_${Date.now()}.png`;

      const a = createEl("a");
      a.href = dataUrl;
      a.download = fileName;
      activeDocument.body.appendChild(a);
      a.click();
      a.remove();
      showTooltip(downloadBtn, t("helper.downloaded"));
    } catch (err) {
      console.error("[AI3D] Download snapshot failed:", err);
      showTooltip(downloadBtn, t("helper.failed"));
    }
  });

  // Remove button (trash) — kept at the far right as a destructive secondary action
  const removeBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.removePreviewLabel") } }));
  setAction(removeBtn, "remove-preview");
  removeBtn.appendChild(createSvgIcon(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>`));
  removeBtn.addEventListener("click", onRemove);

  // Annotation toggle button (tag/label icon — hidden until explicitly shown)
  const annotBtn = inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn is-hidden ai3d-annot-btn",
    attr: { "aria-label": t(resolvedAnnotationCopy.labelKey), "aria-pressed": "false" },
  });
  setAction(annotBtn, "toggle-annotation");
  annotBtn.appendChild(createSvgIcon(`<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`));
  const annotBadge = annotBtn.createSpan({ cls: "ai3d-pin-badge is-hidden" });
  annotBtn.addEventListener("click", () => {
    if (!onToggleAnnotate) return;
    if (!annotationActive) deactivatePreviewModesForAnnotation();
    const active = onToggleAnnotate();
    annotationActive = active;
    syncCapabilities();
    showTooltip(
      annotBtn,
      active ? t(resolvedAnnotationCopy.activeTooltipKey) : t(resolvedAnnotationCopy.inactiveTooltipKey),
    );
  });

  const showMoreBtn = toolbar.createEl("button", {
    cls: "ai3d-inline-btn ai3d-mobile-more-toggle",
    attr: { "aria-label": t("helper.showMoreActionsLabel"), "aria-pressed": "false" },
  });
  showMoreBtn.appendChild(createSvgIcon(`<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>`));
  showMoreBtn.addEventListener("click", () => {
    toolbarExpanded = !toolbarExpanded;
    showMoreBtn.setAttribute("aria-label", toolbarExpanded ? t("helper.hideMoreActionsLabel") : t("helper.showMoreActionsLabel"));
    renderToolbarButtons();
    showTooltip(showMoreBtn, toolbarExpanded ? t("helper.moreActionsShown") : t("helper.moreActionsHidden"));
  });

  // Move toolbar to sit right after previewHost
  parentEl.insertBefore(toolbar, previewHost.nextSibling);

  // Measurement details live inside the helper toolbar so the mode feels native to the inspector controls.
  const measurementDetails = toolbar.createDiv({ cls: "ai3d-measurement-details is-hidden" });
  measurementDetails.setAttribute("role", "group");
  measurementDetails.setAttribute("aria-label", t("helper.calibrateTitle"));
  measurementDetails.addEventListener("pointerdown", stopToolbarEvent);
  measurementDetails.addEventListener("mousedown", stopToolbarEvent);
  measurementDetails.addEventListener("click", stopToolbarEvent);
  measurementDetails.createDiv({ cls: "ai3d-measurement-details-title", text: t("helper.calibrateTitle") });
  const recordsSection = measurementDetails.createDiv({ cls: "ai3d-measurement-section ai3d-measurement-records-section" });
  recordsSection.createDiv({ cls: "ai3d-measurement-section-title", text: t("helper.measurementRecordsTitle") });
  const measurementActionsRow = recordsSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-detail-actions" });
  const recordsSummary = measurementActionsRow.createSpan({ cls: "ai3d-measurement-record-summary" });
  const copyMeasureBtn = measurementActionsRow.createEl("button", {
    cls: "ai3d-inline-btn ai3d-measurement-detail-action",
    attr: { "aria-label": t("helper.copyMeasurementsLabel") },
  });
  setAction(copyMeasureBtn, "copy-measurements");
  copyMeasureBtn.appendChild(createSvgIcon(`<path d="M4 19h16"/><path d="M7 16V8"/><path d="M12 16V5"/><path d="M17 16v-6"/><path d="M4 4h16"/>`));
  copyMeasureBtn.addEventListener("click", () => {
    copyMeasurementRecords(copyMeasureBtn);
  });
  const clearMeasureBtn = measurementActionsRow.createEl("button", {
    cls: "ai3d-inline-btn ai3d-measurement-detail-action",
    attr: { "aria-label": t("helper.clearMeasurementsLabel") },
  });
  setAction(clearMeasureBtn, "clear-measurements");
  clearMeasureBtn.appendChild(createSvgIcon(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>`));
  clearMeasureBtn.addEventListener("click", () => {
    clearMeasurementRecords(clearMeasureBtn);
  });
  const calibrationSection = measurementDetails.createDiv({ cls: "ai3d-measurement-section ai3d-measurement-calibration-section" });
  calibrationSection.createDiv({ cls: "ai3d-measurement-section-title", text: t("helper.measurementCalibrationTitle") });
  const unitRow = calibrationSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-unit-row" });
  unitRow.createSpan({ cls: "ai3d-measurement-detail-label", text: t("helper.measurementUnitLabel") });
  const unitSelect = unitRow.createEl("select", { cls: "ai3d-measurement-detail-select" });
  for (const unit of ["um", "mm", "cm", "m"] as const) {
    const option = unitSelect.createEl("option");
    option.value = unit;
    option.textContent = unit;
  }
  unitSelect.value = "mm";
  const referenceRow = calibrationSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-reference-row" });
  referenceRow.createSpan({ cls: "ai3d-measurement-detail-label", text: t("helper.calibrateReference") });
  const referenceValue = referenceRow.createSpan({ cls: "ai3d-measurement-detail-readonly ai3d-measurement-reference-value" });
  const referenceInput = referenceRow.createEl("input", {
    cls: "ai3d-measurement-detail-input ai3d-measurement-reference-input",
    attr: { type: "number", step: "any", min: "0", placeholder: t("helper.calibrateReferencePlaceholder") },
  });
  const referenceApplyBtn = referenceRow.createEl("button", {
    cls: "ai3d-inline-btn ai3d-measurement-reference-apply",
    text: t("helper.calibrateReferenceApply"),
    attr: { type: "button" },
  });
  setAction(referenceApplyBtn, "calibrate-reference");

  const sizeSection = measurementDetails.createDiv({ cls: "ai3d-measurement-section ai3d-measurement-size-section" });
  sizeSection.createDiv({ cls: "ai3d-measurement-section-title", text: t("helper.measurementModelSizeTitle") });
  const boundsRow = sizeSection.createDiv({ cls: "ai3d-measurement-detail-row" });
  boundsRow.createSpan({ cls: "ai3d-measurement-detail-label", text: t("helper.calibrateCurrent") });
  const boundsX = boundsRow.createSpan({ cls: "ai3d-measurement-detail-readonly" });
  const boundsY = boundsRow.createSpan({ cls: "ai3d-measurement-detail-readonly" });
  const boundsZ = boundsRow.createSpan({ cls: "ai3d-measurement-detail-readonly" });

  const realRow = sizeSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-size-row" });
  realRow.createSpan({ cls: "ai3d-measurement-detail-label", text: t("helper.calibrateReal") });
  const inputX = realRow.createEl("input", { cls: "ai3d-measurement-detail-input", attr: { type: "number", step: "any", placeholder: "X" } });
  const inputY = realRow.createEl("input", { cls: "ai3d-measurement-detail-input", attr: { type: "number", step: "any", placeholder: "Y" } });
  const inputZ = realRow.createEl("input", { cls: "ai3d-measurement-detail-input", attr: { type: "number", step: "any", placeholder: "Z" } });

  const sizeOptionsRow = sizeSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-size-options" });
  const lockLabel = sizeOptionsRow.createEl("label", { cls: "ai3d-measurement-detail-lock" });
  const lockCheck = lockLabel.createEl("input", { attr: { type: "checkbox", checked: "true" } });
  lockLabel.appendChild(activeDocument.createTextNode(" " + t("helper.calibrateLock")));

  const btnRow = sizeSection.createDiv({ cls: "ai3d-measurement-detail-row ai3d-measurement-detail-scale-actions" });
  const applyBtn = btnRow.createEl("button", { cls: "ai3d-inline-btn", text: t("helper.calibrateApply") });
  const resetBtn2 = btnRow.createEl("button", { cls: "ai3d-inline-btn", text: t("helper.calibrateReset") });

  let originalBounds: { x: number; y: number; z: number } | null = null;

  function getLatestMeasurementRecord(): ReturnType<MeasurementPreview["getMeasurementRecords"]>[number] | null {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return null;
    const records = preview.getMeasurementState().records;
    return records[records.length - 1] ?? null;
  }

  function updateBoundsDisplay(): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    const state = preview.getMeasurementState();
    const bounds = state.bounds;
    const scale = state.scale;
    unitSelect.value = state.unit;
    originalBounds = bounds;
    if (bounds) {
      const unit = state.unit;
      boundsX.textContent = `X: ${formatMeasurementNumber(bounds.x * scale.x)} ${unit}`;
      boundsY.textContent = `Y: ${formatMeasurementNumber(bounds.y * scale.y)} ${unit}`;
      boundsZ.textContent = `Z: ${formatMeasurementNumber(bounds.z * scale.z)} ${unit}`;
    } else {
      boundsX.textContent = "X: -";
      boundsY.textContent = "Y: -";
      boundsZ.textContent = "Z: -";
    }
    const latest = getLatestMeasurementRecord();
    referenceValue.textContent = latest
      ? formatMeasurementValue(latest.reading.distance, latest.reading.unit, false)
      : t("helper.calibrateReferenceEmpty");
    referenceInput.disabled = !latest;
    referenceApplyBtn.disabled = !latest;
    referenceInput.placeholder = latest
      ? formatMeasurementNumber(latest.reading.distance)
      : t("helper.calibrateReferencePlaceholder");
  }

  function applyScaleFromInputs(): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview) || !originalBounds) return;
    const vx = parseFloat(inputX.value);
    const vy = parseFloat(inputY.value);
    const vz = parseFloat(inputZ.value);
    const scale = createBoundsMeasurementScale(
      originalBounds,
      {
        x: Number.isFinite(vx) ? vx : undefined,
        y: Number.isFinite(vy) ? vy : undefined,
        z: Number.isFinite(vz) ? vz : undefined,
      },
      preview.getMeasurementScale(),
      lockCheck.checked,
    );
    if (!scale) {
      showTooltip(applyBtn, t("helper.calibrateNeedsValue"));
      return;
    }
    preview.setMeasurementUnit?.(unitSelect.value as MeasurementUnit);
    preview.setMeasurementScale?.(scale);
    prepareMeasurementDetails();
    syncMeasurementDetails();
    showTooltip(applyBtn, t("helper.calibrated"));
  }

  function applyScaleFromLatestMeasurement(): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    const realDistance = parseFloat(referenceInput.value);
    preview.setMeasurementUnit?.(unitSelect.value as MeasurementUnit);
    const latest = getLatestMeasurementRecord();
    if (!latest || !Number.isFinite(realDistance) || realDistance <= 0) {
      showTooltip(referenceApplyBtn, t("helper.calibrateNeedsValue"));
      return;
    }
    const nextScale = createReferenceMeasurementScale(
      preview.getMeasurementScale(),
      latest.reading.distance,
      realDistance,
    );
    if (!nextScale) {
      showTooltip(referenceApplyBtn, t("helper.calibrateNeedsValue"));
      return;
    }
    preview.setMeasurementScale?.(nextScale);
    referenceInput.value = "";
    prepareMeasurementDetails();
    syncMeasurementDetails();
    showTooltip(referenceApplyBtn, t("helper.calibrated"));
  }

  function resetScale(): void {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    preview.setMeasurementUnit?.(unitSelect.value as MeasurementUnit);
    preview.setMeasurementScale?.({ x: 1, y: 1, z: 1 });
    referenceInput.value = "";
    prepareMeasurementDetails();
    syncMeasurementDetails();
    showTooltip(resetBtn2, t("helper.calibrateResetDone"));
  }

  function onRealInputChanged(changedAxis: "x" | "y" | "z"): void {
    if (!lockCheck.checked || !originalBounds) return;
    const target = changedAxis === "x" ? inputX : changedAxis === "y" ? inputY : inputZ;
    const val = parseFloat(target.value);
    if (!isFinite(val) || val === 0) return;
    const orig = originalBounds[changedAxis];
    if (orig <= 0.0001) return;
    const ratio = val / orig;
    if (changedAxis !== "x") inputX.value = formatMeasurementNumber(originalBounds.x * ratio);
    if (changedAxis !== "y") inputY.value = formatMeasurementNumber(originalBounds.y * ratio);
    if (changedAxis !== "z") inputZ.value = formatMeasurementNumber(originalBounds.z * ratio);
  }

  inputX.addEventListener("input", () => onRealInputChanged("x"));
  inputY.addEventListener("input", () => onRealInputChanged("y"));
  inputZ.addEventListener("input", () => onRealInputChanged("z"));
  unitSelect.addEventListener("change", () => {
    const preview = getPreview();
    if (!preview || !supportsMeasurementPreview(preview)) return;
    preview.setMeasurementUnit(unitSelect.value as MeasurementUnit);
    prepareMeasurementDetails();
    syncMeasurementDetails();
  });
  referenceApplyBtn.addEventListener("click", applyScaleFromLatestMeasurement);
  applyBtn.addEventListener("click", applyScaleFromInputs);
  resetBtn2.addEventListener("click", resetScale);

  function prepareMeasurementDetails(): void {
    updateBoundsDisplay();
    if (originalBounds) {
      const preview = getPreview();
      const scale = preview && supportsMeasurementPreview(preview)
        ? preview.getMeasurementScale()
        : { x: 1, y: 1, z: 1 };
      inputX.value = formatMeasurementNumber(originalBounds.x * scale.x);
      inputY.value = formatMeasurementNumber(originalBounds.y * scale.y);
      inputZ.value = formatMeasurementNumber(originalBounds.z * scale.z);
    } else {
      inputX.value = "";
      inputY.value = "";
      inputZ.value = "";
    }
  }

  function setMeasurementDetailsOpen(open: boolean, trigger: HTMLElement): void {
    if (open) {
      prepareMeasurementDetails();
    }
    measurementDetails.classList.toggle("is-hidden", !open);
    measurementStrip.classList.toggle("is-expanded", open);
    measurementStrip.setAttribute("aria-expanded", String(open));
    syncMeasurementDetails();
    showTooltip(trigger, open ? t("helper.calibrateOpen") : t("helper.calibrateClose"));
  }

  measurementStrip.addEventListener("click", () => {
    if (measurementStrip.classList.contains("is-hidden")) return;
    setMeasurementDetailsOpen(measurementDetails.classList.contains("is-hidden"), measurementStrip);
  });

  const sliceDetails = toolbar.createDiv({ cls: "ai3d-slice-details is-hidden" });
  sliceDetails.setAttribute("role", "group");
  sliceDetails.setAttribute("aria-label", t("helper.sliceTitle"));
  sliceDetails.addEventListener("pointerdown", stopToolbarEvent);
  sliceDetails.addEventListener("mousedown", stopToolbarEvent);
  sliceDetails.addEventListener("click", stopToolbarEvent);
  const sliceHeader = sliceDetails.createDiv({ cls: "ai3d-slice-header" });
  sliceHeader.createSpan({ cls: "ai3d-slice-title", text: t("helper.sliceTitle") });
  const sliceSummary = sliceHeader.createSpan({ cls: "ai3d-slice-summary" });
  const sliceResetBtn = sliceHeader.createEl("button", {
    cls: "ai3d-slice-reset-btn",
    attr: { type: "button", "aria-label": t("helper.sliceReset") },
  });
  sliceResetBtn.appendChild(createSvgIcon(`<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`));
  const sliceOffsetRow = sliceDetails.createDiv({ cls: "ai3d-slice-row ai3d-slice-status-row" });
  sliceOffsetRow.createSpan({ cls: "ai3d-slice-label", text: t("helper.sliceOffsetLabel") });
  const sliceOffsetControl = sliceOffsetRow.createDiv({ cls: "ai3d-slice-number-control" });
  const sliceOffsetInput = sliceOffsetControl.createEl("input", {
    cls: "ai3d-slice-number-input ai3d-slice-offset-value",
    attr: { type: "number", min: "0", max: "100", step: "0.1", inputmode: "decimal" },
  });
  sliceOffsetControl.createSpan({ cls: "ai3d-slice-number-unit", text: "%" });
  const sliceRotationRow = sliceDetails.createDiv({ cls: "ai3d-slice-row ai3d-slice-rotation-row" });
  sliceRotationRow.createSpan({ cls: "ai3d-slice-label", text: t("helper.sliceRotationLabel") });
  const rotationInputs = {} as Record<"x" | "y" | "z", HTMLInputElement>;
  for (const axis of ["x", "y", "z"] as const) {
    const control = sliceRotationRow.createDiv({ cls: `ai3d-slice-axis-control ai3d-slice-axis-${axis}` });
    control.createSpan({ cls: "ai3d-slice-axis-label", text: axis.toUpperCase() });
    rotationInputs[axis] = control.createEl("input", {
      cls: "ai3d-slice-number-input ai3d-slice-rotation-input",
      attr: {
        type: "number",
        min: "-180",
        max: "180",
        step: "0.1",
        inputmode: "decimal",
        "aria-label": `${t("helper.sliceRotationLabel")} ${axis.toUpperCase()}`,
      },
    });
    control.createSpan({ cls: "ai3d-slice-number-unit", text: "°" });
  }
  const sliceModeRow = sliceDetails.createDiv({ cls: "ai3d-slice-row ai3d-slice-mode-row is-hidden" });
  sliceModeRow.createSpan({ cls: "ai3d-slice-label", text: t("helper.sliceModeLabel") });
  const sliceModeGroup = sliceModeRow.createDiv({ cls: "ai3d-slice-mode-buttons" });
  const sliceModeButtons = {} as Record<SliceInteractionMode, HTMLButtonElement>;
  const createSliceModeButton = (mode: SliceInteractionMode, labelKey: TranslationKey): void => {
    const button = sliceModeGroup.createEl("button", {
      cls: "ai3d-slice-mode-btn",
      text: t(labelKey),
      attr: {
        type: "button",
        "aria-label": t(labelKey),
        "aria-pressed": "false",
      },
    });
    button.addEventListener("click", () => {
      const preview = getSlicePreview();
      if (!preview?.setSliceInteractionMode) return;
      preview.setSliceInteractionMode(mode);
      syncSliceDetails();
    });
    sliceModeButtons[mode] = button;
  };
  createSliceModeButton("move", "helper.sliceModeMove");
  createSliceModeButton("rotate", "helper.sliceModeRotate");

  function formatSliceInput(value: number): string {
    const rounded = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function getSlicePreview(): SlicePreview | null {
    const preview = getPreview();
    return preview && supportsSlicePreview(preview) ? preview : null;
  }

  function resetSliceControls(): void {
    const preview = getSlicePreview();
    if (!preview) return;
    preview.resetSlicePlane();
    syncSliceDetails();
  }

  function bindSlicePreview(preview: SlicePreview | null): void {
    if (preview === boundSlicePreview) return;
    releaseSliceObserver?.();
    releaseSliceObserver = null;
    boundSlicePreview = preview;
    if (preview?.observeSlice) {
      releaseSliceObserver = preview.observeSlice(() => {
        syncToggleStates();
        syncSliceDetails();
      });
    }
  }

  function syncSliceDetails(): void {
    const preview = getSlicePreview();
    bindSlicePreview(preview);
    if (!preview) {
      sliceDetails.classList.add("is-hidden");
      return;
    }
    const state: SliceState = preview.getSliceState();
    setTogglePressed(sliceBtn, state.active);
    sliceDetails.classList.toggle("is-hidden", !state.active);
    const supportsInteractionMode = typeof preview.setSliceInteractionMode === "function";
    sliceModeRow.classList.toggle("is-hidden", !supportsInteractionMode);
    if (supportsInteractionMode) {
      for (const mode of ["move", "rotate"] as const) {
        setTogglePressed(sliceModeButtons[mode], state.interactionMode === mode);
      }
    }
    if (activeDocument.activeElement !== sliceOffsetInput) {
      sliceOffsetInput.value = formatSliceInput(Math.max(0, Math.min(state.offset, 1)) * 100);
    }
    const rotation = state.rotationDegrees ?? { x: 0, y: 0, z: 0 };
    for (const axis of ["x", "y", "z"] as const) {
      if (activeDocument.activeElement !== rotationInputs[axis]) {
        rotationInputs[axis].value = formatSliceInput(rotation[axis]);
      }
    }
    sliceSummary.textContent = state.dragging
      ? t(state.interactionMode === "rotate" ? "helper.sliceRotating" : "helper.sliceMoving")
      : t(state.interactionMode === "rotate" ? "helper.sliceRotateReady" : "helper.sliceMoveReady");
  }

  sliceResetBtn.addEventListener("click", resetSliceControls);

  const applySliceOffsetInput = (): void => {
    const preview = getSlicePreview();
    if (!preview) return;
    const value = Number.parseFloat(sliceOffsetInput.value);
    if (!Number.isFinite(value)) {
      syncSliceDetails();
      return;
    }
    preview.setSliceOffset(Math.max(0, Math.min(value, 100)) / 100);
  };
  const applySliceRotationInputs = (): void => {
    const preview = getSlicePreview();
    if (!preview) return;
    const current = preview.getSliceState().rotationDegrees ?? { x: 0, y: 0, z: 0 };
    const parseAxis = (axis: "x" | "y" | "z"): number => {
      const value = Number.parseFloat(rotationInputs[axis].value);
      return Number.isFinite(value) ? value : current[axis];
    };
    preview.setSliceRotation({ x: parseAxis("x"), y: parseAxis("y"), z: parseAxis("z") });
  };
  sliceOffsetInput.addEventListener("change", applySliceOffsetInput);
  sliceOffsetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applySliceOffsetInput();
  });
  for (const axis of ["x", "y", "z"] as const) {
    rotationInputs[axis].addEventListener("change", applySliceRotationInputs);
    rotationInputs[axis].addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySliceRotationInputs();
    });
  }


  renderToolbarButtons();
  syncCapabilities();

  return {
    showAnimButton() {
      animBtn.classList.remove("is-hidden");
      syncGroupVisibility();
    },
    showAnnotateButton() {
      annotBtn.classList.remove("is-hidden");
      syncGroupVisibility();
    },
    updateAnnotationBadge(count: number) {
      if (count > 0) {
        annotBadge.textContent = String(count);
        annotBadge.classList.remove("is-hidden");
      } else {
        annotBadge.classList.add("is-hidden");
      }
    },
    setMobileInteractionMode(active: boolean) {
      if (!mobile) return;
      applyMobileInteractionMode(active);
    },
    syncCapabilities,
  };
}

// Track one tooltip per anchor to prevent stacking (#28)
const activeTooltips = new WeakMap<HTMLElement, HTMLElement>();

function showTooltip(anchor: HTMLElement, text: string): void {
  activeTooltips.get(anchor)?.remove();
  const tip = anchor.createSpan({ cls: "ai3d-tooltip" });
  tip.textContent = text;
  activeTooltips.set(anchor, tip);
  window.setTimeout(() => { tip.remove(); activeTooltips.delete(anchor); }, 1500);
}
