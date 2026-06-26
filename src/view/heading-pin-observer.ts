import type { ModelAssetProfile } from "../domain/models";
import { formatT, t } from "../i18n";
import { normalizeHeadingText } from "../utils/note-reader";
import { getPortableStem } from "../utils/resolve-path";

export interface HeadingPinObserverContext {
  subscribeStore(callback: () => void): () => void;
  getModelAssetProfiles(): Record<string, ModelAssetProfile>;
  registerCleanup(cleanup: () => void): void;
  onLayoutChange(callback: () => void): void;
}

interface PinEntry {
  pinId: string;
  modelPath: string;
  color: string;
}

interface BoundHeadingEntry {
  badge: HTMLSpanElement;
  handler: () => void;
  signature: string;
}

const MARKDOWN_CONTAINER_SELECTOR = ".markdown-preview-view, .markdown-source-view";
const HEADING_SELECTOR = [
  ".markdown-preview-view h1", ".markdown-preview-view h2", ".markdown-preview-view h3",
  ".markdown-preview-view h4", ".markdown-preview-view h5", ".markdown-preview-view h6",
  ".cm-heading-1", ".cm-heading-2", ".cm-heading-3",
  ".cm-heading-4", ".cm-heading-5", ".cm-heading-6",
  ".cm-header-1", ".cm-header-2", ".cm-header-3",
  ".cm-header-4", ".cm-header-5", ".cm-header-6",
].join(", ");

function buildBadgeSwatchBackground(colors: string[]): string {
  if (colors.length === 0) return "var(--interactive-accent)";
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  return `linear-gradient(135deg, ${colors.map((color, index) => {
    const start = Math.round(index * step);
    const end = Math.round((index + 1) * step);
    return `${color} ${start}% ${end}%`;
  }).join(", ")})`;
}

function buildEntriesSignature(entries: PinEntry[]): string {
  return entries
    .map((entry) => `${entry.pinId}:${entry.modelPath}:${entry.color}`)
    .sort()
    .join("|");
}

function buildHeadingMapSignature(headingMap: Map<string, PinEntry[]>): string {
  return Array.from(headingMap.entries())
    .map(([key, entries]) => `${key}=>${buildEntriesSignature(entries)}`)
    .sort()
    .join("||");
}

export function setupHeadingPinObserver(context: HeadingPinObserverContext): void {
  const boundEntries = new Map<Element, BoundHeadingEntry>();
  let lastProfilesRef: Record<string, ModelAssetProfile> | null = null;
  let lastAnnotationRefs = new Map<string, readonly unknown[]>();
  let lastHeadingMapSignature = "";

  const annotationsChanged = (profiles: Record<string, ModelAssetProfile>): boolean => {
    if (profiles === lastProfilesRef) {
      return false;
    }

    const nextAnnotationRefs = new Map<string, readonly unknown[]>();
    let changed = lastProfilesRef === null;
    for (const [modelPath, profile] of Object.entries(profiles)) {
      const annotations = profile.annotations ?? [];
      nextAnnotationRefs.set(modelPath, annotations);
      if (lastAnnotationRefs.get(modelPath) !== annotations) {
        changed = true;
      }
    }

    if (nextAnnotationRefs.size !== lastAnnotationRefs.size) {
      changed = true;
    }

    lastProfilesRef = profiles;
    lastAnnotationRefs = nextAnnotationRefs;
    return changed;
  };

  const buildHeadingMap = (profiles = context.getModelAssetProfiles()): Map<string, PinEntry[]> => {
    const map = new Map<string, PinEntry[]>();
    for (const [modelPath, profile] of Object.entries(profiles)) {
      for (const pin of profile.annotations) {
        if (pin.headingRef && pin.id) {
          const headingKey = normalizeHeadingText(pin.headingRef);
          if (!headingKey) continue;
          let arr = map.get(headingKey);
          if (!arr) { arr = []; map.set(headingKey, arr); }
          arr.push({ pinId: pin.id, modelPath, color: pin.color });
        }
      }
    }
    return map;
  };

  const getHeadingText = (el: Element): string => normalizeHeadingText(
    Array.from(el.childNodes)
      .map((node) => {
        if (node.instanceOf(Element) && node.classList.contains("ai3d-heading-pin-badge")) {
          return "";
        }
        return node.textContent ?? "";
      })
      .join(" "),
  );

  const unbindHeading = (el: Element): void => {
    const existing = boundEntries.get(el);
    if (!existing) return;
    el.removeEventListener("mouseover", existing.handler);
    existing.badge.remove();
    delete (el as HTMLElement).dataset.pinBound;
    boundEntries.delete(el);
  };

  const bindHeading = (el: Element, entries: PinEntry[]): void => {
    if (entries.length === 0) {
      unbindHeading(el);
      return;
    }

    const signature = buildEntriesSignature(entries);
    const existing = boundEntries.get(el);
    if (existing?.signature === signature) return;
    if (existing) {
      unbindHeading(el);
    }

    (el as HTMLElement).dataset.pinBound = signature;

    const badge = (el as HTMLElement).createSpan({ cls: "ai3d-heading-pin-badge" });
    const distinctColors = [...new Set(entries.map((entry) => entry.color).filter(Boolean))];
    const swatch = badge.createSpan({ cls: "ai3d-heading-pin-badge-swatch" });
    swatch.style.background = buildBadgeSwatchBackground(distinctColors);
    swatch.title = entries.length > 1 ? t("headingPin.showMultiple") : t("headingPin.showSingle");
    swatch.setAttribute("role", "button");
    swatch.setAttribute("tabindex", "0");
    if (entries.length > 1) {
      const count = badge.createSpan({ cls: "ai3d-heading-pin-badge-count" });
      count.textContent = `\u00d7${entries.length}`;
    }
    const uniqueModels = [...new Set(entries.map((e) => getPortableStem(e.modelPath)))];
    badge.title = formatT("headingPin.linkedTo", { models: uniqueModels.join(", ") });
    const highlightLinkedPins = (e?: Event) => {
      e?.stopPropagation();
      e?.preventDefault();
      for (const entry of entries) {
        activeDocument.dispatchEvent(new CustomEvent("ai3d-pin-highlight", { detail: { pinId: entry.pinId } }));
      }
    };
    swatch.addEventListener("click", (e) => {
      highlightLinkedPins(e);
    });
    swatch.addEventListener("keydown", (e) => {
      if (!e.instanceOf(KeyboardEvent)) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      highlightLinkedPins(e);
    });
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    el.appendChild(badge);

    const handler = () => {
      for (const entry of entries) {
        activeDocument.dispatchEvent(new CustomEvent("ai3d-pin-highlight", { detail: { pinId: entry.pinId } }));
      }
    };
    el.addEventListener("mouseover", handler);
    boundEntries.set(el, { badge, handler, signature });
  };

  const syncHeadingElement = (el: Element, headingMap: Map<string, PinEntry[]>): void => {
    const headingText = getHeadingText(el);
    bindHeading(el, headingMap.get(headingText) ?? []);
  };

  const reconcileBoundHeadings = (headingMap: Map<string, PinEntry[]>): void => {
    for (const [el, entry] of Array.from(boundEntries.entries())) {
      if (!el.isConnected) {
        unbindHeading(el);
        continue;
      }
      const nextEntries = headingMap.get(getHeadingText(el)) ?? [];
      const nextSignature = buildEntriesSignature(nextEntries);
      if (nextEntries.length === 0 || entry.signature !== nextSignature) {
        bindHeading(el, nextEntries);
      }
    }
  };

  const processHeadings = (container: Element, headingMap: Map<string, PinEntry[]>): void => {
    container.querySelectorAll(HEADING_SELECTOR).forEach((el) => syncHeadingElement(el, headingMap));
  };

  const scanAll = (): void => {
    const profiles = context.getModelAssetProfiles();
    annotationsChanged(profiles);
    const headingMap = buildHeadingMap(profiles);
    lastHeadingMapSignature = buildHeadingMapSignature(headingMap);
    reconcileBoundHeadings(headingMap);
    const containers = activeDocument.querySelectorAll(MARKDOWN_CONTAINER_SELECTOR);
    containers.forEach((container) => processHeadings(container, headingMap));
  };

  let scanTimer = 0;
  const scheduleScan = (delay = 0): void => {
    if (scanTimer) {
      window.clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scanAll();
    }, delay);
  };

  const unsubscribeStore = context.subscribeStore(() => {
    const profiles = context.getModelAssetProfiles();
    if (!annotationsChanged(profiles)) return;
    const nextHeadingMap = buildHeadingMap(profiles);
    const nextSignature = buildHeadingMapSignature(nextHeadingMap);
    if (nextSignature === lastHeadingMapSignature) return;
    lastHeadingMapSignature = nextSignature;
    scheduleScan();
  });

  context.onLayoutChange(() => {
    scheduleScan(200);
  });

  const matchesRelevantNode = (node: HTMLElement): boolean => {
    if (node.matches(MARKDOWN_CONTAINER_SELECTOR) || node.matches(HEADING_SELECTOR)) return true;
    return !!node.querySelector(MARKDOWN_CONTAINER_SELECTOR) || !!node.querySelector(HEADING_SELECTOR);
  };

  const isRelevantAddedNode = (node: HTMLElement): boolean => node.isConnected && matchesRelevantNode(node);
  const isRelevantRemovedNode = (node: HTMLElement): boolean => matchesRelevantNode(node);

  let pendingNodes = new Set<HTMLElement>();
  let debounceTimer = 0;
  const flushPending = () => {
    const nodes = Array.from(pendingNodes);
    pendingNodes.clear();
    debounceTimer = 0;
    const headingMap = buildHeadingMap();
    reconcileBoundHeadings(headingMap);
    for (const node of nodes) {
      if (!node.isConnected) continue;
      if (node.matches?.(HEADING_SELECTOR)) syncHeadingElement(node, headingMap);
      node.querySelectorAll?.(HEADING_SELECTOR)?.forEach((el: Element) => syncHeadingElement(el, headingMap));
      if (node.matches?.(MARKDOWN_CONTAINER_SELECTOR)) {
        processHeadings(node, headingMap);
      }
      node.querySelectorAll?.(MARKDOWN_CONTAINER_SELECTOR)?.forEach((el: Element) => processHeadings(el, headingMap));
    }
    lastHeadingMapSignature = buildHeadingMapSignature(headingMap);
  };

  const observer = new MutationObserver((mutations) => {
    let shouldFlush = false;
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!node.instanceOf(HTMLElement)) continue;
        if (!isRelevantAddedNode(node)) continue;
        pendingNodes.add(node);
        shouldFlush = true;
      }
      for (const node of Array.from(m.removedNodes)) {
        if (!node.instanceOf(HTMLElement)) continue;
        if (!isRelevantRemovedNode(node)) continue;
        shouldFlush = true;
      }
    }
    if (shouldFlush && !debounceTimer) {
      debounceTimer = window.setTimeout(flushPending, 100);
    }
  });
  observer.observe(activeDocument.body, { childList: true, subtree: true });

  context.registerCleanup(() => {
    unsubscribeStore();
    observer.disconnect();
    if (debounceTimer) { window.clearTimeout(debounceTimer); debounceTimer = 0; }
    if (scanTimer) { window.clearTimeout(scanTimer); scanTimer = 0; }
    for (const el of Array.from(boundEntries.keys())) {
      unbindHeading(el);
    }
  });

  scheduleScan(500);
}
