import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vaultDir = parseArg("--vault") ? resolve(parseArg("--vault")) : join("/tmp", "ai-model-workbench-verify-vault");
const noteName = "AI Model Workbench Obsidian Verification.md";
const notePath = join(vaultDir, noteName);
const modelDir = join(vaultDir, "models");
const workbenchModelVaultPath = "models/rubiks-cube-3x3.glb";
const conversionFailureVaultPath = "models/needs-converter.fbx";
const obsidianApp = parseArg("--obsidian") ?? process.env.OBSIDIAN_APP ?? "/Applications/Obsidian.app";
const debugPort = Number(parseArg("--debug-port") ?? process.env.OBSIDIAN_DEBUG_PORT ?? 9222);
const pluginId = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8")).id;
const pluginFiles = ["main.js", "manifest.json", "styles.css"];
const releaseTag = parseArg("--release-tag") ?? process.env.AI3D_RELEASE_TAG ?? null;
const releaseDir = parseArg("--release-dir") ? resolve(parseArg("--release-dir")) : null;
const noteContent = [
  "# AI Model Workbench Obsidian Verification",
  "",
  "```3d",
  "models/rubiks-cube-3x3.glb",
  "```",
  "",
  "```3d",
  "models/test.stl",
  "```",
  "",
  "```3d",
  conversionFailureVaultPath,
  "```",
  "",
].join("\n");

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

async function copyPluginAsset(file, targetDir) {
  if (releaseDir) {
    await copyFile(join(releaseDir, file), join(targetDir, file));
    return;
  }

  if (releaseTag) {
    const url = `https://github.com/flash555588/ai-model-workbench/releases/download/${releaseTag}/${file}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download release asset ${file} from ${releaseTag}: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(join(targetDir, file), bytes);
    return;
  }

  await copyFile(join(rootDir, file), join(targetDir, file));
}

function obsidianDirFor(vault) {
  return basename(vault) === ".obsidian" ? vault : join(vault, ".obsidian");
}

async function prepareVault() {
  await mkdir(join(vaultDir, ".obsidian"), { recursive: true });
  await mkdir(modelDir, { recursive: true });
  await copyFile(join(rootDir, "models", "rubiks-cube-3x3.glb"), join(modelDir, "rubiks-cube-3x3.glb"));
  await copyFile(join(rootDir, "models", "test.stl"), join(modelDir, "test.stl"));
  await writeFile(join(vaultDir, conversionFailureVaultPath), "FBX-DUMMY\n", "utf8");
  await writeFile(notePath, noteContent, "utf8");

  const targetDir = join(obsidianDirFor(vaultDir), "plugins", pluginId);
  await mkdir(targetDir, { recursive: true });
  for (const file of pluginFiles) {
    await copyPluginAsset(file, targetDir);
  }
  await writeFile(join(targetDir, "data.json"), `${JSON.stringify({
    settings: {
      experimentalThreeWorkbench: true,
      previewRendererRollout: "three-direct-glb",
      useThreeRenderer: true,
    },
  }, null, 2)}\n`, "utf8");
  await enablePlugin(obsidianDirFor(vaultDir));
}

async function enablePlugin(obsidianDir) {
  const enabledPath = join(obsidianDir, "community-plugins.json");
  let enabled = [];
  if (existsSync(enabledPath)) {
    const parsed = JSON.parse(await readFile(enabledPath, "utf8"));
    if (Array.isArray(parsed)) {
      enabled = parsed;
    }
  }
  if (!enabled.includes(pluginId)) {
    enabled.push(pluginId);
  }
  await writeFile(enabledPath, `${JSON.stringify(enabled, null, 2)}\n`, "utf8");
}

async function registerVault() {
  if (process.platform !== "darwin" || process.argv.includes("--skip-register")) {
    return;
  }

  const obsidianConfigPath = join(process.env.HOME ?? "", "Library", "Application Support", "obsidian", "obsidian.json");
  if (!process.env.HOME) {
    return;
  }

  await mkdir(dirname(obsidianConfigPath), { recursive: true });
  let config = { vaults: {} };
  if (existsSync(obsidianConfigPath)) {
    config = JSON.parse(await readFile(obsidianConfigPath, "utf8"));
    if (!config || typeof config !== "object") {
      config = { vaults: {} };
    }
  }
  if (!config.vaults || typeof config.vaults !== "object") {
    config.vaults = {};
  }

  const vaultId = createHash("sha1").update(vaultDir).digest("hex").slice(0, 16);
  config.vaults[vaultId] = {
    path: vaultDir,
    ts: Date.now(),
    open: true,
  };
  await writeFile(obsidianConfigPath, `${JSON.stringify(config)}\n`, "utf8");
}

async function waitForDebugEndpoint() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until Obsidian opens the debugging endpoint.
    }
    await sleep(500);
  }
  throw new Error(`Obsidian debugging endpoint did not open on port ${debugPort}`);
}

async function openObsidian() {
  assert(existsSync(obsidianApp), `Obsidian app not found at ${obsidianApp}`);
  spawnSync("osascript", ["-e", "tell application \"Obsidian\" to quit"], { stdio: "ignore" });
  await sleep(1000);

  spawn("open", [
    "-na",
    obsidianApp,
    "--args",
    `--remote-debugging-port=${debugPort}`,
  ], {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
  }).unref();

  await waitForDebugEndpoint();
  run("open", [
    "-a",
    "Obsidian",
    `obsidian://open?path=${encodeURIComponent(notePath)}`,
  ]);
}

async function trustVaultIfPrompted(page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const trustButton = buttons.find((button) => {
      const text = (button.textContent ?? "").trim().toLowerCase();
      return text.includes("trust author")
        || text.includes("trust vault")
        || text.includes("enable plugins")
        || text.includes("信任仓库作者")
        || text.includes("启用插件");
    });
    if (!trustButton) {
      return false;
    }
    trustButton.click();
    return true;
  });

  if (clicked) {
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return !text.includes("Trust this vault")
        && !text.includes("信任仓库作者")
        && !text.includes("启用插件");
    }, null, { timeout: 15_000 }).catch(() => {});
    await sleep(1000);
  }
}

async function verifyPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  try {
    const deadline = Date.now() + 30_000;
    let page = null;
    while (Date.now() < deadline) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      for (const candidate of pages) {
        if (!candidate.url().startsWith("app://obsidian.md")) {
          continue;
        }
        const matchesVault = await candidate.evaluate((expectedVault) => {
          return window.app?.vault?.adapter?.basePath === expectedVault;
        }, vaultDir).catch(() => false);
        if (matchesVault) {
          page = candidate;
          break;
        }
      }
      if (page) {
        break;
      }
      await sleep(500);
    }
    assert(page, "Obsidian page not found through remote debugging");
    await trustVaultIfPrompted(page);

    await page.evaluate(async ({ targetNote, content }) => {
      let file = window.app?.vault?.getAbstractFileByPath?.(targetNote);
      if (file) {
        await window.app.vault.modify(file, content);
        await window.app.workspace.getLeaf(false).openFile(file);
      } else {
        await window.app.vault.adapter.write(targetNote, content);
        await window.app.workspace.openLinkText(targetNote, "", false);
      }
    }, { targetNote: noteName, content: noteContent });

    await page.waitForFunction(() => {
      return !!window.app?.plugins?.enabledPlugins?.has?.("ai-model-workbench")
        && !!window.app?.plugins?.plugins?.["ai-model-workbench"];
    }, null, { timeout: 20_000 });

    await page.waitForFunction((targetNote) => {
      return window.app?.workspace?.getActiveFile?.()?.path === targetNote
        && document.querySelectorAll(".ai3d-preview-host canvas").length >= 2;
    }, noteName, { timeout: 20_000 });
    await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll(".ai3d-preview-host"));
      hosts.at(-1)?.scrollIntoView({ block: "center" });
    });
    await page.waitForFunction(() => {
      return document.querySelectorAll(".ai3d-load-feedback").length >= 1;
    }, null, { timeout: 15_000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      function canvasStats(canvas) {
        const sample = document.createElement("canvas");
        sample.width = 64;
        sample.height = 64;
        const context = sample.getContext("2d");
        context.drawImage(canvas, 0, 0, 64, 64);
        const data = context.getImageData(0, 0, 64, 64).data;
        let nonEmpty = 0;
        let min = 255;
        let max = 0;
        for (let index = 0; index < data.length; index += 4) {
          const value = Math.max(data[index], data[index + 1], data[index + 2]);
          if (data[index + 3] > 0 && value > 8) {
            nonEmpty++;
          }
          min = Math.min(min, data[index], data[index + 1], data[index + 2]);
          max = Math.max(max, data[index], data[index + 1], data[index + 2]);
        }
        return {
          width: canvas.width,
          height: canvas.height,
          nonEmptyRatio: nonEmpty / 4096,
          contrast: max - min,
        };
      }

      return {
        title: document.title,
        activeFile: window.app?.workspace?.getActiveFile?.()?.path ?? null,
        pluginEnabled: !!window.app?.plugins?.enabledPlugins?.has?.("ai-model-workbench"),
        pluginLoaded: !!window.app?.plugins?.plugins?.["ai-model-workbench"],
        previewHostCount: document.querySelectorAll(".ai3d-preview-host").length,
        helperToolbarCount: document.querySelectorAll(".ai3d-helper-toolbar").length,
        loadFeedback: Array.from(document.querySelectorAll(".ai3d-load-feedback")).map((el) => (el.textContent ?? "").trim()),
        ai3dErrors: Array.from(document.querySelectorAll(".ai3d-error")).map((el) => (el.textContent ?? "").trim()),
        canvases: Array.from(document.querySelectorAll(".ai3d-preview-host canvas")).map(canvasStats),
      };
    });

    assert(result.pluginEnabled, "Plugin is not enabled in Obsidian");
    assert(result.pluginLoaded, "Plugin is not loaded in Obsidian");
    assert(result.activeFile === noteName, `Unexpected active file: ${result.activeFile}`);
    assert(result.previewHostCount >= 2, `Expected 2 preview hosts, got ${result.previewHostCount}`);
    assert(result.helperToolbarCount >= 2, `Expected 2 helper toolbars, got ${result.helperToolbarCount}`);
    assert(result.loadFeedback.length >= 1, "Expected conversion-chain load feedback for FBX without converter");
    assert(result.loadFeedback.some((text) => text.includes("FBX2glTF")), "Conversion-chain feedback does not mention FBX2glTF");
    assert(result.ai3dErrors.length === 0, `Plugin rendered errors: ${result.ai3dErrors.join("; ")}`);
    assert(result.canvases.length >= 2, `Expected 2 preview canvases, got ${result.canvases.length}`);
    for (const [index, canvas] of result.canvases.entries()) {
      assert(canvas.width > 0 && canvas.height > 0, `Canvas ${index} has invalid size`);
      assert(canvas.nonEmptyRatio > 0.05, `Canvas ${index} appears blank`);
      assert(canvas.contrast > 20, `Canvas ${index} has low contrast`);
    }

    console.log(JSON.stringify(result, null, 2));
    const directView = await verifyDirectWorkbench(page);
    console.log(JSON.stringify({ directView }, null, 2));
  } finally {
    await browser.close();
  }
}

async function verifyDirectWorkbench(page) {
  await page.evaluate(async (modelPath) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(modelPath);
    if (!file) {
      throw new Error(`Missing workbench model: ${modelPath}`);
    }
    await window.app.workspace.getLeaf(true).openFile(file, { active: true });
  }, workbenchModelVaultPath);

  await page.waitForFunction(() => {
    return document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas")
      && document.querySelector(".ai3d-direct-view .ai3d-helper-toolbar");
  }, null, { timeout: 20_000 });

  await page.waitForFunction(() => {
    const host = document.querySelector(".ai3d-direct-view .ai3d-preview-host");
    const panel = document.querySelector(".ai3d-direct-workbench-panel");
    return host?.getAttribute("data-ai3d-backend") === "three"
      && panel?.getAttribute("data-ai3d-backend") === "three"
      && panel.querySelector('[data-ai3d-action="set-explode"]')
      && panel.querySelector('[data-ai3d-action="generate-note"]');
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const before = await page.evaluate(() => {
    const canvas = document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Direct workbench canvas missing");
    }
    return canvas.toDataURL("image/png");
  });

  await page.locator('.ai3d-direct-view [data-ai3d-action="toggle-focus"]').click();
  await page.waitForFunction(() => {
    const button = document.querySelector('.ai3d-direct-view [data-ai3d-action="toggle-focus"]');
    return button?.getAttribute("aria-pressed") === "true";
  }, null, { timeout: 5_000 });

  await page.locator('.ai3d-direct-view [data-ai3d-action="toggle-disassembly"]').click();
  await page.waitForFunction(() => {
    const button = document.querySelector('.ai3d-direct-view [data-ai3d-action="toggle-disassembly"]');
    return button?.getAttribute("aria-pressed") === "true";
  }, null, { timeout: 5_000 });
  await page.locator('.ai3d-direct-view [data-ai3d-action="reset-parts"]').click();

  await page.locator('.ai3d-direct-view [data-ai3d-action="toggle-annotation"]').click();
  await page.waitForFunction(() => {
    const button = document.querySelector('.ai3d-direct-view [data-ai3d-action="toggle-annotation"]');
    return button?.getAttribute("aria-pressed") === "true"
      && !document.querySelector(".ai3d-annot-mode-overlay")?.classList.contains("is-hidden");
  }, null, { timeout: 5_000 });
  await page.evaluate((modelPath) => {
    const plugin = window.app?.plugins?.plugins?.["ai-model-workbench"];
    const store = plugin?.ps?.store;
    const state = store?.getState?.();
    if (!store || !state) {
      throw new Error("AI Model Workbench store was unavailable");
    }
    const currentProfiles = state.modelAssetProfiles ?? {};
    const existing = currentProfiles[modelPath] ?? {
      tags: [],
      notes: "",
      annotations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.setState({
      modelAssetProfiles: {
        ...currentProfiles,
        [modelPath]: {
          ...existing,
          annotations: [
            ...(existing.annotations ?? []),
            {
              id: "verify-focus-pin",
              position: [1.0, 1.0, 1.0],
              label: "Verification focus",
              color: "#2ec4ff",
              createdAt: new Date().toISOString(),
              headingRef: "Verification focus",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }, workbenchModelVaultPath);

  await page.locator('.ai3d-direct-view [data-ai3d-action="set-explode"]').evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Workbench explode input missing");
    }
    input.value = "0.65";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const canvas = document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Direct workbench canvas missing");
    }
    return canvas.toDataURL("image/png");
  });

  await page.locator('.ai3d-direct-view [data-ai3d-action="generate-note"]').click();
  await page.waitForFunction(() => {
    return window.app?.workspace?.getActiveFile?.()?.path === "Analysis/3D Reports/rubiks-cube-3x3 Report.md";
  }, null, { timeout: 10_000 });

  const noteText = await page.evaluate(async () => {
    const file = window.app?.workspace?.getActiveFile?.();
    if (!file) return "";
    return window.app.vault.read(file);
  });

  assert(noteText.includes("Geometry overview"), "Generated knowledge note is missing geometry content");
  assert(noteText.includes("annotation_count"), "Generated knowledge note is missing annotation metadata");
  assert(noteText.includes("## Evidence Snapshots"), "Generated knowledge note is missing evidence snapshot section");
  assert(noteText.includes("## Editable Draft"), "Generated knowledge note is missing editable draft section");
  assert(noteText.includes("Source: local evidence draft"), "Generated knowledge note should use local draft by default");
  assert(noteText.includes("## Local Draft Metadata"), "Generated knowledge note is missing local draft metadata section");
  assert(noteText.includes("## Part Candidates"), "Generated knowledge note is missing part candidates section");
  assert(noteText.includes("## Knowledge Nodes"), "Generated knowledge note is missing knowledge nodes section");
  assert(noteText.includes("## Annotation Links"), "Generated knowledge note is missing annotation links section");
  assert(noteText.includes("## AI Drafting Input"), "Generated knowledge note is missing AI drafting input section");
  assert(noteText.includes("## Remote Draft"), "Generated knowledge note is missing remote draft section");

  const analysis = await page.evaluate(async () => {
    const file = window.app?.vault?.getAbstractFileByPath?.("Analysis/3D Reports/rubiks-cube-3x3 Analysis.json");
    if (!file) return null;
    return JSON.parse(await window.app.vault.read(file));
  });
  assert(analysis?.parts?.length > 0, "Generated analysis sidecar is missing parts");
  assert(analysis?.knowledgeNodes?.length > 0, "Generated analysis sidecar is missing knowledge nodes");
  assert(analysis?.previewImages?.length > 0, "Generated analysis sidecar is missing preview images");
  assert(analysis?.annotationLinks?.length > 0, "Generated analysis sidecar is missing annotation links");
  assert(analysis?.draftingInput?.partCandidates?.length > 0, "Generated analysis sidecar is missing drafting input part candidates");
  assert(analysis?.draftingInput?.annotationLinks?.length > 0, "Generated analysis sidecar is missing drafting input annotation links");
  assert(analysis?.localDraft?.sections?.length > 0, "Generated analysis sidecar is missing local draft sections");
  assert(analysis?.localDraft?.nextActions?.length > 0, "Generated analysis sidecar is missing local draft next actions");
  assert(analysis.draftingInput.evidence.rawModelIncluded === false, "Drafting input should not include raw model data");
  assert(analysis.pipeline?.some((stage) => stage.stage === "draft" && stage.status === "success"), "Local analysis should record successful draft stage");
  assert(analysis.pipeline?.some((stage) => stage.stage === "remoteDraft" && stage.status === "skipped"), "Local analysis should record skipped remote draft stage");
  for (const imagePath of analysis.previewImages) {
    const imageExists = await page.evaluate((path) => !!window.app?.vault?.getAbstractFileByPath?.(path), imagePath);
    assert(imageExists, `Generated evidence image is missing: ${imagePath}`);
  }

  const directViewResult = await page.evaluate(({ beforeDataUrl, afterDataUrl, analysisPartCount }) => {
    const host = document.querySelector(".ai3d-direct-view .ai3d-preview-host");
    const panel = document.querySelector(".ai3d-direct-workbench-panel");
    const explodeInput = document.querySelector('.ai3d-direct-workbench-panel [data-ai3d-action="set-explode"]');
    const actions = Array.from(document.querySelectorAll(".ai3d-direct-view [data-ai3d-action]"))
      .map((element) => element.getAttribute("data-ai3d-action"))
      .filter(Boolean);
    return {
      backend: host?.getAttribute("data-ai3d-backend"),
      routeReason: host?.getAttribute("data-ai3d-route-reason"),
      actionCount: actions.length,
      hasFocus: actions.includes("toggle-focus"),
      hasDisassembly: actions.includes("toggle-disassembly"),
      hasAnnotation: actions.includes("toggle-annotation"),
      hasPanel: !!panel,
      hasExplodeControl: actions.includes("set-explode"),
      explodeValue: explodeInput instanceof HTMLInputElement ? explodeInput.value : null,
      hasKnowledgeAction: actions.includes("generate-note"),
      canvasChangedAfterControls: beforeDataUrl !== afterDataUrl,
      activeFile: window.app?.workspace?.getActiveFile?.()?.path ?? null,
      analysisPartCount,
    };
  }, { beforeDataUrl: before, afterDataUrl: after, analysisPartCount: analysis.parts.length });
  assert(directViewResult.hasPanel, "Direct workbench panel did not render");
  assert(directViewResult.hasExplodeControl, "Direct workbench panel is missing explode control");
  assert(directViewResult.explodeValue === "0.65", `Unexpected explode value: ${directViewResult.explodeValue}`);
  assert(directViewResult.hasKnowledgeAction, "Direct workbench panel is missing knowledge action");
  assert(directViewResult.canvasChangedAfterControls, "Direct workbench controls did not change the rendered canvas");
  return directViewResult;
}

await registerVault();
await prepareVault();
await openObsidian();
await verifyPage();

if (process.argv.includes("--clean")) {
  await rm(vaultDir, { recursive: true, force: true });
}
