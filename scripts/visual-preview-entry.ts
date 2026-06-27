import type { AnnotationPin } from "../src/domain/models";
import type { ModelPreview } from "../src/render/preview/types";
import { AnnotationManager } from "../src/render/preview/annotations";
import { createModelPreview } from "../src/render/preview/factory";
import { resolvePreviewRoute } from "../src/render/preview/routing";
import { createLoggedGridRenderer } from "../src/render/preview/selection";
import type { AnnotationPreview } from "../src/render/preview/types";
import { createHelperButtons } from "../src/view/inline/helper-buttons";
import {
  attachGridPreviewCanvasShortcuts,
  configureGridPreviewCanvas,
  configureModelPreviewCanvas,
} from "../src/view/inline/preview-canvas-accessibility";
import { renderRegisteredPartMatchRow } from "../src/view/direct-workbench-registered-match";

interface DomCreateOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

type DomCreateInput = string | DomCreateOptions | DomElementInfo | undefined;

declare global {
  interface HTMLElement {
    createDiv(options?: DomCreateInput): HTMLDivElement;
    createSpan(options?: DomCreateInput): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomCreateInput): HTMLElementTagNameMap[K];
    empty(): void;
    setText(text: string): void;
  }

  interface Document {
    createDiv(options?: DomCreateInput): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomCreateInput): HTMLElementTagNameMap[K];
    createSvg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
  }

  interface Window {
    __ai3dPreview?: ModelPreview;
    __ai3dPreviewVerify?: {
      status: "loading" | "ready" | "error";
      mode?: "basic" | "direct-edit" | "readonly-pin" | "workbench" | "grid";
      rendererRollout?: "babylon-safe" | "three-readonly-glb" | "three-direct-glb";
      summary?: unknown;
      route?: unknown;
      qualitySnapshot?: unknown;
      evidence?: unknown;
      pinCount?: number;
      pinLabels?: string[];
      registeredMatchRows?: Array<{
        title: string;
        source: string;
        model: string;
        target: string;
        button: string;
        targetPath: string;
        disabled: boolean;
      }>;
      gridBlockCount?: number;
      gridContextLostCount?: number;
      error?: string;
    };
  }
}

type VerifyMode = "basic" | "direct-edit" | "readonly-pin" | "workbench" | "grid";

function applyDomCreateOptions<T extends HTMLElement>(el: T, options?: DomCreateInput): T {
  if (!options) return el;
  if (typeof options === "string") {
    el.className = options;
    return el;
  }
  const info = options as DomCreateOptions;
  if (info.cls) el.className = info.cls;
  if (info.text) el.textContent = info.text;
  if (info.attr) {
    for (const [key, value] of Object.entries(info.attr)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

function installObsidianDomShims(): void {
  const globals = window as typeof window & {
    activeDocument: Document;
    createDiv: (options?: DomCreateInput) => HTMLDivElement;
    createEl: <K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomCreateInput) => HTMLElementTagNameMap[K];
    createSvg: <K extends keyof SVGElementTagNameMap>(tag: K) => SVGElementTagNameMap[K];
  };
  globals.activeDocument = document;
  globals.createDiv = (options) => applyDomCreateOptions(document.createElement("div"), options);
  globals.createEl = (tag, options) => applyDomCreateOptions(document.createElement(tag), options);
  globals.createSvg = ((tag: keyof SVGElementTagNameMap) =>
    document.createElementNS("http://www.w3.org/2000/svg", tag)) as typeof globals.createSvg;
  document.createDiv = (options) => applyDomCreateOptions(document.createElement("div"), options);
  document.createEl = (tag, options) => applyDomCreateOptions(document.createElement(tag), options);
  document.createSvg = ((tag: keyof SVGElementTagNameMap) =>
    document.createElementNS("http://www.w3.org/2000/svg", tag)) as Document["createSvg"];

  const proto = HTMLElement.prototype as HTMLElement & {
    createDiv?: (options?: DomCreateInput) => HTMLDivElement;
    createSpan?: (options?: DomCreateInput) => HTMLSpanElement;
    createEl?: <K extends keyof HTMLElementTagNameMap>(tag: K, options?: DomCreateInput) => HTMLElementTagNameMap[K];
    empty?: () => void;
    setText?: (text: string) => void;
    setCssProps?: (props: Record<string, string>) => void;
  };

  if (!proto.createDiv) {
    proto.createDiv = function createDiv(options?: DomCreateInput): HTMLDivElement {
      const el = applyDomCreateOptions(document.createElement("div"), options);
      this.appendChild(el);
      return el;
    };
  }

  if (!proto.createSpan) {
    proto.createSpan = function createSpan(options?: DomCreateInput): HTMLSpanElement {
      const el = applyDomCreateOptions(document.createElement("span"), options);
      this.appendChild(el);
      return el;
    };
  }

  if (!proto.createEl) {
    proto.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: DomCreateInput,
    ): HTMLElementTagNameMap[K] {
      const el = applyDomCreateOptions(document.createElement(tag), options) as HTMLElementTagNameMap[K];
      this.appendChild(el);
      return el;
    };
  }

  if (!proto.empty) {
    proto.empty = function empty(): void {
      this.replaceChildren();
    };
  }

  if (!proto.setText) {
    proto.setText = function setText(text: string): void {
      this.textContent = text;
    };
  }

  if (!proto.setCssProps) {
    proto.setCssProps = function setCssProps(props: Record<string, string>): void {
      for (const [key, value] of Object.entries(props)) {
        this.style.setProperty(key, value);
      }
    };
  }
}

function setVerifyState(partial: Partial<NonNullable<Window["__ai3dPreviewVerify"]>>): void {
  window.__ai3dPreviewVerify = {
    ...(window.__ai3dPreviewVerify ?? { status: "loading" }),
    ...partial,
  };
}

function createPreviewShell(): { host: HTMLDivElement; canvas: HTMLCanvasElement } {
  const shell = document.createElement("main");
  shell.id = "preview-shell";
  shell.innerHTML = `
    <section class="scroll-sentinel">scroll sentinel before canvas</section>
    <section class="preview-card">
      <div class="ai3d-preview-host">
        <canvas id="preview-canvas" class="ai3d-canvas-full" width="960" height="640"></canvas>
      </div>
    </section>
    <section class="scroll-sentinel">scroll sentinel after canvas</section>
  `;
  document.body.appendChild(shell);

  const host = shell.querySelector(".ai3d-preview-host");
  const canvas = shell.querySelector("#preview-canvas");
  if (!(host instanceof HTMLDivElement) || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Preview shell was not created");
  }
  configureModelPreviewCanvas(canvas, "inline", getModelPathForPreview());
  return { host, canvas };
}

function createGridPreviewShell(blockCount: number): HTMLDivElement[] {
  const shell = document.createElement("main");
  shell.id = "preview-shell";
  shell.appendChild(createGridSentinel("scroll sentinel before grids"));
  const blocks: HTMLDivElement[] = [];
  for (let index = 0; index < blockCount; index++) {
    const section = document.createElement("section");
    section.className = "preview-card grid-preview-card";
    section.dataset.gridIndex = String(index);
    const block = document.createElement("div");
    block.className = "grid-code-block-host";
    section.appendChild(block);
    shell.appendChild(section);
    if (index < blockCount - 1) {
      shell.appendChild(createGridSentinel(`scroll sentinel between grids ${index + 1}`));
    }
    blocks.push(block);
  }
  shell.appendChild(createGridSentinel("scroll sentinel after grids"));
  document.body.appendChild(shell);
  return blocks;
}

function createGridSentinel(text: string): HTMLDivElement {
  const sentinel = document.createElement("div");
  sentinel.className = "scroll-sentinel grid-scroll-sentinel";
  sentinel.textContent = text;
  return sentinel;
}

function renderRegisteredPartMatchHarness(): Array<{
  title: string;
  source: string;
  model: string;
  target: string;
  button: string;
  targetPath: string;
  disabled: boolean;
}> {
  const section = document.createElement("section");
  section.id = "registered-match-harness";
  section.className = "ai3d-direct-workbench-match-list";
  document.body.appendChild(section);
  renderRegisteredPartMatchRow(section, "Left Assembly", {
    sourceAssetId: "models/legacy grouped parts.gltf",
    sourcePartId: "legacy-model:part:1",
    sourcePartName: "Legacy Left Assembly",
    sourceNotePath: "Parts/3D Components/legacy/01 Left Assembly.md",
    sourceModelPath: "models/legacy grouped parts.gltf",
    matchScore: 0.82,
    confidence: 0.82,
    reasons: ["similar part name", "similar bounding size"],
  });
  renderRegisteredPartMatchRow(section, "Right Assembly", {
    sourceAssetId: "models/auto registered parts.gltf",
    sourcePartId: "auto-model:part:1",
    sourcePartName: "Auto Right Assembly",
    sourceModelPath: "models/auto registered parts.gltf",
    matchScore: 0.74,
    confidence: 0.74,
    reasons: ["similar mesh names"],
  });
  return Array.from(section.querySelectorAll(".ai3d-direct-workbench-match")).map((row) => {
    const button = row.querySelector("[data-ai3d-action='open-registered-part']");
    return {
      title: row.querySelector(".ai3d-direct-workbench-match-title")?.textContent ?? "",
      source: row.querySelector(".ai3d-direct-workbench-match-source")?.textContent ?? "",
      model: row.querySelector(".ai3d-direct-workbench-match-model")?.textContent ?? "",
      target: row.querySelector(".ai3d-direct-workbench-match-target")?.textContent ?? "",
      button: button?.textContent ?? "",
      targetPath: button instanceof HTMLElement ? button.dataset.ai3dTargetPath ?? "" : "",
      disabled: button instanceof HTMLButtonElement ? button.disabled : true,
    };
  });
}

async function loadSampleModel(): Promise<ArrayBuffer> {
  const modelFile = getModelFilename();
  const response = await fetch(toModelUrl(`models/${modelFile}`));
  if (!response.ok) {
    throw new Error(`Failed to load sample model: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

async function readHarnessModelResource(path: string): Promise<ArrayBuffer> {
  const response = await fetch(toModelUrl(path));
  if (!response.ok) {
    throw new Error(`File not found: ${path}`);
  }
  return response.arrayBuffer();
}

function toModelUrl(path: string): string {
  return `/${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function getModelPathForPreview(): string {
  return `models/${getModelFilename()}`;
}

function getModelFilename(): string {
  const value = new URLSearchParams(window.location.search).get("model");
  return value ?? "rubiks-cube-3x3.glb";
}

function getModelExt(): string {
  const filename = getModelFilename();
  return filename.split(".").pop()?.toLowerCase() ?? "glb";
}

function createPreviewAppStub() {
  return {
    vault: {
      adapter: {
        exists: async () => true,
      },
      createFolder: async () => {},
      createBinary: async () => {},
    },
  };
}

function attachHelperToolbar(host: HTMLDivElement, preview: ModelPreview) {
  const parentEl = host.parentElement;
  if (!(parentEl instanceof HTMLElement)) {
    throw new Error("Preview host parent is unavailable");
  }
  const toolbar = createHelperButtons(
    parentEl,
    host,
    createPreviewAppStub() as never,
    () => preview,
    () => "models/rubiks-cube-3x3.glb",
    () => {},
  );
  toolbar.syncCapabilities();
  return toolbar;
}

function findVisiblePinPosition(
  annotationPreview: AnnotationPreview,
  summary: { boundingSize: { x: number; y: number; z: number } },
): [number, number, number] {
  const provider = annotationPreview.getAnnotationProvider();
  const extent = {
    x: summary.boundingSize.x * 0.35,
    y: summary.boundingSize.y * 0.35,
    z: summary.boundingSize.z * 0.35,
  };
  const candidates: Array<[number, number, number]> = [
    [extent.x, extent.y, extent.z],
    [extent.x, extent.y, -extent.z],
    [extent.x, -extent.y, extent.z],
    [extent.x, -extent.y, -extent.z],
    [-extent.x, extent.y, extent.z],
    [-extent.x, extent.y, -extent.z],
    [-extent.x, -extent.y, extent.z],
    [-extent.x, -extent.y, -extent.z],
    [extent.x, 0, 0],
    [0, extent.y, 0],
    [0, 0, extent.z],
    [0, 0, 0],
  ];
  const projection = { screenX: 0, screenY: 0, depth: 0 };

  for (const [x, y, z] of candidates) {
    const point = { x, y, z };
    if (provider.projectWorldPoint(point, projection) && !provider.isWorldPointOccluded(point)) {
      return [x, y, z];
    }
  }

  return candidates[0];
}

async function pickVisiblePinPosition(
  annotationPreview: AnnotationPreview,
  canvas: HTMLCanvasElement,
): Promise<[number, number, number] | null> {
  const offsets = [
    [0.12, -0.12],
    [-0.12, -0.12],
    [0.12, 0.12],
    [-0.12, 0.12],
    [0, 0],
  ] as const;

  for (const [offsetX, offsetY] of offsets) {
    const point = await new Promise<[number, number, number] | null>((resolve) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = rect.left + rect.width * (0.5 + offsetX);
      const clientY = rect.top + rect.height * (0.5 + offsetY);
      let settled = false;
      const release = annotationPreview.onPick((result) => {
        const point = annotationPreview.getPickWorldPoint(result);
        if (!point) return;
        settled = true;
        release();
        resolve([point.x, point.y, point.z]);
      });
      const finalize = (value: [number, number, number] | null) => {
        if (settled) return;
        settled = true;
        release();
        resolve(value);
      };

      window.requestAnimationFrame(() => {
        canvas.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX,
          clientY,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        }));
        canvas.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX,
          clientY,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        }));
        window.setTimeout(() => finalize(null), 250);
      });
    });

    if (point) {
      return point;
    }
  }

  return null;
}

function getRendererRollout(): "babylon-safe" | "three-readonly-glb" | "three-direct-glb" {
  const value = new URLSearchParams(window.location.search).get("rollout");
  if (value === "babylon-safe" || value === "three-readonly-glb" || value === "three-direct-glb") {
    return value;
  }
  return "babylon-safe";
}

function allowsWorkbenchFeaturesOnThree(): boolean {
  return new URLSearchParams(window.location.search).get("allowWorkbenchThree") === "1";
}

async function runBasicPreview(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  rendererRollout: "babylon-safe" | "three-readonly-glb" | "three-direct-glb",
): Promise<void> {
  const ext = getModelExt();
  const previewOptions = {
    ext,
    annotationMode: "none",
    rendererRollout,
  } as const;
  const route = resolvePreviewRoute(previewOptions);
  const preview = await createModelPreview(canvas, previewOptions);
  const summary = await preview.loadModel(await loadSampleModel(), ext, readHarnessModelResource, getModelPathForPreview());
  attachHelperToolbar(host, preview);
  window.__ai3dPreview = preview;
  setVerifyState({
    status: "ready",
    mode: "basic",
    rendererRollout,
    summary,
    route,
    qualitySnapshot: preview.getQualitySnapshot?.() ?? null,
    evidence: preview.getModelEvidence?.() ?? null,
  });
}

async function runDirectEditPreview(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  rendererRollout: "babylon-safe" | "three-readonly-glb" | "three-direct-glb",
): Promise<void> {
  const ext = getModelExt();
  const previewOptions = {
    ext,
    annotationMode: "edit",
    allowEditModeOnThree: true,
    rendererRollout,
  } as const;
  const route = resolvePreviewRoute(previewOptions);
  const preview = await createModelPreview(canvas, previewOptions);
  const summary = await preview.loadModel(await loadSampleModel(), ext, readHarnessModelResource, getModelPathForPreview());
  attachHelperToolbar(host, preview);
  const annotationPreview = preview as AnnotationPreview;
  const annotationMgr = new AnnotationManager(
    annotationPreview.getAnnotationProvider(),
    host,
    "edit",
    [],
    (pins) => {
      setVerifyState({
        pinCount: pins.length,
        pinLabels: pins.map((pin) => pin.label),
      });
    },
  );
  annotationPreview.onPick((result) => {
    const worldPos = annotationPreview.getPickWorldPoint(result);
    if (!worldPos) return;
    annotationMgr.showEditor(result.screenX, result.screenY, worldPos);
  });
  window.__ai3dPreview = preview;
  window.addEventListener("beforeunload", () => annotationMgr.destroy(), { once: true });
  setVerifyState({
    status: "ready",
    mode: "direct-edit",
    rendererRollout,
    summary,
    route,
    qualitySnapshot: preview.getQualitySnapshot?.() ?? null,
    evidence: preview.getModelEvidence?.() ?? null,
    pinCount: 0,
    pinLabels: [],
  });
}

async function runReadonlyPinPreview(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  rendererRollout: "babylon-safe" | "three-readonly-glb" | "three-direct-glb",
): Promise<void> {
  const ext = getModelExt();
  const previewOptions = {
    ext,
    annotationMode: "readonly",
    rendererRollout,
  } as const;
  const route = resolvePreviewRoute(previewOptions);
  const preview = await createModelPreview(canvas, previewOptions);
  const summary = await preview.loadModel(await loadSampleModel(), ext, readHarnessModelResource, getModelPathForPreview());
  attachHelperToolbar(host, preview);

  const annotationPreview = preview as AnnotationPreview;
  const visiblePinPosition = await pickVisiblePinPosition(annotationPreview, canvas)
    ?? findVisiblePinPosition(annotationPreview, summary);
  const initialPins: AnnotationPin[] = [
    {
      id: "verify-readonly-pin",
      position: visiblePinPosition,
      label: "Center Pin",
      color: "#4a9eff",
      createdAt: new Date().toISOString(),
    },
    {
      id: "verify-occluded-pin",
      position: [0, 0, 0],
      label: "Occluded Pin",
      color: "#ff922b",
      createdAt: new Date().toISOString(),
    },
  ];

  const annotationMgr = new AnnotationManager(
    annotationPreview.getAnnotationProvider(),
    host,
    "readonly",
    initialPins,
    (pins) => {
      setVerifyState({
        pinCount: pins.length,
        pinLabels: pins.map((pin) => pin.label),
      });
    },
  );
  window.__ai3dPreview = preview;
  window.addEventListener("beforeunload", () => annotationMgr.destroy(), { once: true });
  setVerifyState({
    status: "ready",
    mode: "readonly-pin",
    rendererRollout,
    summary,
    route,
    qualitySnapshot: preview.getQualitySnapshot?.() ?? null,
    evidence: preview.getModelEvidence?.() ?? null,
    pinCount: initialPins.length,
    pinLabels: initialPins.map((pin) => pin.label),
  });
}

async function runWorkbenchPreview(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  rendererRollout: "babylon-safe" | "three-readonly-glb" | "three-direct-glb",
): Promise<void> {
  const ext = getModelExt();
  const previewOptions = {
    ext,
    annotationMode: "edit",
    allowEditModeOnThree: true,
    allowWorkbenchFeaturesOnThree: allowsWorkbenchFeaturesOnThree(),
    requireWorkbenchFeatures: true,
    rendererRollout,
  } as const;
  const route = resolvePreviewRoute(previewOptions);
  const preview = await createModelPreview(canvas, previewOptions);
  const summary = await preview.loadModel(await loadSampleModel(), ext, readHarnessModelResource, getModelPathForPreview());
  const toolbar = attachHelperToolbar(host, preview);
  preview.applyConfig({
    models: [{ path: `models/${getModelFilename()}` }],
    scene: { grid: true, axis: true, groundShadow: true },
  });
  preview.setRenderQuality?.("medium", 1);
  toolbar.syncCapabilities();
  const annotationPreview = preview as AnnotationPreview;
  const initialPins: AnnotationPin[] = [
    {
      id: "verify-workbench-pin",
      position: [0, 0, 0],
      label: "Workbench Pin",
      color: "#2ec4ff",
      createdAt: new Date().toISOString(),
    },
  ];
  const annotationMgr = new AnnotationManager(
    annotationPreview.getAnnotationProvider(),
    host,
    "readonly",
    initialPins,
    (pins) => {
      setVerifyState({
        pinCount: pins.length,
        pinLabels: pins.map((pin) => pin.label),
      });
    },
  );
  window.__ai3dPreview = preview;
  window.addEventListener("beforeunload", () => annotationMgr.destroy(), { once: true });
  setVerifyState({
    status: "ready",
    mode: "workbench",
    rendererRollout,
    summary,
    route,
    qualitySnapshot: preview.getQualitySnapshot?.() ?? null,
    evidence: preview.getModelEvidence?.() ?? null,
    pinCount: initialPins.length,
    pinLabels: initialPins.map((pin) => pin.label),
    registeredMatchRows: renderRegisteredPartMatchHarness(),
  });
}

function trackGridContextLoss(canvas: HTMLCanvasElement): void {
  canvas.addEventListener("webglcontextlost", () => {
    setVerifyState({
      gridContextLostCount: (window.__ai3dPreviewVerify?.gridContextLostCount ?? 0) + 1,
    });
  });
}

async function runGridPreview(): Promise<void> {
  const gridBlockCount = 3;
  const modelPaths = [
    "models/rubiks-cube-3x3.glb",
    "models/test-model.glb",
    "models/xbox-controller-cubies.glb",
  ];
  const blocks = createGridPreviewShell(gridBlockCount);
  const models = [
    { path: modelPaths[0], label: "Rubiks cube" },
    { path: modelPaths[1], label: "Test model" },
    { path: modelPaths[2], label: "Controller" },
  ];
  const config = {
    models,
    columns: 3,
    rowHeight: 260,
  };
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const renderers: Array<{ destroy(): void }> = [];
  const routes: unknown[] = [];
  const snapshots: string[] = [];

  for (const [index, block] of blocks.entries()) {
    const gridHost = document.createElement("div");
    gridHost.className = "ai3d-grid-host";
    const canvas = document.createElement("canvas");
    configureGridPreviewCanvas(canvas);
    gridHost.appendChild(canvas);
    block.appendChild(gridHost);
    trackGridContextLoss(canvas);
    const { renderer, route } = await createLoggedGridRenderer(
      logger,
      { surface: "3dgrid", preset: "compare", modelCount: models.length },
      canvas,
    );
    renderers.push(renderer);
    routes.push(route);
    attachGridPreviewCanvasShortcuts(canvas, () => renderer);
    renderer.setRenderScale(1);
    await renderer.loadModels(models, config, readHarnessModelResource);
    snapshots.push(renderer.captureSnapshot() ?? "");
    block.dataset.gridLoaded = String(index + 1);
  }
  window.addEventListener("beforeunload", () => {
    for (const renderer of renderers) {
      renderer.destroy();
    }
  }, { once: true });

  setVerifyState({
    status: "ready",
    mode: "grid",
    rendererRollout: getRendererRollout(),
    gridBlockCount,
    gridContextLostCount: 0,
    route: routes[0],
    evidence: {
      routes,
      snapshotCount: snapshots.filter((snapshot) => snapshot.startsWith("data:image/png;base64,")).length,
    },
  });
}

async function main() {
  installObsidianDomShims();
  window.__ai3dPreviewVerify = { status: "loading" };

  const mode = (new URLSearchParams(window.location.search).get("mode") ?? "basic") as VerifyMode;
  const rendererRollout = getRendererRollout();
  if (mode === "grid") {
    await runGridPreview();
    return;
  }

  const { host, canvas } = createPreviewShell();
  if (mode === "direct-edit") {
    await runDirectEditPreview(host, canvas, rendererRollout);
    return;
  }

  if (mode === "readonly-pin") {
    await runReadonlyPinPreview(host, canvas, rendererRollout);
    return;
  }

  if (mode === "workbench") {
    await runWorkbenchPreview(host, canvas, rendererRollout);
    return;
  }

  await runBasicPreview(host, canvas, rendererRollout);
}

main().catch((error: unknown) => {
  window.__ai3dPreviewVerify = {
    status: "error",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  };
});
