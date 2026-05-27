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

const verifyMode = parseMode();
const verifyRollout = parseRollout();

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
  await button.waitFor({ state: "visible", timeout: 5000 });
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

  const wireBtn = await getToolbarButton(page, toolbarLabels.wireframe);
  await wireBtn.click();
  assert(
    await wireBtn.evaluate((button) => button.classList.contains("ai3d-btn-active")),
    "Wireframe toolbar button did not activate",
  );

  const axesBtn = await getToolbarButton(page, toolbarLabels.axes);
  await axesBtn.click();
  assert(
    await axesBtn.evaluate((button) => button.classList.contains("ai3d-btn-active")),
    "Orientation axes toolbar button did not activate",
  );

  const bboxBtn = await getToolbarButton(page, toolbarLabels.boundingBox);
  await bboxBtn.click();
  assert(
    await bboxBtn.evaluate((button) => button.classList.contains("ai3d-btn-active")),
    "Bounding box toolbar button did not activate",
  );

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

  const occludedPin = page.locator(".ai3d-annotation-pin", { hasText: "Occluded Pin" }).first();
  await occludedPin.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => {
    const pins = Array.from(document.querySelectorAll(".ai3d-annotation-pin"));
    const pin = pins.find((entry) => entry.textContent?.includes("Occluded Pin"));
    return pin?.classList.contains("ai3d-pin-occluded") ?? false;
  }, null, { timeout: 5000 });
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

async function verifyThreeResetViewImmediate(page, route, summary) {
  if (route?.backend !== "three") return;
  if ((summary?.meshCount ?? 0) <= 1) return;

  const result = await page.evaluate(async () => {
    const preview = window.__ai3dPreview;
    const canvas = document.querySelector("#preview-canvas");
    if (!preview || !(canvas instanceof HTMLCanvasElement) || typeof preview.setExplode !== "function") {
      return { skipped: true };
    }

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const before = canvas.toDataURL("image/png");
    preview.setExplode(0.75, "x");
    await nextFrame();
    await nextFrame();
    const exploded = canvas.toDataURL("image/png");
    preview.resetView();
    const reset = canvas.toDataURL("image/png");

    return {
      skipped: false,
      changedByExplode: before !== exploded,
      changedByReset: exploded !== reset,
    };
  });

  assert(!result.skipped, "Three reset verification could not access the preview");
  assert(result.changedByExplode, "Explode did not change the rendered canvas before reset");
  assert(result.changedByReset, "Reset view did not refresh the Three canvas immediately");
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
    // Pass model filename if not the default
    const modelFilename = modelPath.split(/[/\\]/).pop();
    if (modelFilename && modelFilename !== "rubiks-cube-3x3.glb") {
      params.set("model", modelFilename);
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

    await page.waitForTimeout(500);
    const stats = await canvasPixelStats(page);
    assert(stats.nonBackgroundRatio > 0.01, `Canvas looks blank: ${JSON.stringify(stats)}`);
    assert(stats.contrast > 12, `Canvas has too little contrast: ${JSON.stringify(stats)}`);

    await page.locator("#preview-canvas").scrollIntoViewIfNeeded();
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
    await verifyThreeResetViewImmediate(page, state.route, state.summary);
    if (verifyMode === "basic") {
      await verifyThreeDisassemblyDragResponsive(page, state.route, {
        clientX: selectedPartPick.clientX,
        clientY: selectedPartPick.clientY,
      });
    }

    await verifyHelperToolbar(page);

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
  if (mode === "direct-edit") {
    return rollout === "three-direct-glb" ? "three" : "babylon";
  }
  return rollout === "babylon-safe" ? "babylon" : "three";
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
