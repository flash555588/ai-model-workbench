import { formatT, t } from "../../i18n";
import {
  supportsCameraZoomPreview,
  type CameraZoomPreview,
  type CameraZoomState,
} from "../../render/preview/types";
import { createStagedEl } from "../../utils/dom";

export interface CameraZoomControl {
  sync(): void;
  destroy(): void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  return createStagedEl(tagName, className);
}

function clampZoomValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

export function createCameraZoomControl(
  host: HTMLElement,
  getPreview: () => unknown,
): CameraZoomControl {
  const shell = createElement("div", "ai3d-zoom-control is-hidden");
  const track = createElement("div", "ai3d-zoom-track");
  const fill = createElement("div", "ai3d-zoom-fill");
  const input = createElement("input", "ai3d-zoom-range");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "1";
  input.value = "0";
  input.setAttribute("aria-label", t("helper.cameraZoomLabel"));
  input.setAttribute("aria-orientation", "vertical");
  track.appendChild(fill);
  shell.append(track, input);
  host.appendChild(shell);

  let boundPreview: CameraZoomPreview | null = null;
  let releaseObserver: (() => void) | null = null;
  let draggingPointerId: number | null = null;

  const stopOverlayEvent = (event: Event): void => {
    event.stopPropagation();
  };
  shell.addEventListener("mousedown", stopOverlayEvent);
  shell.addEventListener("click", stopOverlayEvent);

  function getSupportedPreview(): CameraZoomPreview | null {
    const preview = getPreview();
    return supportsCameraZoomPreview(preview) ? preview : null;
  }

  function updateFromState(state: CameraZoomState | null): void {
    if (!state) {
      shell.classList.add("is-hidden");
      input.disabled = true;
      return;
    }

    const value = clampZoomValue(state.value);
    const percent = Math.round(value * 100);
    input.disabled = false;
    input.value = String(percent);
    shell.style.setProperty("--ai3d-zoom-percent", `${percent}%`);
    const label = formatT("helper.cameraZoomValue", { value: `${state.percentage}%` });
    input.setAttribute("aria-valuenow", String(percent));
    input.setAttribute("aria-valuetext", label);
    shell.classList.remove("is-hidden");
  }

  function bindPreview(preview: CameraZoomPreview | null): void {
    if (preview === boundPreview) return;
    releaseObserver?.();
    releaseObserver = null;
    boundPreview = preview;
    if (preview?.observeCameraZoom) {
      releaseObserver = preview.observeCameraZoom(updateFromState);
    }
  }

  function sync(): void {
    const preview = getSupportedPreview();
    bindPreview(preview);
    updateFromState(preview?.getCameraZoomState() ?? null);
  }

  function applyInputValue(): void {
    applyZoomValue(input.valueAsNumber / 100);
  }

  function applyZoomValue(value: number): void {
    const preview = boundPreview ?? getSupportedPreview();
    if (!preview) {
      sync();
      return;
    }
    bindPreview(preview);
    updateFromState(preview.setCameraZoom(clampZoomValue(value)));
  }

  function getPointerZoomValue(clientY: number): number {
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return input.valueAsNumber / 100;
    return 1 - ((clientY - rect.top) / rect.height);
  }

  function applyPointerZoom(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    input.focus({ preventScroll: true });
    applyZoomValue(getPointerZoomValue(event.clientY));
  }

  function endDrag(event: PointerEvent): void {
    if (draggingPointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (shell.hasPointerCapture?.(event.pointerId)) {
      shell.releasePointerCapture(event.pointerId);
    }
    draggingPointerId = null;
    shell.classList.remove("is-dragging");
  }

  input.addEventListener("input", applyInputValue);
  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || input.disabled) {
      event.stopPropagation();
      return;
    }
    draggingPointerId = event.pointerId;
    shell.setPointerCapture?.(event.pointerId);
    shell.classList.add("is-dragging");
    applyPointerZoom(event);
  });
  shell.addEventListener("pointermove", (event) => {
    if (draggingPointerId !== event.pointerId) return;
    applyPointerZoom(event);
  });
  shell.addEventListener("pointerup", endDrag);
  shell.addEventListener("pointercancel", endDrag);
  shell.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY < 0 ? 6 : -6;
    input.value = String(Math.max(0, Math.min(100, input.valueAsNumber + delta)));
    applyInputValue();
  }, { passive: false });

  sync();

  return {
    sync,
    destroy() {
      releaseObserver?.();
      releaseObserver = null;
      boundPreview = null;
      shell.remove();
    },
  };
}
