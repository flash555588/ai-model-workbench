import esbuild from "esbuild";
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const outDir = join(rootDir, ".tmp", "workbench-dom-verify");
const entryPath = join(outDir, "entry.ts");
const bundlePath = join(outDir, "entry.js");

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function buildHarness() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(
    entryPath,
    [
      "import { html } from '../../src/view/workbench/h';",
      "",
      "const nestedList = [",
      "  html`<strong>Alpha</strong>`,",
      "  html`<em>Beta</em>`,",
      "];",
      "const actionLabel = [",
      "  html`<span class=\"icon\">Icon</span>`,",
      "  html`<span>Label</span>`,",
      "];",
      "let clickCount = 0;",
      "const root = html`",
      "  <section id=\"target\">",
      "    ${nestedList}",
      "    <button",
      "      id=\"action\"",
      "      type=\"button\"",
      "      onClick=${() => { clickCount += 1; }}",
      "      attr=${{ 'aria-label': 'Run action' }}",
      "      dataset=${{ action: 'verify' }}",
      "      style=${{ backgroundColor: 'rgb(1, 2, 3)' }}",
      "    >${actionLabel}</button>",
      "  </section>",
      "`;",
      "document.body.appendChild(root);",
      "document.getElementById('action')?.click();",
      "const action = document.getElementById('action');",
      "window.__workbenchDomVerify = {",
      "  text: document.body.textContent ?? '',",
      "  html: document.body.innerHTML,",
      "  clickCount,",
      "  ariaLabel: action?.getAttribute('aria-label'),",
      "  datasetAction: action?.dataset.action,",
      "  backgroundColor: action?.style.backgroundColor,",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  await esbuild.build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    sourcemap: false,
    logLevel: "silent",
  });
}

async function verify() {
  await buildHarness();
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
    const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
    const bundle = await import("node:fs/promises").then((fs) => fs.readFile(bundlePath, "utf8"));
    await page.setContent("<!doctype html><meta charset=\"utf-8\" /><body></body>", { waitUntil: "load" });
    await page.evaluate(() => {
      window.activeDocument = document;
      window.createDiv = function () {
        return document.createElement("div");
      };
      HTMLElement.prototype.createEl = function (tag) {
        const el = document.createElement(tag);
        this.appendChild(el);
        return el;
      };
    });
    await page.addScriptTag({ content: bundle });

    const result = await page.evaluate(() => window.__workbenchDomVerify);
    assert(result, "Workbench DOM verification result was not created");
    assert(!result.text.includes("[object HTML"), `DOM node leaked as text: ${result.text}`);
    assert(result.text.includes("Alpha"), "Nested array child did not render Alpha");
    assert(result.text.includes("Beta"), "Nested array child did not render Beta");
    assert(result.text.includes("Icon"), "Action label icon did not render");
    assert(result.text.includes("Label"), "Action label text did not render");
    assert(result.clickCount === 1, `onClick handler did not fire once: ${result.clickCount}`);
    assert(result.ariaLabel === "Run action", `attr object did not set aria-label: ${result.ariaLabel}`);
    assert(result.datasetAction === "verify", `dataset object did not set action: ${result.datasetAction}`);
    assert(
      result.backgroundColor === "rgb(1, 2, 3)",
      `style object did not set background color: ${result.backgroundColor}`,
    );
    console.log("Workbench DOM verification passed");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

verify().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
