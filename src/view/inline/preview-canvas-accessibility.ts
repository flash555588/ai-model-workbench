import { formatT, t, type TranslationKey } from "../../i18n";
import type { PreviewGridRenderer } from "../../render/preview/grid";
import type { ModelPreview } from "../../render/preview/types";
import { supportsMeasurementPreview } from "../../render/preview/types";
import { getPortableBasename } from "../../utils/resolve-path";

type PreviewCanvasSurface = "inline" | "grid" | "live-preview" | "direct-view";

const MODEL_SHORTCUTS = ["R", "W", "G", "B", "M", "Space"] as const;
const GRID_SHORTCUTS = ["R", "W"] as const;
const tabOrderObservers = new WeakSet<HTMLCanvasElement>();

const labelKeys: Record<PreviewCanvasSurface, TranslationKey> = {
  inline: "previewCanvas.inlineLabel",
  grid: "previewCanvas.gridLabel",
  "live-preview": "previewCanvas.liveLabel",
  "direct-view": "previewCanvas.directLabel",
};

export function configureModelPreviewCanvas(
  canvas: HTMLCanvasElement,
  surface: Exclude<PreviewCanvasSurface, "grid">,
  modelPath: string,
): void {
  const shortcutHint = t("previewCanvas.modelShortcuts");
  configurePreviewCanvas(canvas, {
    label: formatT(labelKeys[surface], {
      model: getPortableBasename(modelPath) || t("workbench.modelTitle"),
      shortcuts: shortcutHint,
    }),
    shortcutKeys: MODEL_SHORTCUTS,
    shortcutHint,
  });
}

export function configureGridPreviewCanvas(canvas: HTMLCanvasElement): void {
  const shortcutHint = t("previewCanvas.gridShortcuts");
  configurePreviewCanvas(canvas, {
    label: formatT(labelKeys.grid, { shortcuts: shortcutHint }),
    shortcutKeys: GRID_SHORTCUTS,
    shortcutHint,
  });
}

export function attachModelPreviewCanvasShortcuts(
  canvas: HTMLCanvasElement,
  getPreview: () => ModelPreview | null | undefined,
): void {
  canvas.addEventListener("keydown", (event) => {
    const preview = getPreview();
    if (!preview) return;

    const key = event.key.toLowerCase();
    if (key === "r") {
      preview.resetView?.();
      event.preventDefault();
    } else if (key === "w") {
      preview.toggleWireframe?.();
      event.preventDefault();
    } else if (key === "g") {
      preview.toggleOrientationGizmo?.();
      event.preventDefault();
    } else if (key === "b") {
      preview.toggleBoundingBox?.();
      event.preventDefault();
    } else if (key === " ") {
      preview.toggleAnimation?.();
      event.preventDefault();
    } else if (key === "m") {
      if (supportsMeasurementPreview(preview)) {
        preview.toggleMeasurement();
      }
      event.preventDefault();
    }
  });
}

export function attachGridPreviewCanvasShortcuts(
  canvas: HTMLCanvasElement,
  getRenderer: () => PreviewGridRenderer | null | undefined,
): void {
  canvas.addEventListener("keydown", (event) => {
    const renderer = getRenderer();
    if (!renderer) return;

    const key = event.key.toLowerCase();
    if (key === "r") {
      renderer.resetView?.();
      event.preventDefault();
    } else if (key === "w") {
      renderer.toggleWireframe?.();
      event.preventDefault();
    }
  });
}

function configurePreviewCanvas(
  canvas: HTMLCanvasElement,
  options: {
    label: string;
    shortcutKeys: readonly string[];
    shortcutHint: string;
  },
): void {
  keepNaturalTabOrder(canvas);
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", options.label);
  canvas.setAttribute("aria-keyshortcuts", options.shortcutKeys.join(" "));
  canvas.setAttribute("title", options.shortcutHint);
  canvas.dataset.testid = "ai3d-preview-canvas";
}

function keepNaturalTabOrder(canvas: HTMLCanvasElement): void {
  restoreNaturalTabOrder(canvas);
  if (tabOrderObservers.has(canvas) || typeof MutationObserver === "undefined") {
    return;
  }

  tabOrderObservers.add(canvas);
  const observer = new MutationObserver(() => restoreNaturalTabOrder(canvas));
  observer.observe(canvas, { attributes: true, attributeFilter: ["tabindex"] });
}

function restoreNaturalTabOrder(canvas: HTMLCanvasElement): void {
  if (canvas.tabIndex !== 0) {
    canvas.tabIndex = 0;
  }
  if (canvas.getAttribute("tabindex") !== "0") {
    canvas.setAttribute("tabindex", "0");
  }
}
