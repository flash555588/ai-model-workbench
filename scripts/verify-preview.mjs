import esbuild from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(rootDir, ".tmp", "preview-verify");
const failureDir = join(rootDir, ".tmp", "preview-failures");
const bundlePath = join(outDir, "preview.js");
const shimPath = join(outDir, "obsidian-shim.js");
const entryPath = join(rootDir, "scripts", "visual-preview-entry.ts");
const modelPath = parseModelPath();
const stylesPath = join(rootDir, "styles.css");

function parseModelPath() {
  const modelIndex = process.argv.indexOf("--model");
  if (modelIndex >= 0) {
    return resolve(process.argv[modelIndex + 1]);
  }
  return join(rootDir, "models", "rubiks-cube-3x3.glb");
}

function parseMode() {
  const modeIndex = process.argv.indexOf("--mode");
  if (modeIndex >= 0) {
    return process.argv[modeIndex + 1] ?? "basic";
  }
  return "basic";
}

function parseRollout() {
  const rolloutIndex = process.argv.indexOf("--rollout");
  if (rolloutIndex >= 0) {
    return process.argv[rolloutIndex + 1] ?? "three-direct-glb";
  }
  return "three-direct-glb";
}

function parseAllowWorkbenchThree() {
  return process.argv.includes("--allow-workbench-three");
}

function parseExpectBackend() {
  const backendIndex = process.argv.indexOf("--expect-backend");
  if (backendIndex >= 0) {
    return process.argv[backendIndex + 1] ?? null;
  }
  return null;
}

function parseRouteOnly() {
  return process.argv.includes("--route-only");
}

function parseExpectWarning() {
  const warningIndex = process.argv.indexOf("--expect-warning");
  if (warningIndex >= 0) {
    return process.argv[warningIndex + 1] ?? null;
  }
  return null;
}

function parseExpectNoWarnings() {
  return process.argv.includes("--expect-no-warnings");
}

function parseExpectGroupParts() {
  return process.argv.includes("--expect-group-parts");
}

const verifyMode = parseMode();
const verifyRollout = parseRollout();
const verifyAllowWorkbenchThree = parseAllowWorkbenchThree();
const verifyExpectedBackend = parseExpectBackend();
const verifyRouteOnly = parseRouteOnly();
const verifyExpectedWarning = parseExpectWarning();
const verifyExpectNoWarnings = parseExpectNoWarnings();
const verifyExpectGroupParts = parseExpectGroupParts();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json"],
  [".stl", "application/sla"],
  [".ply", "application/octet-stream"],
  [".obj", "text/plain"],
  [".wasm", "application/wasm"],
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function candidateBrowsers() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    candidates.push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  }

  candidates.push(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/snap/bin/chromium",
  );

  if (process.env.HOME) {
    candidates.push(
      join(process.env.HOME, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      join(process.env.HOME, "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
      join(process.env.HOME, "Applications", "Chromium.app", "Contents", "MacOS", "Chromium"),
      join(process.env.HOME, "Applications", "Brave Browser.app", "Contents", "MacOS", "Brave Browser"),
    );
  }

  const programFiles = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  for (const base of programFiles) {
    candidates.push(
      join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(base, "Google", "Chrome", "Application", "chrome.exe"),
      join(base, "Chromium", "Application", "chrome.exe"),
    );
  }

  return [...new Set(candidates)].filter((file) => existsSync(file));
}

async function buildHarness() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    shimPath,
    [
      "export const Platform = { isMobile: false };",
      "export class TFile {}",
      "export class TFolder { constructor() { this.children = []; } }",
      "export class Notice {}",
      "export class Plugin {}",
      "export class Component {",
      "  constructor() { this.children = []; }",
      "  load() {}",
      "  unload() { this.children.length = 0; }",
      "  addChild(child) { this.children.push(child); return child; }",
      "  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); }",
      "}",
      "export const MarkdownRenderer = {",
      "  async render(_app, content, el) { el.textContent = content; }",
      "};",
      "if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssProps) {",
      "  HTMLElement.prototype.setCssProps = function(props) {",
      "    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);",
      "  };",
      "}",
      "if (typeof SVGElement !== 'undefined' && !SVGElement.prototype.setCssProps) {",
      "  SVGElement.prototype.setCssProps = function(props) {",
      "    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    outfile: bundlePath,
    format: "iife",
    target: "es2020",
    sourcemap: "inline",
    logLevel: "silent",
    banner: {
      js: "var activeWindow = window;",
    },
    plugins: [
      {
        name: "obsidian-browser-shim",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: shimPath }));
        },
      },
    ],
  });
}

function createStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      let filePath;

      if (pathname === "/" || pathname === "/index.html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    html, body { margin: 0; background: #101217; color: #f6f0dd; font-family: sans-serif; }
    .scroll-sentinel { height: 900px; display: grid; place-items: center; }
    .preview-card { width: 960px; max-width: calc(100vw - 40px); margin: 0 auto; padding: 20px; background: #171b23; border-radius: 20px; }
    .ai3d-preview-host { min-height: 640px; }
    #preview-canvas { display: block; width: 100%; height: 640px; background: #20242e; border-radius: 14px; }
  </style>
</head>
<body>
  <script src="/.tmp/preview-verify/preview.js"></script>
</body>
</html>`);
        return;
      }

      if (pathname.startsWith("/.tmp/preview-verify/")) {
        filePath = join(rootDir, pathname.slice(1));
      } else if (pathname === "/styles.css") {
        filePath = stylesPath;
      } else if (pathname.startsWith("/models/")) {
        filePath = join(rootDir, pathname.slice(1));
      } else {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const data = await readFile(filePath);
      response.writeHead(200, {
        "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
      });
      response.end(data);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "Failed to bind verification server");
      resolveServer({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

async function canvasPixelStats(page) {
  return page.locator("#preview-canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })
      ?? canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) {
      throw new Error("Canvas WebGL context is unavailable for pixel readback");
    }

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const stepX = Math.max(1, Math.floor(width / 64));
    const stepY = Math.max(1, Math.floor(height / 64));
    let nonBackground = 0;
    let samples = 0;
    let min = 255;
    let max = 0;

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const offset = (y * width + x) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const a = pixels[offset + 3];
        const brightness = (r + g + b) / 3;
        min = Math.min(min, brightness);
        max = Math.max(max, brightness);
        if (a > 0 && Math.abs(r - 32) + Math.abs(g - 36) + Math.abs(b - 46) > 18) {
          nonBackground += 1;
        }
        samples += 1;
      }
    }

    return {
      samples,
      nonBackground,
      nonBackgroundRatio: nonBackground / samples,
      contrast: max - min,
    };
  });
}

async function verifyCanvasAccessibility(page) {
  const canvas = page.locator("#preview-canvas");
  const metadata = await canvas.evaluate((entry) => ({
    role: entry.getAttribute("role"),
    label: entry.getAttribute("aria-label"),
    shortcuts: entry.getAttribute("aria-keyshortcuts"),
    title: entry.getAttribute("title"),
    tabIndex: entry.tabIndex,
  }));

  assert(metadata.role === "application", `Preview canvas role was unexpected: ${metadata.role ?? "null"}`);
  assert(metadata.tabIndex === 0, `Preview canvas is not keyboard focusable: tabIndex=${metadata.tabIndex}`);
  assert(
    typeof metadata.label === "string" && metadata.label.includes("3D") && metadata.label.includes("Shortcuts:"),
    `Preview canvas label was missing useful context: ${metadata.label ?? "null"}`,
  );
  assert(
    typeof metadata.shortcuts === "string" && metadata.shortcuts.includes("R") && metadata.shortcuts.includes("W"),
    `Preview canvas keyboard shortcuts were missing reset/wireframe keys: ${metadata.shortcuts ?? "null"}`,
  );
  assert(
    typeof metadata.title === "string" && metadata.title.includes("reset view"),
    `Preview canvas title did not expose shortcut hints: ${metadata.title ?? "null"}`,
  );

  await canvas.focus();
  const focused = await page.evaluate(() => document.activeElement === document.querySelector("#preview-canvas"));
  assert(focused, "Preview canvas did not receive keyboard focus");
}

async function readPreviewState(page) {
  try {
    return await page.evaluate(() => window.__ai3dPreviewVerify ?? null);
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const toolbarLabels = {
  wireframe: "Toggle wireframe",
  axes: "Toggle orientation axes",
  boundingBox: "Toggle bounding box",
  resolution: "Change resolution",
};

async function getToolbarButton(page, label) {
  const button = page.locator(`.ai3d-helper-toolbar button[aria-label="${label}"]`).first();
  try {
    await button.waitFor({ state: "visible", timeout: 1000 });
  } catch {
    // Secondary actions are collapsed by default; expand the "more" menu.
    const more = page.locator(".ai3d-helper-toolbar .ai3d-mobile-more-toggle").first();
    await more.click();
    await button.waitFor({ state: "visible", timeout: 5000 });
  }
  return button;
}

async function dispatchCanvasClick(page, clientX, clientY) {
  await page.evaluate(({ clientX, clientY }) => {
    const canvas = document.querySelector("#preview-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Preview canvas is unavailable for synthetic click");
    }

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
  }, { clientX, clientY });
}

async function pickSelectedPartInfo(page, box) {
  const offsets = [
    [0, 0],
    [0.12, -0.12],
    [-0.12, -0.12],
    [0.12, 0.12],
    [-0.12, 0.12],
  ];

  for (const [offsetX, offsetY] of offsets) {
    const clientX = box.x + box.width * (0.5 + offsetX);
    const clientY = box.y + box.height * (0.5 + offsetY);
    await dispatchCanvasClick(page, clientX, clientY);
    await page.waitForTimeout(100);
    const markdown = await page.evaluate(() => window.__ai3dPreview?.exportSelectedPartInfo?.() ?? "");
    if (markdown.includes("Part Info")) {
      return { markdown, clientX, clientY };
    }
  }

  return { markdown: "", clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
}

async function verifyHelperToolbar(page) {
  await page.waitForSelector(".ai3d-helper-toolbar", { timeout: 5000 });

  const verifyToggleButton = async (button, label) => {
    const before = await button.evaluate((entry) => entry.classList.contains("ai3d-btn-active"));
    await button.click();
    await page.waitForTimeout(100);
    const after = await button.evaluate((entry) => entry.classList.contains("ai3d-btn-active"));
    assert(after !== before, `${label} toolbar button did not toggle`);
  };

  const wireBtn = await getToolbarButton(page, toolbarLabels.wireframe);
  await verifyToggleButton(wireBtn, "Wireframe");

  const axesBtn = await getToolbarButton(page, toolbarLabels.axes);
  await verifyToggleButton(axesBtn, "Orientation axes");

  const bboxBtn = await getToolbarButton(page, toolbarLabels.boundingBox);
  await verifyToggleButton(bboxBtn, "Bounding box");

  const resBtn = await getToolbarButton(page, toolbarLabels.resolution);
  const beforeText = (await resBtn.textContent())?.trim();
  await resBtn.click();
  await page.waitForTimeout(100);
  const afterText = (await resBtn.textContent())?.trim();
  assert(
    !!beforeText && !!afterText && beforeText !== afterText,
    `Resolution toolbar button did not cycle value: before=${beforeText ?? "null"}, after=${afterText ?? "null"}`,
  );
}

async function verifyReadonlyPinMode(page, state) {
  assert(state?.mode === "readonly-pin", `Expected readonly-pin mode, received ${state?.mode ?? "unknown"}`);
  await page.waitForFunction(() => {
    const verify = window.__ai3dPreviewVerify;
    return verify?.pinCount === 2
      && verify.pinLabels?.includes("Center Pin")
      && verify.pinLabels?.includes("Occluded Pin");
  }, null, { timeout: 5000 });

  const pin = page.locator(".ai3d-annotation-pin", { hasText: "Center Pin" }).first();
  await pin.waitFor({ state: "visible", timeout: 5000 });
  const pinLabel = (await pin.locator(".ai3d-pin-label").textContent()) ?? "";
  assert(pinLabel.includes("Center Pin"), `Readonly pin label was unexpected: ${pinLabel}`);
  assert(await page.locator(".ai3d-pin-delete").count() === 0, "Readonly pin unexpectedly exposed delete controls");

  await pin.click();
  await page.waitForTimeout(200);
  assert(await page.locator(".ai3d-annotation-editor").count() === 0, "Readonly pin unexpectedly opened editor");

  await page.waitForFunction(() => {
    const pins = Array.from(document.querySelectorAll(".ai3d-annotation-pin"));
    const pin = pins.find((entry) => entry.textContent?.includes("Occluded Pin"));
    if (!pin?.classList.contains("ai3d-pin-occluded")) return false;
    const styles = getComputedStyle(pin);
    return styles.visibility === "hidden" && styles.pointerEvents === "none" && Number(styles.opacity) === 0;
  }, null, { timeout: 5000 });
  await verifyOcclusionUpdatesWhileRotating(page);
}

async function verifyFocusSelectionAfterExistingPick(page, selectedPartMarkdown) {
  const focusOn = await page.evaluate(() => window.__ai3dPreview?.toggleFocusSelection());
  assert(focusOn === true, "Focus selection did not turn on");

  const focusedPartMarkdown = await page.evaluate(() => window.__ai3dPreview?.exportSelectedPartInfo?.() ?? "");
  assert(focusedPartMarkdown.includes("Part Info"), "Focus mode did not preserve the existing selected part");
  assert(
    focusedPartMarkdown === selectedPartMarkdown,
    "Focus mode did not align to the previously selected part",
  );
}

async function verifyFocusSelectionBlankClickPreservesFocus(page, box, selectedPartMarkdown) {
  const beforeFocus = await page.evaluate(() => window.__ai3dPreview?.exportSelectedPartInfo?.() ?? "");
  assert(beforeFocus === selectedPartMarkdown, "Focus mode changed selected part before blank-click verification");

  await dispatchCanvasClick(page, box.x + 12, box.y + 12);
  await page.waitForTimeout(150);

  const afterFocus = await page.evaluate(() => window.__ai3dPreview?.exportSelectedPartInfo?.() ?? "");
  assert(afterFocus === selectedPartMarkdown, "Blank click cleared or changed the focused part");
}

async function verifyOcclusionUpdatesWhileRotating(page) {
  const occludedPin = page.locator(".ai3d-annotation-pin", { hasText: "Occluded Pin" }).first();
  await occludedPin.waitFor({ state: "attached", timeout: 5000 });
  const before = await occludedPin.evaluate((pin) => ({
    left: pin.style.getPropertyValue("--pin-left"),
    top: pin.style.getPropertyValue("--pin-top"),
    occluded: pin.classList.contains("ai3d-pin-occluded"),
  }));

  const moved = await page.evaluate(async () => {
    const preview = window.__ai3dPreview;
    const provider = preview?.getAnnotationProvider?.();
    if (!preview || !provider || typeof preview.applyConfig !== "function") {
      return { skipped: true };
    }

    preview.applyConfig({
      models: [{ path: "models/rubiks-cube-3x3.glb" }],
      camera: { position: [-4.8, 3.1, -4.8], lookAt: [0.45, 0.2, 0] },
    });

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const projection = { screenX: 0, screenY: 0, depth: 0 };
    const projected = provider.projectWorldPoint({ x: 0, y: 0, z: 0 }, projection);
    return {
      skipped: false,
      projected,
      occluded: provider.isWorldPointOccluded({ x: 0, y: 0, z: 0 }),
      left: `${Math.round(projection.screenX)}px`,
      top: `${Math.round(projection.screenY)}px`,
    };
  });
  assert(!moved.skipped, "Occlusion rotation verification could not access annotation provider");
  assert(moved.projected, "Occlusion rotation verification could not project the occluded pin");

  await page.waitForFunction((expected) => {
    const pins = Array.from(document.querySelectorAll(".ai3d-annotation-pin"));
    const pin = pins.find((entry) => entry.textContent?.includes("Occluded Pin"));
    if (!(pin instanceof HTMLElement)) return false;
    return pin.style.getPropertyValue("--pin-left") === expected.left
      && pin.style.getPropertyValue("--pin-top") === expected.top
      && pin.classList.contains("ai3d-pin-occluded") === expected.occluded;
  }, moved, { timeout: 5000 });

  const after = await occludedPin.evaluate((pin) => ({
    left: pin.style.getPropertyValue("--pin-left"),
    top: pin.style.getPropertyValue("--pin-top"),
    occluded: pin.classList.contains("ai3d-pin-occluded"),
  }));
  assert(
    before.left !== after.left || before.top !== after.top || before.occluded !== after.occluded,
    "Occluded pin projection/occlusion state did not update after camera rotation",
  );
  const priority = await page.evaluate(() => {
    const pins = Array.from(document.querySelectorAll(".ai3d-annotation-pin"));
    return pins.map((pin) => ({
      text: pin.textContent ?? "",
      zIndex: Number.parseInt(getComputedStyle(pin).zIndex || "0", 10),
    }));
  });
  assert(
    priority.some((pin) => Number.isFinite(pin.zIndex) && pin.zIndex >= 100),
    `Pin visual priority was not applied: ${JSON.stringify(priority)}`,
  );
}

async function verifyThreePerformanceBudgetSnapshot(page, route, performanceSnapshot) {
  if (route?.backend !== "three") return;
  assert(
    typeof performanceSnapshot?.frameBudgetPixelRatioScale === "number",
    `Three performance snapshot is missing frame budget scale: ${JSON.stringify(performanceSnapshot)}`,
  );
  assert(
    typeof performanceSnapshot?.frameBudgetObserverStride === "number",
    `Three performance snapshot is missing observer stride: ${JSON.stringify(performanceSnapshot)}`,
  );
  assert(
    performanceSnapshot?.viewportVisible === true,
    `Three preview should be visible during verification: ${JSON.stringify(performanceSnapshot)}`,
  );
  assert(
    performanceSnapshot?.disposalAudit?.reason,
    `Three disposal audit is missing: ${JSON.stringify(performanceSnapshot)}`,
  );
}

function verifyGroupedPartsEvidence(state) {
  if (!verifyExpectGroupParts) return;
  const parts = Array.isArray(state?.evidence?.parts) ? state.evidence.parts : [];
  const groupParts = parts.filter((part) => part?.source === "group");
  const meshParts = parts.filter((part) => part?.source === "mesh");
  const componentParts = parts.filter((part) => part?.source === "component");
  const groupNames = new Set(groupParts.map((part) => part.name));

  assert(groupParts.length >= 2, `Expected at least 2 grouped parts, got ${JSON.stringify(parts)}`);
  assert(groupNames.has("Left Assembly"), `Missing Left Assembly group part: ${JSON.stringify(parts)}`);
  assert(groupNames.has("Right Assembly"), `Missing Right Assembly group part: ${JSON.stringify(parts)}`);
  assert(!groupNames.has("Grouped Parts Fixture"), `Whole-model wrapper was registered as a group part: ${JSON.stringify(parts)}`);
  assert(
    groupParts.every((part) => part.childCount >= 2 && Array.isArray(part.meshNames) && part.meshNames.length >= 2),
    `Grouped parts did not keep child mesh evidence: ${JSON.stringify(groupParts)}`,
  );
  assert(
    meshParts.some((part) => part.name === "Loose Detail"),
    `Ungrouped mesh part was not preserved alongside grouped parts: ${JSON.stringify(parts)}`,
  );
  const taggedComponent = componentParts.find((part) => part.componentId === "FASTENER-M3");
  assert(
    taggedComponent?.occurrenceId === "ASM-ROOT/FASTENER-001"
      && taggedComponent.partNumber === "DIN912-M3x8"
      && taggedComponent.componentPath === "ASM-ROOT/FASTENER-001",
    `Tagged GLB component metadata was not preserved: ${JSON.stringify(parts)}`,
  );
}

async function verifyWorkbenchMode(page, state, stats, performanceSnapshot, selectedPartMarkdown) {
  assert(state?.mode === "workbench", `Expected workbench mode, received ${state?.mode ?? "unknown"}`);
  assert(state?.route?.requireWorkbenchFeatures === true, "Workbench route did not require workbench features");
  assert(state?.pinCount === 1, "Workbench annotation provider did not mount initial pin");

  const result = await page.evaluate(async () => {
    const preview = window.__ai3dPreview;
    const canvas = document.querySelector("#preview-canvas");
    if (!preview || !(canvas instanceof HTMLCanvasElement)) {
      return { missing: true };
    }
    const methods = [
      "getAnnotationProvider",
      "focusWorldPoint",
      "hasAnimations",
      "setRenderQuality",
      "captureSnapshot",
      "getModelEvidence",
      "exportModelInfo",
      "exportSelectedPartInfo",
    ];
    const missingMethods = methods.filter((method) => typeof preview[method] !== "function");
    const before = canvas.toDataURL("image/png");
    preview.focusWorldPoint?.({ x: 0.8, y: 0.8, z: 0.8 });
    await new Promise((resolve) => activeWindow.setTimeout(resolve, 450));
    const focused = canvas.toDataURL("image/png");
    const snapshot = preview.captureSnapshot?.() ?? "";
    const evidence = preview.getModelEvidence?.() ?? null;
    return {
      missing: false,
      missingMethods,
      focusChanged: before !== focused,
      snapshot,
      evidence,
      modelInfo: preview.exportModelInfo?.("rubiks-cube-3x3.glb") ?? "",
    };
  });

  assert(!result.missing, "Workbench preview was unavailable");
  assert(result.missingMethods.length === 0, `Workbench preview is missing methods: ${result.missingMethods.join(", ")}`);
  assert(result.focusChanged, "Workbench focusWorldPoint did not change the rendered canvas");
  assert(result.snapshot.startsWith("data:image/png;base64,"), "Workbench snapshot did not return a PNG data URL");
  assert(result.evidence?.parts?.length > 0, `Workbench evidence is missing parts: ${JSON.stringify(result.evidence)}`);
  assert(result.evidence?.summary?.meshCount === state.summary.meshCount, "Workbench evidence summary did not match preview summary");
  assert(result.modelInfo.includes("Model Info"), "Workbench model info export failed");
  const rows = Array.isArray(state.registeredMatchRows) ? state.registeredMatchRows : [];
  const noteRow = rows.find((row) => row.title === "Left Assembly");
  const modelRow = rows.find((row) => row.title === "Right Assembly");
  assert(noteRow?.button === "Note", `Registered match part-note row did not render Note action: ${JSON.stringify(rows)}`);
  assert(
    noteRow.targetPath === "Parts/3D Components/legacy/01 Left Assembly.md",
    `Registered match part-note target path was wrong: ${JSON.stringify(noteRow)}`,
  );
  assert(noteRow.target === "Opens matched part note", `Registered match part-note target copy was wrong: ${JSON.stringify(noteRow)}`);
  assert(noteRow.model === "From legacy grouped parts.gltf", `Registered match source model label was wrong: ${JSON.stringify(noteRow)}`);
  assert(noteRow.disabled === false, `Registered match part-note action was disabled: ${JSON.stringify(noteRow)}`);
  assert(modelRow?.button === "Model", `Registered match source-model row did not render Model action: ${JSON.stringify(rows)}`);
  assert(
    modelRow.targetPath === "models/auto registered parts.gltf",
    `Registered match source-model target path was wrong: ${JSON.stringify(modelRow)}`,
  );
  assert(modelRow.target === "Opens source model", `Registered match source-model target copy was wrong: ${JSON.stringify(modelRow)}`);
  assert(modelRow.disabled === false, `Registered match source-model action was disabled: ${JSON.stringify(modelRow)}`);

  console.log("Workbench preview verification passed");
  console.log(JSON.stringify({
    mode: verifyMode,
    rendererRollout: verifyRollout,
    allowWorkbenchThree: verifyAllowWorkbenchThree,
    route: state.route,
    summary: state.summary,
    pixelStats: stats,
    performance: performanceSnapshot,
    selectedPart: selectedPartMarkdown,
  }, null, 2));
}

async function verifyThreeDisassemblyDragResponsive(page, route, pickPoint) {
  if (route?.backend !== "three") return;

  const setup = await page.evaluate(() => {
    const preview = window.__ai3dPreview;
    const canvas = document.querySelector("#preview-canvas");
    if (!preview || !(canvas instanceof HTMLCanvasElement) || typeof preview.toggleDisassembly !== "function") {
      return { skipped: true };
    }

    if (typeof preview.isFocusSelectionEnabled === "function" && preview.isFocusSelectionEnabled()) {
      preview.toggleFocusSelection();
    }
    const enabled = preview.toggleDisassembly();
    return {
      skipped: false,
      enabled,
      before: canvas.toDataURL("image/png"),
    };
  });

  assert(!setup.skipped, "Three disassembly verification could not access the preview");
  assert(setup.enabled === true, "Disassembly mode did not turn on");

  await page.mouse.move(pickPoint.clientX, pickPoint.clientY);
  await page.mouse.down();
  await page.mouse.move(pickPoint.clientX + 96, pickPoint.clientY + 16, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  const result = await page.evaluate(() => {
    const preview = window.__ai3dPreview;
    const canvas = document.querySelector("#preview-canvas");
    if (!preview || !(canvas instanceof HTMLCanvasElement)) {
      return { skipped: true };
    }
    const after = canvas.toDataURL("image/png");
    preview.resetDisassembly?.();
    if (typeof preview.isDisassemblyEnabled === "function" && preview.isDisassemblyEnabled()) {
      preview.toggleDisassembly();
    }
    return {
      skipped: false,
      after,
    };
  });

  assert(!result.skipped, "Three disassembly verification could not read the canvas after drag");
  assert(setup.before !== result.after, "Disassembly drag did not refresh the Three canvas immediately");
}

async function saveFailureArtifacts(page, browserMessages, error) {
  await mkdir(failureDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basePath = join(failureDir, `preview-failure-${stamp}`);
  const screenshotPath = `${basePath}.png`;
  const logPath = `${basePath}.txt`;
  let screenshotLine = "Screenshot: not captured";
  let screenshotCaptured = false;

  if (page && !page.isClosed()) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshotLine = `Screenshot: ${screenshotPath}`;
      screenshotCaptured = true;
    } catch (screenshotError) {
      screenshotLine = `Screenshot failed: ${
        screenshotError instanceof Error ? screenshotError.stack ?? screenshotError.message : String(screenshotError)
      }`;
    }
  }

  const state = page && !page.isClosed() ? await readPreviewState(page) : null;
  const lines = [
    `Error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    screenshotLine,
    "",
    "Preview state:",
    JSON.stringify(state, null, 2),
    "",
    "Browser messages:",
    browserMessages.length > 0 ? browserMessages.join("\n") : "(none)",
    "",
  ];

  await writeFile(logPath, lines.join("\n"), "utf8");
  return { screenshotPath: screenshotCaptured ? screenshotPath : null, logPath };
}

async function verify() {
  assert(existsSync(modelPath), `Missing sample model: ${modelPath}`);
  await buildHarness();
  const { server, url } = await createStaticServer();
  const browsers = candidateBrowsers();
  assert(
    browsers.length > 0,
    "No Chromium browser found. Install Microsoft Edge/Chrome or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.",
  );

  const browser = await chromium.launch({
    executablePath: browsers[0],
    headless: true,
  });

  let page = null;
  const browserMessages = [];

  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.stack ?? error.message}`));
    const params = new URLSearchParams();
    if (verifyMode !== "basic") {
      params.set("mode", verifyMode);
    }
    params.set("rollout", verifyRollout);
    if (verifyAllowWorkbenchThree) {
      params.set("allowWorkbenchThree", "1");
    }
    const modelsRoot = `${join(rootDir, "models").replace(/\\/g, "/")}/`;
    const normalizedModelPath = modelPath.replace(/\\/g, "/");
    const modelRef = normalizedModelPath.startsWith(modelsRoot)
      ? normalizedModelPath.slice(modelsRoot.length)
      : modelPath.split(/[/\\]/).pop();
    if (modelRef && modelRef !== "rubiks-cube-3x3.glb") {
      params.set("model", modelRef);
    }
    const targetUrl = params.size > 0 ? `${url}?${params.toString()}` : url;
    await page.goto(targetUrl, { waitUntil: "commit" });
    await page.waitForFunction(() => !!window.__ai3dPreviewVerify && window.__ai3dPreviewVerify.status !== "loading", null, {
      timeout: 15000,
    });

    const state = await page.evaluate(() => window.__ai3dPreviewVerify);
    assert(
      state?.status === "ready",
      `Preview failed: ${state?.error ?? "unknown error"}\n${browserMessages.join("\n")}`,
    );
    assert(state.summary.meshCount > 0, "Model summary reports zero meshes");
    assert(state.summary.triangleCount > 0, "Model summary reports zero triangles");
    assert(state.summary.vertexCount > 0, "Model summary reports zero vertices");
    assert(state.route?.backend === expectedBackend(verifyMode, verifyRollout), `Unexpected route: ${JSON.stringify(state.route)}`);
    const warnings = Array.isArray(state.summary.resourceWarnings) ? state.summary.resourceWarnings : [];
    if (verifyExpectedWarning) {
      assert(
        warnings.some((warning) => String(warning).includes(verifyExpectedWarning)),
        `Expected resource warning '${verifyExpectedWarning}', got ${JSON.stringify(warnings)}`,
      );
    }
    if (verifyExpectNoWarnings) {
      assert(warnings.length === 0, `Expected no resource warnings, got ${JSON.stringify(warnings)}`);
    }
    verifyGroupedPartsEvidence(state);

    await page.locator("#preview-canvas").scrollIntoViewIfNeeded();
    await verifyCanvasAccessibility(page);
    await page.waitForTimeout(500);
    const stats = await canvasPixelStats(page);
    assert(stats.nonBackgroundRatio > 0.01, `Canvas looks blank: ${JSON.stringify(stats)}`);
    assert(stats.contrast > 12, `Canvas has too little contrast: ${JSON.stringify(stats)}`);
    const performanceSnapshot = await page.evaluate(() => window.__ai3dPreview?.getPerformanceSnapshot?.() ?? null);
    assert(
      performanceSnapshot?.backend === state.route?.backend,
      `Performance snapshot backend did not match route: ${JSON.stringify(performanceSnapshot)}`,
    );
    await verifyThreePerformanceBudgetSnapshot(page, state.route, performanceSnapshot);

    if (verifyRouteOnly) {
      console.log("Preview route-only verification passed");
      console.log(JSON.stringify({
        mode: verifyMode,
        rendererRollout: verifyRollout,
        route: state.route,
        summary: state.summary,
        pixelStats: stats,
        performance: performanceSnapshot,
      }, null, 2));
      return;
    }

    const beforeScroll = await page.evaluate(() => window.scrollY);
    const box = await page.locator("#preview-canvas").boundingBox();
    assert(box, "Canvas bounding box is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(100);
    const afterScroll = await page.evaluate(() => window.scrollY);
    assert(
      Math.abs(afterScroll - beforeScroll) < 2,
      `Wheel over preview scrolled the page: before=${beforeScroll}, after=${afterScroll}`,
    );

    const selectedPartPick = await pickSelectedPartInfo(page, box);
    const selectedPartMarkdown = selectedPartPick.markdown;
    assert(selectedPartMarkdown.includes("Part Info"), "Selected part info was not exported");
    assert(selectedPartMarkdown.includes("| Triangles |"), "Selected part info is missing triangle count");
    await verifyFocusSelectionAfterExistingPick(page, selectedPartMarkdown);
    await verifyFocusSelectionBlankClickPreservesFocus(page, box, selectedPartMarkdown);
    if (verifyMode === "basic") {
      await verifyThreeDisassemblyDragResponsive(page, state.route, {
        clientX: selectedPartPick.clientX,
        clientY: selectedPartPick.clientY,
      });
    }

    await verifyHelperToolbar(page);

    if (verifyMode === "workbench") {
      await verifyWorkbenchMode(page, state, stats, performanceSnapshot, selectedPartMarkdown);
      return;
    }

    if (verifyMode === "direct-edit") {
      assert(state?.mode === "direct-edit", `Expected direct-edit mode, received ${state?.mode ?? "unknown"}`);

      const snapshot = await page.evaluate(() => window.__ai3dPreview?.captureSnapshot?.() ?? "");
      assert(snapshot.startsWith("data:image/png;base64,"), "Snapshot capture did not return a PNG data URL");

      await page.waitForSelector(".ai3d-annotation-editor", { timeout: 5000 });
      const editorBox = await page.locator(".ai3d-annotation-editor").boundingBox();
      assert(editorBox, "Annotation editor did not open");
      assert(
        Math.abs(editorBox.x - selectedPartPick.clientX) < 220 && Math.abs(editorBox.y - selectedPartPick.clientY) < 220,
        `Annotation editor anchored too far from pick point: ${JSON.stringify(editorBox)}`,
      );

      await page.locator(".ai3d-annotation-editor-input").fill("Phase 2 Pin");
      await page.locator(".ai3d-annotation-editor-confirm").click();
      await page.waitForFunction(() => window.__ai3dPreviewVerify?.pinCount === 1, null, { timeout: 5000 });

      const pin = page.locator(".ai3d-annotation-pin").first();
      await pin.waitFor({ state: "visible", timeout: 5000 });
      const pinLabel = (await pin.locator(".ai3d-pin-label").textContent()) ?? "";
      assert(pinLabel.includes("Phase 2 Pin"), `Created pin label was unexpected: ${pinLabel}`);

      await pin.click();
      await page.waitForFunction(() => {
        const input = document.querySelector(".ai3d-annotation-editor-input");
        return input instanceof HTMLInputElement && input.value === "Phase 2 Pin";
      }, null, { timeout: 5000 });
      await page.locator(".ai3d-annotation-editor-input").fill("Updated Pin");
      await page.locator(".ai3d-annotation-editor-confirm").click();
      await page.waitForFunction(() => window.__ai3dPreviewVerify?.pinLabels?.[0] === "Updated Pin", null, { timeout: 5000 });

      await pin.click();
      await page.waitForSelector(".ai3d-annotation-editor-delete", { timeout: 5000 });
      await page.locator(".ai3d-annotation-editor-delete").click();
      await page.waitForFunction(() => window.__ai3dPreviewVerify?.pinCount === 0, null, { timeout: 5000 });

      console.log("Direct edit preview verification passed");
      console.log(JSON.stringify({
        mode: verifyMode,
        rendererRollout: verifyRollout,
        route: state.route,
        summary: state.summary,
        pixelStats: stats,
        performance: performanceSnapshot,
        selectedPart: selectedPartMarkdown,
      }, null, 2));
      return;
    }

    if (verifyMode === "readonly-pin") {
      await verifyReadonlyPinMode(page, state);
      console.log("Readonly pin preview verification passed");
      console.log(JSON.stringify({
        mode: verifyMode,
        rendererRollout: verifyRollout,
        route: state.route,
        summary: state.summary,
        pixelStats: stats,
        performance: performanceSnapshot,
        selectedPart: selectedPartMarkdown,
      }, null, 2));
      return;
    }

    console.log("Preview verification passed");
    console.log(JSON.stringify({
      mode: verifyMode,
      rendererRollout: verifyRollout,
      route: state.route,
      summary: state.summary,
      pixelStats: stats,
      performance: performanceSnapshot,
      selectedPart: selectedPartMarkdown,
    }, null, 2));
  } catch (error) {
    const artifacts = await saveFailureArtifacts(page, browserMessages, error);
    console.error(`Preview failure artifacts saved: ${artifacts.logPath}`);
    if (artifacts.screenshotPath) {
      console.error(`Preview failure screenshot saved: ${artifacts.screenshotPath}`);
    }
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
}

function expectedBackend(mode, rollout) {
  if (verifyExpectedBackend === "three" || verifyExpectedBackend === "babylon") {
    return verifyExpectedBackend;
  }
  if (mode === "workbench" && !verifyAllowWorkbenchThree) {
    return "babylon";
  }
  if (mode === "workbench") {
    return rollout === "babylon-safe" ? "babylon" : "three";
  }
  if (mode === "direct-edit") {
    return rollout === "three-direct-glb" ? "three" : "babylon";
  }
  return rollout === "babylon-safe" ? "babylon" : "three";
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
