import { onLocaleChange, t, type TranslationKey } from "../../i18n";

/**
 * Reusable loading overlay for 3D model preview hosts.
 *
 * Shows a spinner + phase text + progress bar while a model is loading.
 * Call `setPhase()` to update the message, `setProgress(0-100)` for determinate progress,
 * and `hide()` when loading completes (fades out and removes from DOM).
 */

export interface LoadingOverlay {
  /** Update the phase description (e.g. "Converting CAD...", "Loading model..."). */
  setPhase(text: string): void;
  /** Update the phase description from a translation key. */
  setPhaseKey(key: TranslationKey): void;
  /** Set determinate progress (0–100). Pass -1 for indeterminate mode. */
  setProgress(percent: number): void;
  /** Fade out and remove the overlay from DOM. Safe to call multiple times. */
  hide(): void;
  /** Returns the root element (for positioning checks). */
  readonly el: HTMLDivElement;
}

export function createLoadingOverlay(host: HTMLElement): LoadingOverlay {
  host.setAttribute("aria-busy", "true");
  const overlay = host.createDiv({ cls: "ai3d-loading-overlay" });
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  const skeleton = overlay.createDiv({ cls: "ai3d-loading-skeleton" });
  skeleton.createDiv({ cls: "ai3d-loading-skeleton-canvas" });
  const skeletonMeta = skeleton.createDiv({ cls: "ai3d-loading-skeleton-meta" });
  skeletonMeta.createDiv({ cls: "ai3d-loading-skeleton-line" });
  skeletonMeta.createDiv({ cls: "ai3d-loading-skeleton-line is-short" });

  overlay.createDiv({ cls: "ai3d-loading-spinner" });

  const text = overlay.createDiv({ cls: "ai3d-loading-text" });
  let currentPhaseKey: TranslationKey | null = "loading.default";
  let currentPhaseText = "";
  const renderPhase = () => {
    text.textContent = currentPhaseKey ? t(currentPhaseKey) : currentPhaseText;
  };
  renderPhase();

  const track = overlay.createDiv({ cls: "ai3d-loading-bar-track" });
  const fill = track.createDiv({ cls: "ai3d-loading-bar-fill is-indeterminate" });

  let hidden = false;
  const stopListening = onLocaleChange(() => {
    if (!hidden && currentPhaseKey) {
      renderPhase();
    }
  });

  return {
    el: overlay,

    setPhase(phaseText: string) {
      currentPhaseKey = null;
      currentPhaseText = phaseText;
      if (!hidden) renderPhase();
    },

    setPhaseKey(phaseKey: TranslationKey) {
      currentPhaseKey = phaseKey;
      if (!hidden) renderPhase();
    },

    setProgress(pct: number) {
      if (hidden) return;
      if (pct < 0) {
        fill.className = "ai3d-loading-bar-fill is-indeterminate";
        fill.style.removeProperty("--bar-width");
      } else {
        fill.className = "ai3d-loading-bar-fill";
        fill.style.setProperty("--bar-width", `${Math.min(100, Math.max(0, pct))}%`);
      }
    },

    hide() {
      if (hidden) return;
      hidden = true;
      stopListening();
      overlay.parentElement?.removeAttribute("aria-busy");
      overlay.classList.add("is-hiding");
      window.setTimeout(() => overlay.remove(), 300);
    },
  };
}
