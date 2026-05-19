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
const bundlePath = join(outDir, "preview.js");
const shimPath = join(outDir, "obsidian-shim.js");
const entryPath = join(rootDir, "scripts", "visual-preview-entry.ts");
const modelPath = join(rootDir, "models", "rubiks-cube-3x3.glb");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json"],
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
  <style>
    html, body { margin: 0; background: #101217; color: #f6f0dd; font-family: sans-serif; }
    .scroll-sentinel { height: 900px; display: grid; place-items: center; }
    .preview-card { width: 960px; max-width: calc(100vw - 40px); margin: 0 auto; padding: 20px; background: #171b23; border-radius: 20px; }
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

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const browserMessages = [];
    page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.stack ?? error.message}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ai3dPreviewVerify?.status !== "loading", null, {
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

    const focusOn = await page.evaluate(() => window.__ai3dPreview?.toggleFocusSelection());
    assert(focusOn === true, "Focus selection did not turn on");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    const selectedPartMarkdown = await page.evaluate(() => window.__ai3dPreview?.exportSelectedPartInfo?.() ?? "");
    assert(selectedPartMarkdown.includes("Part Info"), "Selected part info was not exported");
    assert(selectedPartMarkdown.includes("| Triangles |"), "Selected part info is missing triangle count");

    console.log("Preview verification passed");
    console.log(JSON.stringify({ summary: state.summary, pixelStats: stats, selectedPart: selectedPartMarkdown }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
