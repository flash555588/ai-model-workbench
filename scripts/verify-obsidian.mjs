import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vaultDir = parseArg("--vault") ? resolve(parseArg("--vault")) : join(tmpdir(), "ai-model-workbench-verify-vault");
const noteName = "AI Model Workbench Obsidian Verification.md";
const notePath = join(vaultDir, noteName);
const modelDir = join(vaultDir, "models");
const workbenchModelVaultPath = "models/rubiks-cube-3x3.glb";
const conversionFailureVaultPath = "models/needs-converter.fbx";
const obsidianApp = parseArg("--obsidian") ?? process.env.OBSIDIAN_APP ?? defaultObsidianApp();
const debugPort = Number(parseArg("--debug-port") ?? process.env.OBSIDIAN_DEBUG_PORT ?? 9222);
const pluginId = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8")).id;
const pluginFiles = ["main.js", "manifest.json", "styles.css"];
const releaseTag = parseArg("--release-tag") ?? process.env.AI3D_RELEASE_TAG ?? null;
const releaseDir = parseArg("--release-dir") ? resolve(parseArg("--release-dir")) : null;
const shouldClean = process.argv.includes("--clean");
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

function defaultObsidianApp() {
  if (process.platform === "darwin") {
    return "/Applications/Obsidian.app";
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return join(localAppData, "Programs", "Obsidian", "Obsidian.exe");
  }
  return "obsidian";
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

function obsidianConfigPath() {
  if (process.platform === "darwin") {
    return process.env.HOME ? join(process.env.HOME, "Library", "Application Support", "obsidian", "obsidian.json") : null;
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? (process.env.HOME ? join(process.env.HOME, "AppData", "Roaming") : null);
    return appData ? join(appData, "obsidian", "obsidian.json") : null;
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? (process.env.HOME ? join(process.env.HOME, ".config") : null);
  return configHome ? join(configHome, "obsidian", "obsidian.json") : null;
}

function vaultConfigId(vault) {
  return createHash("sha1").update(vault).digest("hex").slice(0, 16);
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
  if (process.argv.includes("--skip-register")) {
    return;
  }

  const configPath = obsidianConfigPath();
  if (!configPath) {
    return;
  }

  await mkdir(dirname(configPath), { recursive: true });
  let config = { vaults: {} };
  if (existsSync(configPath)) {
    config = JSON.parse(await readFile(configPath, "utf8"));
    if (!config || typeof config !== "object") {
      config = { vaults: {} };
    }
  }
  if (!config.vaults || typeof config.vaults !== "object") {
    config.vaults = {};
  }

  const vaultId = vaultConfigId(vaultDir);
  config.vaults[vaultId] = {
    path: vaultDir,
    ts: Date.now(),
    open: true,
  };
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
}

async function unregisterVault() {
  if (process.argv.includes("--skip-register")) {
    return;
  }
  const configPath = obsidianConfigPath();
  if (!configPath || !existsSync(configPath)) {
    return;
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config?.vaults || typeof config.vaults !== "object") {
    return;
  }
  delete config.vaults[vaultConfigId(vaultDir)];
  for (const [id, entry] of Object.entries(config.vaults)) {
    if (entry && typeof entry === "object" && entry.path === vaultDir) {
      delete config.vaults[id];
    }
  }
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
}

async function cleanupVault() {
  await closeObsidian();
  await unregisterVault();
  await rm(vaultDir, { recursive: true, force: true });
}

async function closeObsidian() {
  if (process.platform === "darwin") {
    spawnSync("osascript", ["-e", "tell application \"Obsidian\" to quit"], { stdio: "ignore" });
  } else if (process.platform === "win32") {
    spawnSync("taskkill", ["/IM", "Obsidian.exe", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    spawnSync("pkill", ["-f", "Obsidian"], { stdio: "ignore" });
  }
  await sleep(1000);
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
  await closeObsidian();

  if (process.platform === "darwin") {
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
  } else {
    spawn(obsidianApp, [
      `--remote-debugging-port=${debugPort}`,
    ], {
      cwd: rootDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }

  await waitForDebugEndpoint();
  openObsidianUri(`obsidian://open?path=${encodeURIComponent(notePath)}`);
}

function openObsidianUri(uri) {
  if (process.platform === "darwin") {
    run("open", ["-a", "Obsidian", uri]);
    return;
  }
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", uri], { stdio: "ignore", windowsHide: true });
    return;
  }
  spawnSync("xdg-open", [uri], { stdio: "ignore" });
}

async function trustVaultIfPrompted(page) {
  const robustClicked = await page.evaluate(() => {
    const trustPattern = /(trust author|trust vault|enable plugins|\u4fe1\u4efb|\u542f\u7528\u63d2\u4ef6)/i;
    const trustButton = Array.from(document.querySelectorAll("button"))
      .find((button) => trustPattern.test((button.textContent ?? "").trim()));
    if (!trustButton) {
      return false;
    }
    trustButton.click();
    return true;
  });

  if (robustClicked) {
    await page.waitForFunction(() => {
      const trustPattern = /(Trust this vault|trust author|enable plugins|\u4fe1\u4efb|\u542f\u7528\u63d2\u4ef6)/i;
      return !trustPattern.test(document.body.innerText ?? "");
    }, null, { timeout: 15_000 }).catch(() => {});
    await sleep(1000);
    return;
  }

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

async function dismissExternalOpenPrompt(page) {
  const dismissed = await page.evaluate(() => {
    const promptPattern = /(external link|run.*action|\u5916\u90e8\u94fe\u63a5|\u5373\u5c06\u8fd0\u884c)/i;
    const modal = Array.from(document.querySelectorAll(".modal-container"))
      .find((entry) => promptPattern.test(entry.textContent ?? ""));
    if (!modal) return false;
    const cancelPattern = /^(cancel|\u53d6\u6d88)$/i;
    const cancelButton = Array.from(modal.querySelectorAll("button"))
      .find((button) => cancelPattern.test((button.textContent ?? "").trim()));
    cancelButton?.click();
    return !!cancelButton;
  });
  if (dismissed) {
    await page.waitForFunction(() => {
      const promptPattern = /(external link|run.*action|\u5916\u90e8\u94fe\u63a5|\u5373\u5c06\u8fd0\u884c)/i;
      return !Array.from(document.querySelectorAll(".modal-container"))
        .some((entry) => promptPattern.test(entry.textContent ?? ""));
    }, null, { timeout: 5_000 });
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
    // Obsidian 1.13+ confirms command-style obsidian:// links even after the
    // target vault has opened. The verifier opens the note through the app API,
    // so cancel the redundant URI action before it can cover preview controls.
    await dismissExternalOpenPrompt(page);
    await page.waitForFunction(() => {
      return window.app?.workspace?.layoutReady === true
        && !!document.querySelector(".workspace-leaf");
    }, null, { timeout: 20_000 });
    await page.evaluate(() => {
      window.__ai3dVerifyOpenFile = async (file) => {
        const workspace = window.app?.workspace;
        if (!workspace) {
          throw new Error("Obsidian workspace unavailable");
        }
        if (workspace.layoutReady === false && workspace.onLayoutReady) {
          await new Promise((resolve) => workspace.onLayoutReady(resolve));
        }
        const leafGetters = [
          () => workspace.getMostRecentLeaf?.(),
          () => workspace.activeLeaf,
          () => workspace.getLeaf?.(false),
          () => workspace.getLeaf?.(true),
          () => workspace.getLeaf?.("tab"),
        ];
        for (const getLeaf of leafGetters) {
          try {
            const leaf = getLeaf();
            if (leaf?.openFile) {
              await leaf.openFile(file, { active: true });
              return;
            }
          } catch {
            // Try the next workspace leaf strategy.
          }
        }
        throw new Error("No Obsidian leaf was available for opening files");
      };
    });
    await page.waitForFunction((targetNote) => {
      return !!window.app?.vault?.getAbstractFileByPath?.(targetNote);
    }, noteName, { timeout: 20_000 });

    await page.evaluate(async ({ targetNote, content }) => {
      let file = window.app?.vault?.getAbstractFileByPath?.(targetNote);
      if (file) {
        await window.app.vault.modify(file, content);
      } else {
        file = await window.app.vault.create(targetNote, content);
      }
      await window.__ai3dVerifyOpenFile(file);
    }, { targetNote: noteName, content: noteContent });

    await page.evaluate(async (targetPluginId) => {
      const plugins = window.app?.plugins;
      const appId = window.app?.appId;
      if (appId) {
        localStorage.setItem(`enable-plugin-${appId}`, "true");
      }
      await plugins?.setEnable?.(true);
      if (!plugins?.plugins?.[targetPluginId]) {
        await plugins?.enablePluginAndSave?.(targetPluginId);
      }
    }, pluginId);

    await page.waitForFunction(() => {
      return !!window.app?.plugins?.enabledPlugins?.has?.("ai-model-workbench")
        && !!window.app?.plugins?.plugins?.["ai-model-workbench"];
    }, null, { timeout: 20_000 });

    await dismissExternalOpenPrompt(page);

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
      return {
        title: document.title,
        activeFile: window.app?.workspace?.getActiveFile?.()?.path ?? null,
        pluginEnabled: !!window.app?.plugins?.enabledPlugins?.has?.("ai-model-workbench"),
        pluginLoaded: !!window.app?.plugins?.plugins?.["ai-model-workbench"],
        previewHostCount: document.querySelectorAll(".ai3d-preview-host").length,
        helperToolbarCount: document.querySelectorAll(".ai3d-helper-toolbar").length,
        loadFeedback: Array.from(document.querySelectorAll(".ai3d-load-feedback")).map((el) => (el.textContent ?? "").trim()),
        ai3dErrors: Array.from(document.querySelectorAll(".ai3d-error")).map((el) => (el.textContent ?? "").trim()),
        canvases: [],
      };
    });
    result.canvases = await collectPreviewCanvasStats(page);

    assert(result.pluginEnabled, "Plugin is not enabled in Obsidian");
    assert(result.pluginLoaded, "Plugin is not loaded in Obsidian");
    assert(result.activeFile === noteName, `Unexpected active file: ${result.activeFile}`);
    assert(result.previewHostCount >= 2, `Expected 2 preview hosts, got ${result.previewHostCount}`);
    assert(result.helperToolbarCount >= 2, `Expected 2 helper toolbars, got ${result.helperToolbarCount}`);
    assert(result.loadFeedback.length >= 1, "Expected load feedback for FBX without converter");
    assert(
      result.loadFeedback.some((text) => text.includes("FBX2glTF") || text.includes("three-fbx") || text.includes("FBXLoader")),
      `FBX load feedback mentions neither FBX2glTF conversion nor Three.js direct fallback: ${JSON.stringify(result.loadFeedback)}`,
    );
    assert(result.ai3dErrors.length === 0, `Plugin rendered errors: ${result.ai3dErrors.join("; ")}`);
    assert(result.canvases.length >= 2, `Expected at least 2 preview canvases, got ${result.canvases.length}`);
    const renderedCanvases = result.canvases.filter((canvas) => canvas.nonEmptyRatio > 0.05 && canvas.contrast > 20);
    assert(
      renderedCanvases.length >= 2,
      `Expected at least 2 rendered canvases, got ${renderedCanvases.length}: ${JSON.stringify(result.canvases)}`,
    );
    for (const [index, canvas] of result.canvases.entries()) {
      assert(canvas.width > 0 && canvas.height > 0, `Canvas ${index} has invalid size`);
    }

    result.settingsTab = await verifySettingsTab(page);
    assert(result.settingsTab.settingRowCount >= 8, `Settings tab rendered too few rows: ${JSON.stringify(result.settingsTab)}`);
    assert(result.settingsTab.controlCount >= 5, `Settings tab rendered too few controls: ${JSON.stringify(result.settingsTab)}`);

    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes("--note-insert-only")) {
      console.log(JSON.stringify({ noteInsertion: await verifyNoteModelInsertion(page) }, null, 2));
      return;
    }
    if (process.argv.includes("--note-parts-only")) {
      console.log(JSON.stringify({ noteParts: await verifyNotePartDisplay(page) }, null, 2));
      return;
    }
    if (process.argv.includes("--registered-parts-only")) {
      console.log(JSON.stringify({ registeredParts: await verifyRegisteredPartDisplay(page) }, null, 2));
      return;
    }
    if (process.argv.includes("--image-embeds-only")) {
      console.log(JSON.stringify({ imageEmbeds: await verifyImageEmbeds(page) }, null, 2));
      return;
    }
    const noteUi = await verifyNoteUi(page);
    console.log(JSON.stringify({ noteUi }, null, 2));
    const imageEmbeds = await verifyImageEmbeds(page);
    console.log(JSON.stringify({ imageEmbeds }, null, 2));
    const directView = await verifyDirectWorkbench(page);
    console.log(JSON.stringify({ directView }, null, 2));
    console.log(JSON.stringify({ registeredParts: await verifyRegisteredPartDisplay(page) }, null, 2));
    console.log(JSON.stringify({ noteParts: await verifyNotePartDisplay(page) }, null, 2));
    console.log(JSON.stringify({ noteInsertion: await verifyNoteModelInsertion(page) }, null, 2));
  } finally {
    await browser.close();
  }
}

async function verifySettingsTab(page) {
  const opened = await page.evaluate(async (targetPluginId) => {
    const setting = window.app?.setting;
    if (typeof setting?.open !== "function" || typeof setting?.openTabById !== "function") {
      return false;
    }
    await setting.open();
    await setting.openTabById(targetPluginId);
    return true;
  }, pluginId);
  assert(opened, "Obsidian settings API was unavailable");

  const deadline = Date.now() + 10_000;
  let result = null;
  const pageStates = [];
  while (Date.now() < deadline && !result) {
    pageStates.length = 0;
    for (const candidate of page.context().pages()) {
      const state = await candidate.evaluate(() => {
        const scopes = [...document.querySelectorAll(".modal-container"), document];
        const scope = scopes.sort((a, b) => b.querySelectorAll(".setting-item").length
          - a.querySelectorAll(".setting-item").length)[0];
        return {
          url: document.location.href,
          title: document.title,
          settingRowCount: scope?.querySelectorAll(".setting-item").length ?? 0,
          controlCount: scope?.querySelectorAll("input, select, button, .dropdown").length ?? 0,
        };
      }).catch(() => null);
      if (!state) continue;
      pageStates.push(state);
      if (state.settingRowCount >= 8 && state.controlCount >= 5) {
        result = state;
        break;
      }
    }
    if (!result) await sleep(250);
  }
  assert(result, `Settings tab did not render: ${JSON.stringify(pageStates)}`);

  await page.evaluate(() => {
    const setting = window.app?.setting;
    if (typeof setting?.close === "function") setting.close();
  });
  return result;
}

async function collectPreviewCanvasStats(page) {
  await page.evaluate(() => {
    window.__ai3dVerifyCanvasStats = (canvas) => {
      const sample = document.createElement("canvas");
      sample.width = 64;
      sample.height = 64;
      const context = sample.getContext("2d");
      context.drawImage(canvas, 0, 0, 64, 64);
      const data = context.getImageData(0, 0, 64, 64).data;
      let nonEmpty = 0;
      let min = 255;
      let max = 0;
      for (let sampleIndex = 0; sampleIndex < data.length; sampleIndex += 4) {
        const value = Math.max(data[sampleIndex], data[sampleIndex + 1], data[sampleIndex + 2]);
        if (data[sampleIndex + 3] > 0 && value > 8) {
          nonEmpty++;
        }
        min = Math.min(min, data[sampleIndex], data[sampleIndex + 1], data[sampleIndex + 2]);
        max = Math.max(max, data[sampleIndex], data[sampleIndex + 1], data[sampleIndex + 2]);
      }
      return {
        width: canvas.width,
        height: canvas.height,
        nonEmptyRatio: nonEmpty / 4096,
        contrast: max - min,
      };
    };
  });
  const count = await page.locator(".ai3d-preview-host canvas").count();
  const canvases = [];
  for (let index = 0; index < count; index++) {
    await page.evaluate((canvasIndex) => {
      const canvas = document.querySelectorAll(".ai3d-preview-host canvas")[canvasIndex];
      canvas?.scrollIntoView({ block: "center", inline: "center" });
    }, index);
    await page.waitForTimeout(500);
    await page.waitForFunction((canvasIndex) => {
      const canvas = document.querySelectorAll(".ai3d-preview-host canvas")[canvasIndex];
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return false;
      const stats = window.__ai3dVerifyCanvasStats(canvas);
      return stats.nonEmptyRatio > 0.05 && stats.contrast > 20;
    }, index, { timeout: 10_000 }).catch(() => undefined);
    canvases.push(await page.evaluate((canvasIndex) => {
      const canvas = document.querySelectorAll(".ai3d-preview-host canvas")[canvasIndex];
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      return window.__ai3dVerifyCanvasStats(canvas);
    }, index));
  }
  return canvases.filter(Boolean);
}

async function verifyNoteModelInsertion(page) {
  const path = "Quick Insert Verification.md";
  const content = ["# 一键插入模型", "", "正文前 正文后", "", "- 列表内容", "", "> 引用内容", "", "| 位置 | 模型 |", "| --- | --- |", "| 单元格 |  |", "", ""].join("\n");
  const screenshotDir = join(rootDir, ".tmp", "note-ui-showcase");
  await mkdir(screenshotDir, { recursive: true });
  await page.evaluate(async ({ path, content }) => {
    const app = window.app;
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(await app.vault.create(path, content), { active: true });
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: true } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    window.__ai3dInsertLeaf = leaf;
  }, { path, content });
  const picker = page.locator('.ai3d-note-insert-modal');
  const run = async (line, ch, source = content) => {
    await page.evaluate(({ source, line, ch }) => {
      const editor = window.__ai3dInsertLeaf.view.editor;
      editor.setValue(source); editor.setCursor({ line, ch }); editor.focus();
      window.app.commands.executeCommandById('ai-model-workbench:insert-model-in-note');
    }, { source, line, ch });
    await picker.waitFor({ state: 'visible' });
  };
  const choose = async () => {
    await picker.locator('.prompt-input').fill('rubiks-cube-3x3');
    await picker.locator('.suggestion-item').first().click();
    await picker.waitFor({ state: 'hidden' });
  };
  const appearance = [];
  const verifyAppearance = async () => {
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const theme = await page.evaluate(() => ({ light: document.body.classList.contains('theme-light'), dark: document.body.classList.contains('theme-dark') }));
    try {
      for (const sample of [{ theme: 'light', narrow: false }, { theme: 'dark', narrow: false }, { theme: 'dark', narrow: true }]) {
        await page.evaluate(theme => { document.body.classList.toggle('theme-light', theme === 'light'); document.body.classList.toggle('theme-dark', theme === 'dark'); }, sample.theme);
        if (sample.narrow) await page.setViewportSize({ width: 390, height: 760 });
        await page.waitForTimeout(250);
        const fits = await picker.evaluate(modal => {
          const bounds = modal.getBoundingClientRect();
          const controls = [...modal.querySelectorAll('.ai3d-note-insert-options select')].map(el => el.getBoundingClientRect());
          return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
            && modal.scrollWidth <= modal.clientWidth + 2 && controls.every(rect => rect.left >= bounds.left && rect.right <= bounds.right);
        });
        assert(fits, `Insertion picker overflowed in ${sample.theme}, narrow=${sample.narrow}`);
        await picker.screenshot({ path: join(screenshotDir, `note-insert-${sample.theme}${sample.narrow ? '-narrow' : ''}.png`) });
        appearance.push({ ...sample, fits: true });
      }
    } finally {
      await page.setViewportSize(viewport);
      await page.evaluate(theme => { document.body.classList.toggle('theme-light', theme.light); document.body.classList.toggle('theme-dark', theme.dark); }, theme);
    }
  };
  const results = [];
  for (const scenario of [{ name: 'text', line: 2, ch: 4, size: '240x180' }, { name: 'list', line: 4, ch: 3, size: '240x180' }, { name: 'quote', line: 6, ch: 3, size: '240x180' }, { name: 'table', line: 10, ch: 9, size: '160x120' }, { name: 'blank', line: 12, ch: 0, size: '400x300' }]) {
    await run(scenario.line, scenario.ch);
    const partsDisabled = await picker.locator('[data-ai3d-action="insert-model-mode"] option[value="parts"]').evaluate(option => option.disabled);
    assert(partsDisabled === (scenario.name !== 'blank'), `Saved part display allowed at invalid ${scenario.name} location`);
    if (scenario.name === 'table') await picker.screenshot({ path: join(screenshotDir, 'note-insert-table.png') });
    if (scenario.name === 'blank') { await picker.screenshot({ path: join(screenshotDir, 'note-insert-blank.png') }); await verifyAppearance(); }
    await choose();
    const inserted = await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue());
    const lineStart = content.split('\n').slice(0, scenario.line).reduce((total, line) => total + line.length + 1, 0);
    const offset = lineStart + scenario.ch;
    const embed = `![[${workbenchModelVaultPath}${scenario.name === 'table' ? '\\|' : '|'}${scenario.size}]]`;
    assert(inserted === content.slice(0, offset) + embed + content.slice(offset), `Insert changed text outside the ${scenario.name} cursor`);
    const undone = await page.evaluate(() => { const editor = window.__ai3dInsertLeaf.view.editor; editor.undo(); return editor.getValue(); });
    assert(undone === content, `Insertion was not one-step undoable in ${scenario.name}`);
    results.push({ placement: scenario.name, size: scenario.size, surroundingTextPreserved: true, undo: true });
  }
  await run(2, 4);
  await picker.locator('[data-ai3d-action="insert-model-size"]').selectOption('small');
  assert(await picker.locator('.ai3d-note-insert-location output').textContent() === '220 × 165', "Picker dimension summary did not follow the size preset");
  await choose();
  assert((await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue())).includes('|220x165]]'), "Preset size ignored");
  await run(2, 4);
  await picker.locator('.prompt-input').press('Escape');
  assert(await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue()) === content, "Cancel changed the note");
  // Equal file names must remain distinguishable by searchable vault path.
  await page.evaluate(async modelPath => {
    const app = window.app;
    const model = app.vault.getAbstractFileByPath(modelPath);
    for (const folder of ['Picker Folder A', 'Picker Folder B']) {
      await app.vault.createFolder(folder);
      await app.vault.copy(model, `${folder}/shared-model.glb`);
    }
  }, workbenchModelVaultPath);
  await run(12, 0);
  await picker.locator('.prompt-input').fill('Picker Folder B/shared-model');
  assert(await picker.locator('.suggestion-item').count() === 1, "Picker did not filter duplicate model names by path");
  assert(await picker.locator('.ai3d-model-suggestion-name').textContent() === 'shared-model.glb', "Picker lost the file name");
  assert(await picker.locator('.ai3d-model-suggestion-path').textContent() === 'Picker Folder B/shared-model.glb', "Picker lost the distinguishing vault path");
  assert(await picker.locator('.suggestion-highlight').count() > 0, "Picker lost fuzzy search highlighting");
  await picker.locator('.prompt-input').press('ArrowDown');
  await picker.locator('.prompt-input').press('Enter');
  await picker.waitFor({ state: 'hidden' });
  assert((await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue())).includes('![[Picker Folder B/shared-model.glb|400x300]]'), "Keyboard insertion chose the wrong duplicate model");
  await run(2, 4);
  await picker.locator('.prompt-input').press('Escape');
  const savedLocale = await page.evaluate(() => window.app.plugins.plugins['ai-model-workbench'].getSettings().locale);
  try {
    await page.evaluate(() => window.app.plugins.plugins['ai-model-workbench'].updateSettings({ locale: 'en' }));
    await run(12, 0);
    assert(await picker.locator('h3').textContent() === 'Insert a 3D model', "English picker title was not translated");
    assert(await picker.locator('.ai3d-note-insert-location').textContent() === 'Standalone400 × 300', "English placement summary was not translated");
    await picker.screenshot({ path: join(screenshotDir, 'note-insert-english.png') });
    await picker.locator('.prompt-input').press('Escape');
  } finally { await page.evaluate(locale => window.app.plugins.plugins['ai-model-workbench'].updateSettings({ locale }), savedLocale); }
  // Read the editor DOM only for a context-menu mouse target; edits use Editor APIs.
  await page.locator('.markdown-source-view:visible .cm-line').filter({ hasText: '正文前 正文后' }).first().click({ button: 'right' });
  await page.locator('.menu-item-title').filter({ hasText: '在笔记中插入 3D 模型' }).click();
  await picker.waitFor({ state: 'visible' });
  await choose();
  assert((await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue())).includes(`![[${workbenchModelVaultPath}|240x180]]`), "Editor context menu did not insert a model");
  assert(await page.evaluate(() => { const editor = window.__ai3dInsertLeaf.view.editor; editor.undo(); return editor.getValue(); }) === content, "Context-menu insert changed surrounding text");
  await run(2, 4);
  await page.evaluate(source => window.__ai3dInsertLeaf.view.editor.setValue(source + 'External update'), content);
  await choose();
  assert(await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue()) === content + 'External update', "Stale picker overwrote a changed note");
  await run(2, 4);
  const otherPath = 'Quick Insert Other.md';
  const otherContent = 'This note must remain unchanged.';
  await page.evaluate(async ({ path, content }) => {
    const leaf = window.__ai3dInsertLeaf;
    await leaf.openFile(await window.app.vault.create(path, content), { active: true });
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: true } });
  }, { path: otherPath, content: otherContent });
  await choose();
  assert(await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue()) === otherContent, "Picker inserted into a different note after a file switch");
  await page.evaluate(async path => {
    const leaf = window.__ai3dInsertLeaf;
    await leaf.openFile(window.app.vault.getAbstractFileByPath(path), { active: true });
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: true } });
  }, path);
  const code = "```md\nexample\n```";
  await page.evaluate(code => {
    const editor = window.__ai3dInsertLeaf.view.editor;
    editor.setValue(code); editor.setCursor({ line: 1, ch: 0 }); editor.focus();
    window.app.commands.executeCommandById('ai-model-workbench:insert-model-in-note');
  }, code);
  await page.waitForTimeout(200);
  assert(await picker.count() === 0, "Insert picker opened inside a code example");
  assert(await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue()) === code, "Code example was modified");
  await run(12, 0);
  await picker.locator('[data-ai3d-action="insert-model-mode"]').selectOption('parts');
  await picker.screenshot({ path: join(screenshotDir, 'note-insert-parts.png') });
  await choose();
  const partsContent = await page.evaluate(() => window.__ai3dInsertLeaf.view.editor.getValue());
  assert(partsContent.includes('"parts": true') && partsContent.includes('"width": 400'), "Parts insertion omitted persistent defaults");
  await page.evaluate(async ({ path, modelPath }) => {
    const app = window.app;
    const ps = app.plugins.plugins['ai-model-workbench'].ps;
    window.__ai3dInsertOriginalParts = ps.store.getState().modelAssetProfiles[modelPath]?.registeredParts ?? [];
    ps.updateModelProfile(modelPath, () => ({ registeredParts: [] }));
    const leaf = window.__ai3dInsertLeaf;
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
  }, { path, modelPath: workbenchModelVaultPath });
  const block = page.locator('.markdown-preview-view:visible .ai3d-note-preview').last();
  await block.scrollIntoViewIfNeeded();
  const register = block.locator('[data-ai3d-action="note-parts-register"]');
  await register.waitFor({ state: 'visible' });
  assert(await page.locator('.ai3d-registered-parts-modal').count() === 0, "Empty in-note parts display opened an extra dialog");
  await register.click();
  await page.waitForFunction(modelPath => window.app.plugins.plugins['ai-model-workbench'].ps.store.getState().modelAssetProfiles[modelPath]?.registeredParts?.length > 0, workbenchModelVaultPath, { timeout: 20_000 });
  await page.evaluate(() => window.app.workspace.setActiveLeaf(window.__ai3dInsertLeaf, { focus: true }));
  await page.waitForFunction(frame => frame?.classList.contains('ai3d-note-parts-active'), await block.elementHandle(), { timeout: 20_000 });
  assert(await block.locator('[data-ai3d-action="note-parts-select"] option:enabled').count() > 1, "Model registration did not activate the inserted note catalog");
  await block.screenshot({ path: join(screenshotDir, 'note-insert-result.png') });
  await page.evaluate(modelPath => {
    window.app.plugins.plugins['ai-model-workbench'].ps.updateModelProfile(modelPath, () => ({ registeredParts: window.__ai3dInsertOriginalParts }));
    delete window.__ai3dInsertOriginalParts; delete window.__ai3dInsertLeaf;
  }, workbenchModelVaultPath);
  return { placements: results, appearance, englishPicker: true, duplicatePathsSearchable: true, searchHighlighting: true, keyboardInsertion: true, presetOverride: true, contextMenu: true, cancelPreservedNote: true, staleNoteRejected: true, noteSwitchRejected: true, codeExamplesBlocked: true, persistentPartsBlock: true, emptyRegistrationGuided: true, noteCatalogActivatedAfterRegistration: true };
}

async function verifyNotePartDisplay(page) {
  const logRuntimeError = message => { if (message.type() === 'error' || message.type() === 'warning') console.log('note runtime', message.text().slice(0, 1000)); };
  page.on('console', logRuntimeError);
  const savedSettings = await page.evaluate(() => {
    const settings = window.app.plugins.plugins["ai-model-workbench"].ps.store.getState().settings;
    return { useThreeRenderer: settings.useThreeRenderer, previewRendererRollout: settings.previewRendererRollout, experimentalThreeWorkbench: settings.experimentalThreeWorkbench };
  });
  const screenshotDir = join(rootDir, ".tmp", "note-ui-showcase");
  await mkdir(screenshotDir, { recursive: true });
  const results = [];
  try {
    // Register through the real model view first; notes only consume this profile.
    await page.evaluate(async modelPath => {
      const app = window.app;
      app.plugins.plugins["ai-model-workbench"].ps.updateSettings({ useThreeRenderer: false, previewRendererRollout: "babylon-safe", experimentalThreeWorkbench: false });
      await window.__ai3dVerifyOpenFile(app.vault.getAbstractFileByPath(modelPath));
    }, workbenchModelVaultPath);
    await page.waitForFunction(modelPath => window.app.plugins.plugins["ai-model-workbench"].ps.store.getState().modelAssetProfiles[modelPath]?.registeredParts?.length > 0, workbenchModelVaultPath, { timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector('[data-ai3d-action="show-registered-parts"]')?.disabled, null, { timeout: 20_000 });
    await page.waitForTimeout(1800);
    await trustVaultIfPrompted(page);
    const partId = await page.evaluate(modelPath => window.app.plugins.plugins["ai-model-workbench"].ps.store.getState().modelAssetProfiles[modelPath].registeredParts[0].partId, workbenchModelVaultPath);
    for (const backend of ["babylon", "three"]) {
      const path = `Note Parts ${backend}.md`;
      const config = { models: [{ path: workbenchModelVaultPath }], height: 300, parts: { display: "registered", separation: 75 } };
      const content = ["# 笔记中的已登记零件", "", "正文直接展示拆解结果：", "", "```3d", JSON.stringify(config, null, 2), "```", "", "| 区域 | 模型 |", "| --- | --- |", `| 任意区域 | ![[${workbenchModelVaultPath}\\|220x160]] |`, ""].join("\n");
      await page.evaluate(async ({ path, content, backend }) => {
        const app = window.app;
        app.plugins.plugins["ai-model-workbench"].ps.updateSettings({ useThreeRenderer: backend === "three", previewRendererRollout: backend === "three" ? "three-readonly-glb" : "babylon-safe" });
        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(await app.vault.create(path, content), { active: true });
        await leaf.setViewState({ type: "markdown", state: { file: path, mode: "preview" } });
        window.__ai3dNotePartsLeaf = leaf;
        app.workspace.setActiveLeaf(leaf, { focus: true });
      }, { path, content, backend });
      const reading = page.locator('.markdown-preview-view:visible').last();
      const block = reading.locator('.ai3d-note-preview').first();
      await block.scrollIntoViewIfNeeded().catch(async error => {
        console.log('note parts mount', await page.evaluate(() => ({ active: window.app.workspace.getActiveFile()?.path, leaves: window.app.workspace.getLeavesOfType('markdown').map(leaf => ({ path: leaf.view.file?.path, state: leaf.view.getState() })), previews: [...document.querySelectorAll('.markdown-preview-view')].map(el => ({ visible: getComputedStyle(el).display, html: el.innerHTML.slice(0, 5500) })) })));
        throw error;
      });
      await page.waitForFunction(({ frame, backend }) => {
        return frame?.classList.contains('ai3d-note-parts-active') && frame.querySelector('.ai3d-preview-host')?.dataset.ai3dBackend === backend;
      }, { frame: await block.elementHandle(), backend }, { timeout: 20_000 }).catch(async error => {
        console.log('note readiness', await block.evaluate(frame => ({ classes: frame.className, html: frame.innerHTML.slice(-4500), host: frame.querySelector('.ai3d-preview-host')?.dataset })));
        throw error;
      });
      const options = block.locator('[data-ai3d-action="note-parts-select"]');
      const optionCount = await options.locator('option:enabled').count();
      assert(optionCount > 1, `No note geometry matched on ${backend}`);
      await block.locator('.ai3d-loading-overlay:not(.is-hidden)').waitFor({ state: 'hidden' });
      await page.waitForTimeout(500);
      assert(await block.locator('[data-ai3d-action="note-parts-spacing"]').inputValue() === "75", "Note ignored initial separation");
      await block.locator('canvas').evaluate(canvas => { window.__ai3dNotePartsCanvas = canvas; });
      await block.locator('[data-ai3d-action="note-parts-spacing"]').fill("100");
      await page.waitForTimeout(400);
      await block.screenshot({ path: join(screenshotDir, `note-parts-catalog-${backend}.png`) });
      const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const theme = await page.evaluate(() => ({ light: document.body.classList.contains('theme-light'), dark: document.body.classList.contains('theme-dark') }));
      const sidebars = await page.evaluate(() => ({ left: window.app.workspace.leftSplit.collapsed, right: window.app.workspace.rightSplit.collapsed }));
      try {
        await page.evaluate(() => { window.app.workspace.leftSplit.collapse(); window.app.workspace.rightSplit.collapse(); });
        await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); });
        await page.setViewportSize({ width: 390, height: 760 });
        await page.waitForTimeout(400);
        const fits = await block.locator('.ai3d-note-parts-bar').evaluate(bar => {
          const bounds = bar.getBoundingClientRect();
          return bar.scrollWidth <= bar.clientWidth + 2 && [...bar.querySelectorAll('select, input, button:not(.is-hidden)')].every(el => {
            const rect = el.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right;
          });
        });
        await block.screenshot({ path: join(screenshotDir, `note-parts-dark-narrow-${backend}.png`) });
        if (!fits) console.log('part controls bounds', JSON.stringify(await block.locator('.ai3d-note-parts-bar').evaluate(bar => ({ bounds: bar.getBoundingClientRect().toJSON(), scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, controls: [...bar.querySelectorAll('select, input, button:not(.is-hidden)')].map(el => ({ action: el.dataset.ai3dAction, bounds: el.getBoundingClientRect().toJSON() })) }))));
        assert(fits, `Note part controls overflowed on narrow ${backend} layout`);
      } finally {
        await page.setViewportSize(viewport);
        await page.evaluate(state => { if (!state.left) window.app.workspace.leftSplit.expand(); if (!state.right) window.app.workspace.rightSplit.expand(); }, sidebars);
        await page.evaluate(theme => { document.body.classList.toggle('theme-light', theme.light); document.body.classList.toggle('theme-dark', theme.dark); }, theme);
      }
      await options.selectOption(partId);
      await block.locator('[data-ai3d-action="note-parts-spacing"]').fill("45");
      await page.evaluate(() => {
        window.__ai3dNotePartsClipboardOriginal = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async value => { window.__ai3dNotePartsCopied = value; };
      });
      await block.locator('[data-ai3d-action="note-parts-copy"]').click();
      const copied = await page.evaluate(() => window.__ai3dNotePartsCopied);
      assert(copied?.includes(partId) && copied.includes('"separation": 45'), "Copy lost the current note part selection");
      await page.evaluate(() => { navigator.clipboard.writeText = window.__ai3dNotePartsClipboardOriginal; delete window.__ai3dNotePartsClipboardOriginal; });
      await block.locator('[data-ai3d-action="note-parts-inspect"]').click();
      const inspection = page.locator('.ai3d-registered-parts-modal');
      await inspection.waitFor({ state: "visible" });
      assert(await inspection.locator('canvas').evaluate(canvas => canvas === window.__ai3dNotePartsCanvas), "Inspection created a second preview");
      await inspection.locator('canvas').focus(); await inspection.locator('canvas').press('m');
      assert(await page.locator('.ai3d-image-viewer-modal').count() === 0, "Inspection keyboard shortcut opened the image viewer");
      await page.waitForTimeout(5200);
      await inspection.screenshot({ path: join(screenshotDir, `note-parts-inspection-${backend}.png`) });
      await inspection.locator('[data-ai3d-action="parts-back"]').click();
      await inspection.waitFor({ state: "detached" });
      assert(await options.inputValue() === partId && await block.locator('[data-ai3d-action="note-parts-spacing"]').inputValue() === "45", "Inspection return lost the note presentation");
      assert(await block.locator('canvas').evaluate(canvas => canvas === window.__ai3dNotePartsCanvas), "Return lost the original note canvas");
      assert(await block.locator('[data-ai3d-action="note-parts-inspect"]').evaluate(button => button === document.activeElement), "Return lost keyboard focus");
      await block.locator('canvas').focus(); await block.locator('canvas').press('r');
      assert(!await block.evaluate(frame => frame.classList.contains('ai3d-note-parts-active')), "Reset shortcut left the note in part display");
      const toggle = block.locator('[data-ai3d-action="note-parts-toggle"]');
      await toggle.click();
      // Updating a model profile refreshes existing note widgets without editing Markdown.
      await page.evaluate(modelPath => {
        const ps = window.app.plugins.plugins['ai-model-workbench'].ps;
        window.__ai3dNotePartsSaved = ps.store.getState().modelAssetProfiles[modelPath].registeredParts;
        ps.updateModelProfile(modelPath, () => ({ registeredParts: [] }));
      }, workbenchModelVaultPath);
      assert(await block.locator('[data-ai3d-action="note-parts-register"]').isVisible(), "Missing registration did not offer the model entry");
      await page.evaluate(modelPath => window.app.plugins.plugins['ai-model-workbench'].ps.updateModelProfile(modelPath, () => ({ registeredParts: window.__ai3dNotePartsSaved })), workbenchModelVaultPath);
      assert(await options.locator('option:enabled').count() > 1, "New registration did not refresh the active note");
      const image = reading.locator('.ai3d-image-embed').first();
      await image.scrollIntoViewIfNeeded(); await image.hover();
      await page.waitForFunction(() => !document.querySelector('.markdown-preview-view .ai3d-image-actions [data-ai3d-action="note-parts-toggle"]')?.disabled, null, { timeout: 20_000 });
      const before = await image.boundingBox();
      await image.locator('.ai3d-image-actions [data-ai3d-action="note-parts-toggle"]').click();
      const after = await image.boundingBox();
      assert(Math.abs(before.height - after.height) < 1 && Math.abs(before.width - after.width) < 1, "Part catalog changed the image footprint");
      await image.locator('[data-ai3d-action="expand-preview"]').click();
      const expanded = page.locator('.ai3d-image-viewer-modal');
      await expanded.waitFor({ state: 'visible' });
      await expanded.locator('[data-ai3d-action="note-parts-inspect"]').click();
      await inspection.waitFor({ state: 'visible' });
      await inspection.locator('[data-ai3d-action="parts-back"]').click();
      assert(await expanded.isVisible() && await expanded.locator('canvas').count() === 1, "Inspection did not return to the expanded image");
      await expanded.locator('[data-ai3d-action="return-to-note"]').click();
      await expanded.waitFor({ state: 'hidden' });
      assert(await page.evaluate(async path => window.app.vault.read(window.app.vault.getAbstractFileByPath(path)), path) === content, "Reading note interactions edited Markdown");
      // Use Obsidian's public editor API, never edit the CodeMirror DOM.
      await page.evaluate(async path => {
        const leaf = window.__ai3dNotePartsLeaf;
        await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: false } });
        const editor = leaf.view.editor;
        const line = editor.lastLine() - 1;
        editor.setCursor({ line: 0, ch: 0 });
        editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }, path);
      const live = page.locator('.markdown-source-view:visible .ai3d-image-embed').first();
      await live.scrollIntoViewIfNeeded(); await live.hover();
      await page.waitForFunction(() => !document.querySelector('.markdown-source-view .ai3d-image-actions [data-ai3d-action="note-parts-toggle"]')?.disabled, null, { timeout: 20_000 });
      await live.locator('.ai3d-image-actions [data-ai3d-action="note-parts-toggle"]').click();
      assert(await live.locator('.ai3d-note-preview').evaluate(frame => frame.classList.contains('ai3d-note-parts-active')), "Live Preview did not enter registered part display");
      await live.locator('[data-ai3d-action="expand-preview"]').click();
      await expanded.locator('[data-ai3d-action="note-parts-inspect"]').click();
      await inspection.waitFor({ state: 'visible' });
      assert(await page.evaluate(() => window.__ai3dNotePartsLeaf.view.editor.getValue()) === content, "Live Preview interactions edited Markdown");
      await page.evaluate(async path => window.__ai3dNotePartsLeaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source', source: true } }), path);
      await page.waitForFunction(() => !document.querySelector('.markdown-source-view .ai3d-cm-widget.ai3d-image-embed'), null, { timeout: 10_000 }).catch(async error => {
        console.log('note source cleanup', await page.evaluate(() => ({ state: window.__ai3dNotePartsLeaf.view.getState(), source: document.querySelector('.markdown-source-view')?.innerHTML.slice(-1800), dialogs: [...document.querySelectorAll('.modal')].map(el => el.className) })));
        throw error;
      });
      await inspection.waitFor({ state: 'detached' });
      await expanded.waitFor({ state: 'hidden' });
      results.push({ backend, matchedParts: optionCount - 1, inlineCatalog: true, singlePartAndCopy: true, sameCanvasAndFocus: true, liveProfileRefresh: true, imageFootprintPreserved: true, nestedInspection: true, livePreview: true, sourceSwitchCleanup: true, markdownUnchanged: true });
    }
  } finally {
    page.off('console', logRuntimeError);
    await page.evaluate(({ settings, modelPath }) => {
      const ps = window.app.plugins.plugins['ai-model-workbench'].ps;
      ps.updateSettings(settings);
      if (window.__ai3dNotePartsSaved) ps.updateModelProfile(modelPath, () => ({ registeredParts: window.__ai3dNotePartsSaved }));
      if (window.__ai3dNotePartsClipboardOriginal) navigator.clipboard.writeText = window.__ai3dNotePartsClipboardOriginal;
      for (const key of Object.keys(window).filter(key => key.startsWith('__ai3dNoteParts'))) delete window[key];
    }, { settings: savedSettings, modelPath: workbenchModelVaultPath });
  }
  return results;
}

async function verifyRegisteredPartDisplay(page) {
  const results = [];
  const savedSettings = await page.evaluate(() => {
    const ps = window.app.plugins.plugins["ai-model-workbench"].ps;
    const settings = ps.store.getState().settings;
    return { useThreeRenderer: settings.useThreeRenderer, previewRendererRollout: settings.previewRendererRollout, experimentalThreeWorkbench: settings.experimentalThreeWorkbench };
  });
  try {
    for (const backend of ["babylon", "three"]) {
      await page.evaluate(async ({ backend, modelPath }) => {
        const app = window.app;
        app.plugins.plugins["ai-model-workbench"].ps.updateSettings({ useThreeRenderer: backend === "three", experimentalThreeWorkbench: backend === "three", previewRendererRollout: backend === "three" ? "three-direct-glb" : "babylon-safe" });
        for (const leaf of app.workspace.getLeavesOfType("ai3d-direct-view")) leaf.detach();
        await window.__ai3dVerifyOpenFile(app.vault.getAbstractFileByPath(modelPath));
      }, { backend, modelPath: workbenchModelVaultPath });
      await page.waitForFunction(backend => {
        const host = document.querySelector(".ai3d-direct-view .ai3d-preview-host");
        const button = document.querySelector('[data-ai3d-action="show-registered-parts"]');
        return host?.dataset.ai3dBackend === backend && button && !button.disabled;
      }, backend, { timeout: 20_000 });
      await page.waitForTimeout(1800);
      await trustVaultIfPrompted(page);
      const registeredCount = await page.evaluate(modelPath => {
        const app = window.app;
        const ps = app.plugins.plugins["ai-model-workbench"].ps;
        const parts = ps.store.getState().modelAssetProfiles[modelPath].registeredParts;
        window.__ai3dPartsOriginal = parts;
        const withoutLast = parts.length > 1 ? parts.slice(0, -1) : parts;
        ps.updateModelProfile(modelPath, () => ({ registeredParts: [...withoutLast, {
          ...parts[0], partId: "verify-missing-part", name: "Missing registered part", componentId: undefined,
          occurrenceId: undefined, componentPath: "missing/node", meshRefs: ["missing-mesh"], childCount: 1,
        }] }));
        const views = app.workspace.getLeavesOfType("ai3d-direct-view").map(leaf => leaf.view.delegate ?? leaf.view);
        const preview = views.find(view => view.preview)?.preview;
        if (!preview) throw new Error(`Direct preview unavailable: ${JSON.stringify(views.map(view => ({ type: view.constructor.name, keys: Object.keys(view), nested: view.view && Object.keys(view.view) })))}`);
        window.__ai3dPartsSnapshot = () => {
          const geometries = preview.rootObject ? [] : preview.getRenderableMeshes(preview.rootMesh);
          preview.rootObject?.traverse(object => { if (object.isMesh || object.isPoints) geometries.push(object); });
          return {
            geometry: geometries.map(object => ({ key: object.uuid ?? object.uniqueId, position: [object.position.x, object.position.y, object.position.z], visible: object.visible ?? object.isVisible, layers: object.layers?.mask })),
            camera: preview.rootObject ? [...preview.camera.position.toArray(), ...preview.controls.target.toArray()]
              : [preview.camera.alpha, preview.camera.beta, preview.camera.radius, ...preview.camera.target.asArray()],
          };
        };
        return withoutLast.length + 1;
      }, workbenchModelVaultPath);
      const before = await page.evaluate(() => window.__ai3dPartsSnapshot());
      await page.locator('[data-ai3d-action="show-registered-parts"]').click();
      const dialog = page.locator(".ai3d-registered-parts-modal");
      await dialog.waitFor({ state: "visible" });
      await page.waitForTimeout(600);
      const backFits = await dialog.locator('[data-ai3d-action="parts-back"]').evaluate(button => {
        const bounds = button.getBoundingClientRect(); const modal = button.closest(".modal").getBoundingClientRect();
        return bounds.top >= modal.top && bounds.bottom <= modal.bottom;
      });
      assert(backFits, "Return to model button is clipped");
      const match = await dialog.locator(".ai3d-registered-part").evaluateAll(cards => cards.map(card => ({ status: card.dataset.matchStatus, name: card.querySelector("h4").textContent, disabled: card.querySelector('[data-ai3d-action="part-isolate"]').disabled })));
      assert(match.length === registeredCount && match.some(row => row.status === "matched"), `Registered geometry did not match on ${backend}: ${JSON.stringify(match)}`);
      assert(match.some(row => row.status === "missing" && row.disabled), `Missing registration was not reported on ${backend}`);
      const expanded = await page.evaluate(() => window.__ai3dPartsSnapshot());
      assert(JSON.stringify(before.geometry) !== JSON.stringify(expanded.geometry), `Parts did not separate on ${backend}`);
      const screenshotDir = join(rootDir, ".tmp", "note-ui-showcase");
      await mkdir(screenshotDir, { recursive: true });
      await dialog.screenshot({ path: join(screenshotDir, `registered-parts-${backend}.png`) });
      const first = dialog.locator('.ai3d-registered-part[data-match-status="matched"]').first();
      const name = await first.locator("h4").textContent();
      await dialog.locator('input[type="search"]').fill(name);
      assert(await dialog.locator(".ai3d-registered-part:visible").count() >= 1, "Part search hid the matching part");
      await dialog.locator('input[type="search"]').fill("no-part-matches-this-query");
      assert(await dialog.locator(".ai3d-registered-part:visible").count() === 0 && await dialog.locator(".ai3d-registered-parts-empty").isVisible(), "Part search empty state missing");
      await dialog.locator('input[type="search"]').fill("");
      await first.locator('[data-ai3d-action="part-isolate"]').click();
      assert(await first.locator('[data-ai3d-action="part-isolate"]').getAttribute("aria-pressed") === "true", "Isolated part not selected");
      assert(await first.locator('[data-ai3d-action="part-isolate"]').textContent() === "恢复其他零件", "Selected part button did not describe its next action");
      const isolatedGeometry = await page.evaluate(() => window.__ai3dPartsSnapshot().geometry);
      const visibleCount = isolatedGeometry.filter(object => object.visible && object.layers !== 0).length;
      assert(visibleCount > 0 && visibleCount < before.geometry.length, `Single-part view did not hide other geometry on ${backend}`);
      await page.waitForTimeout(400);
      await dialog.screenshot({ path: join(screenshotDir, `registered-part-alone-${backend}.png`) });
      await first.locator('[data-ai3d-action="part-visible"]').uncheck();
      const hiddenGeometry = await page.evaluate(() => window.__ai3dPartsSnapshot().geometry);
      assert(hiddenGeometry.every(object => !object.visible || object.layers === 0), `Part visibility did not hide the isolated geometry on ${backend}`);
      await first.locator('[data-ai3d-action="part-visible"]').check();
      await dialog.locator('[data-ai3d-action="parts-all"]').click();
      assert(await first.locator('[data-ai3d-action="part-isolate"]').textContent() === "单独查看", "Leaving isolation did not restore the button label");
      await dialog.locator('[data-ai3d-action="parts-spacing"]').fill("40");
      const initialViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      await page.setViewportSize({ width: 600, height: 780 });
      await page.waitForTimeout(400);
      const narrowFits = await dialog.evaluate(modal => {
        const bounds = modal.getBoundingClientRect();
        const back = modal.querySelector('[data-ai3d-action="parts-back"]').getBoundingClientRect();
        const stage = modal.querySelector(".ai3d-registered-parts-stage").getBoundingClientRect();
        return back.bottom <= bounds.bottom && stage.height >= 100 && modal.scrollWidth <= modal.clientWidth + 2;
      });
      assert(narrowFits, `Part inspection overflowed on narrow ${backend} layout`);
      await page.setViewportSize(initialViewport);
      await page.waitForTimeout(400);
      await dialog.locator('[data-ai3d-action="parts-reset"]').click();
      const restored = await page.evaluate(() => window.__ai3dPartsSnapshot());
      assert(JSON.stringify(before.geometry) === JSON.stringify(restored.geometry), `Assembly reset changed original geometry on ${backend}`);
      const canvas = dialog.locator("canvas");
      await canvas.focus(); await canvas.press("m");
      await canvas.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__ai3dPartsSnapshot());
      assert(JSON.stringify(before.geometry) === JSON.stringify(after.geometry), `Closing changed original geometry on ${backend}`);
      const cameraDelta = Math.max(...before.camera.map((value, index) => Math.abs(value - after.camera[index])));
      assert(cameraDelta < 0.0001, `Camera not restored on ${backend}: ${cameraDelta}`);
      const focusReturned = await page.locator('[data-ai3d-action="show-registered-parts"]').evaluate(button => button === document.activeElement);
      assert(focusReturned, "Focus did not return to the part display entry");
      await page.locator('[data-ai3d-action="show-registered-parts"]').click();
      await dialog.waitFor({ state: "visible" });
      await page.evaluate(async targetNote => {
        const leaf = window.app.workspace.getLeavesOfType("ai3d-direct-view")[0];
        await leaf.openFile(window.app.vault.getAbstractFileByPath(targetNote));
      }, noteName);
      await dialog.waitFor({ state: "detached" });
      await page.evaluate(modelPath => {
        window.app.plugins.plugins["ai-model-workbench"].ps.updateModelProfile(modelPath, () => ({ registeredParts: window.__ai3dPartsOriginal }));
        delete window.__ai3dPartsOriginal; delete window.__ai3dPartsSnapshot;
      }, workbenchModelVaultPath);
      results.push({ backend, registeredCount, matched: match.filter(row => row.status === "matched").length, missingReported: true, separationVerified: true, resetAndCloseVerified: true, cameraDelta, modelSwitchVerified: true });
    }
  } finally {
    await page.evaluate(settings => window.app.plugins.plugins["ai-model-workbench"].ps.updateSettings(settings), savedSettings);
  }
  return results;
}

async function verifyDirectWorkbench(page) {
  await page.evaluate(async (modelPath) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(modelPath);
    if (!file) {
      throw new Error(`Missing workbench model: ${modelPath}`);
    }
    await window.__ai3dVerifyOpenFile(file);
  }, workbenchModelVaultPath);

  await page.waitForFunction(() => {
    return document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas")
      && document.querySelector(".ai3d-direct-view .ai3d-helper-toolbar");
  }, null, { timeout: 20_000 });

  await page.waitForFunction(() => {
    const host = document.querySelector(".ai3d-direct-view .ai3d-preview-host");
    const panel = document.querySelector(".ai3d-direct-workbench-panel");
    const view = document.querySelector(".ai3d-direct-view");
    return host?.getAttribute("data-ai3d-backend") === "three"
      && panel?.getAttribute("data-ai3d-backend") === "three"
      && view?.querySelector('[data-ai3d-action="generate-note"]')
      && view?.querySelector('[data-ai3d-action="open-index"]')
      && !view?.querySelector('[data-ai3d-action="set-explode"]');
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  // On a brand-new verification vault Obsidian may defer its community-plugin
  // trust prompt until after the direct workbench has rendered.
  await trustVaultIfPrompted(page);
  const workspaceComfort = await verifyDirectWorkspaceComfort(page);
  if (process.argv.includes("--capture-note-ui")) {
    const output = join(rootDir, ".tmp", "note-ui-showcase");
    await mkdir(output, { recursive: true });
    await page.locator('.ai3d-direct-view:visible').last().screenshot({ path: join(output, "direct-workbench.png") });
  }
  const knowledgeUx = await verifyDirectWorkbenchKnowledgeUx(page);

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

  // Ensure canvas changes by toggling wireframe, since focus/disassembly/annotation
  // may not alter the rendered pixels for this model.
  await page.locator('.ai3d-direct-view [data-ai3d-action="toggle-wireframe"]').click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const canvas = document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Direct workbench canvas missing");
    }
    return canvas.toDataURL("image/png");
  });

  await page.evaluate(async (modelPath) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(modelPath);
    if (!file) {
      throw new Error(`Missing workbench model: ${modelPath}`);
    }
    await window.__ai3dVerifyOpenFile(file);
  }, workbenchModelVaultPath);
  await page.waitForFunction(() => {
    return document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas")
      && document.querySelector(".ai3d-direct-view .ai3d-helper-toolbar");
  }, null, { timeout: 20_000 });
  await page.locator('.ai3d-direct-view [data-ai3d-action="generate-note"]:visible').last().click();
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
  assert(noteText.includes("## Knowledge Index"), "Generated knowledge note is missing knowledge index section");
  assert(noteText.includes("## Part Candidates"), "Generated knowledge note is missing part candidates section");
  assert(noteText.includes("## Knowledge Nodes"), "Generated knowledge note is missing knowledge nodes section");
  assert(noteText.includes("## Annotation Links"), "Generated knowledge note is missing annotation links section");
  assert(noteText.includes("## Suggested Part Notes"), "Generated knowledge note is missing suggested part notes section");
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
  assert(analysis?.partNotePaths?.length > 0, "Generated analysis sidecar is missing generated part note paths");
  assert(typeof analysis?.knowledgeIndexPath === "string", "Generated analysis sidecar is missing knowledge index path");
  assert(analysis?.annotationLinks?.length > 0, "Generated analysis sidecar is missing annotation links");
  assert(analysis?.draftingInput?.partCandidates?.length > 0, "Generated analysis sidecar is missing drafting input part candidates");
  assert(analysis.draftingInput.partCandidates.some((part) => typeof part.notePath === "string"), "Drafting input part candidates should include generated note paths");
  assert(analysis?.draftingInput?.annotationLinks?.length > 0, "Generated analysis sidecar is missing drafting input annotation links");
  assert(analysis?.localDraft?.sections?.length > 0, "Generated analysis sidecar is missing local draft sections");
  assert(analysis?.localDraft?.nextActions?.length > 0, "Generated analysis sidecar is missing local draft next actions");
  assert(analysis.draftingInput.evidence.rawModelIncluded === false, "Drafting input should not include raw model data");
  assert(analysis.pipeline?.some((stage) => stage.stage === "draft" && stage.status === "success"), "Local analysis should record successful draft stage");
  assert(analysis.pipeline?.some((stage) => stage.stage === "partNotes" && stage.status === "success"), "Local analysis should record successful part note stage");
  assert(analysis.pipeline?.some((stage) => stage.stage === "index" && stage.status === "success"), "Local analysis should record successful index stage");
  assert(analysis.pipeline?.some((stage) => stage.stage === "remoteDraft" && stage.status === "skipped"), "Local analysis should record skipped remote draft stage");
  for (const imagePath of analysis.previewImages) {
    const imageExists = await page.evaluate((path) => !!window.app?.vault?.getAbstractFileByPath?.(path), imagePath);
    assert(imageExists, `Generated evidence image is missing: ${imagePath}`);
  }
  for (const partNotePath of analysis.partNotePaths) {
    const partNoteText = await page.evaluate(async (path) => {
      const file = window.app?.vault?.getAbstractFileByPath?.(path);
      return file ? window.app.vault.read(file) : null;
    }, partNotePath);
    assert(partNoteText, `Generated part note is missing: ${partNotePath}`);
    assert(partNoteText.includes("## Evidence"), `Generated part note is missing evidence section: ${partNotePath}`);
    assert(partNoteText.includes("Parent report"), `Generated part note is missing parent report link: ${partNotePath}`);
  }
  const knowledgeIndexText = await page.evaluate(async (path) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(path);
    return file ? window.app.vault.read(file) : null;
  }, analysis.knowledgeIndexPath);
  assert(knowledgeIndexText, `Generated knowledge index is missing: ${analysis.knowledgeIndexPath}`);
  assert(knowledgeIndexText.includes("## Entry Points"), "Generated knowledge index is missing entry points");
  assert(knowledgeIndexText.includes("## Part Notes"), "Generated knowledge index is missing part notes");
  assert(knowledgeIndexText.includes("<!-- AI3D_INDEX_START -->"), "Generated knowledge index is missing managed start marker");
  assert(knowledgeIndexText.includes("<!-- AI3D_INDEX_END -->"), "Generated knowledge index is missing managed end marker");

  const preservedLine = "- User preserved index note";
  await page.evaluate(async ({ path, line }) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(path);
    if (!file) {
      throw new Error(`Missing generated index for preservation check: ${path}`);
    }
    const content = await window.app.vault.read(file);
    const edited = content.replace(
      /## User Notes\r?\n\r?\n-\s*(?=\r?\n)/,
      `## User Notes\n\n${line}\n- `,
    );
    if (edited === content) {
      throw new Error("Generated index did not contain the expected user-notes placeholder");
    }
    await window.app.vault.modify(file, edited);
  }, { path: analysis.knowledgeIndexPath, line: preservedLine });

  await page.evaluate(async (modelPath) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(modelPath);
    if (!file) {
      throw new Error(`Missing workbench model: ${modelPath}`);
    }
    await window.__ai3dVerifyOpenFile(file);
  }, workbenchModelVaultPath);
  await page.waitForFunction(() => {
    return document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas")
      && document.querySelector(".ai3d-direct-view .ai3d-helper-toolbar");
  }, null, { timeout: 20_000 });
  await page.locator('.ai3d-direct-view [data-ai3d-action="generate-note"]:visible').last().click();
  await page.waitForFunction(() => {
    return window.app?.workspace?.getActiveFile?.()?.path === "Analysis/3D Reports/rubiks-cube-3x3 Report.md";
  }, null, { timeout: 10_000 });
  const regeneratedIndexText = await page.evaluate(async (path) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(path);
    return file ? window.app.vault.read(file) : null;
  }, analysis.knowledgeIndexPath);
  assert(regeneratedIndexText?.includes(preservedLine), "Regenerated knowledge index did not preserve user notes");
  assert(regeneratedIndexText.includes("<!-- AI3D_INDEX_START -->"), "Regenerated knowledge index lost managed start marker");
  assert(regeneratedIndexText.includes("## Part Notes"), "Regenerated knowledge index lost managed part notes section");

  await page.evaluate(async (modelPath) => {
    const file = window.app?.vault?.getAbstractFileByPath?.(modelPath);
    if (!file) {
      throw new Error(`Missing workbench model: ${modelPath}`);
    }
    await window.__ai3dVerifyOpenFile(file);
  }, workbenchModelVaultPath);
  await page.waitForFunction(() => {
    return document.querySelector(".ai3d-direct-view .ai3d-preview-host canvas")
      && document.querySelector(".ai3d-direct-view .ai3d-helper-toolbar");
  }, null, { timeout: 20_000 });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('.ai3d-direct-view [data-ai3d-action="open-index"]'))
      .some((button) => button instanceof HTMLButtonElement
        && !button.disabled
        && button.offsetParent !== null);
  }, null, { timeout: 10_000 });
  const knowledgeRecovery = await verifyKnowledgeOpenRecovery(page, analysis.knowledgeIndexPath);
  await page.locator('.ai3d-direct-view [data-ai3d-action="open-index"]:visible').last().click();
  await page.waitForFunction((expectedPath) => {
    return window.app?.workspace?.getActiveFile?.()?.path === expectedPath;
  }, analysis.knowledgeIndexPath, { timeout: 10_000 });

  const diagnosticsReport = await page.evaluate(async ({ modelPath, secretUrl }) => {
    const plugin = window.app?.plugins?.plugins?.["ai-model-workbench"];
    const store = plugin?.ps?.store;
    const state = store?.getState?.();
    if (!store || !state) {
      throw new Error("AI Model Workbench store was unavailable for diagnostics");
    }
    if (!window.app?.commands?.commands?.["ai-model-workbench:copy-diagnostics-report"]) {
      throw new Error("Diagnostics command is not registered");
    }

    const originalSettings = state.settings;
    store.setState({
      settings: {
        ...originalSettings,
        analysisMode: "hybrid",
        serviceBaseUrl: secretUrl,
        freecadCommand: "/private/freecad",
        obj2gltfCommand: "/private/obj2gltf",
        fbx2gltfCommand: "/private/fbx2gltf",
        assimpCommand: "/private/python",
        freecadcmdCommand: "/private/freecadcmd",
      },
      currentModelPath: modelPath,
    });

    const clipboard = navigator.clipboard;
    const writes = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
    const originalWriteText = clipboard.writeText.bind(clipboard);
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      value: async (text) => {
        writes.push(String(text));
      },
    });

    try {
      window.app.commands.executeCommandById("ai-model-workbench:copy-diagnostics-report");
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && writes.length === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (writes.length > 0) {
        return writes.at(-1) ?? "";
      }
      return await clipboard.readText().catch(() => "");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(clipboard, "writeText", originalDescriptor);
      } else {
        Object.defineProperty(clipboard, "writeText", {
          configurable: true,
          value: originalWriteText,
        });
      }
      store.setState({ settings: originalSettings });
    }
  }, {
    modelPath: workbenchModelVaultPath,
    secretUrl: "https://diagnostics.example.invalid/draft?token=placeholder",
  });
  assert(diagnosticsReport.includes("# AI Model Workbench Diagnostics"), "Diagnostics report title missing");
  assert(diagnosticsReport.includes("Knowledge index: set"), "Diagnostics report is missing knowledge index status");
  assert(diagnosticsReport.includes("Knowledge index: set (<redacted .md>)"), "Diagnostics report is missing redacted index status");
  assert(!diagnosticsReport.includes(analysis.knowledgeIndexPath), "Diagnostics report leaked generated index path");
  assert(!diagnosticsReport.includes(workbenchModelVaultPath), "Diagnostics report leaked current model path");
  assert(diagnosticsReport.includes("Last generation: success"), "Diagnostics report is missing last generation state");
  assert(diagnosticsReport.includes("service configured"), "Diagnostics report is missing remote service configured status");
  assert(!diagnosticsReport.includes("diagnostics.example.invalid"), "Diagnostics report leaked draft service host");
  assert(!diagnosticsReport.includes("token=placeholder"), "Diagnostics report leaked draft service token");
  assert(!diagnosticsReport.includes("/private/"), "Diagnostics report leaked converter command path");

  const fallbackIndexPath = await page.evaluate(async ({ modelPath, expectedPath }) => {
    const plugin = window.app?.plugins?.plugins?.["ai-model-workbench"];
    const store = plugin?.ps?.store;
    if (!store || !window.app?.commands?.commands?.["ai-model-workbench:open-knowledge-index"]) {
      throw new Error("AI Model Workbench open index command was unavailable");
    }
    const state = store.getState();
    store.setState({
      currentModelPath: null,
      lastKnowledgeGeneration: {
        modelPath,
        reportNotePath: "Analysis/3D Reports/rubiks-cube-3x3 Report.md",
        analysisSidecarPath: "Analysis/3D Reports/rubiks-cube-3x3 Analysis.json",
        knowledgeIndexPath: expectedPath,
        partNoteCount: 1,
        previewImageCount: 1,
        generatedAt: new Date().toISOString(),
        status: "success",
        warningCount: 0,
      },
    });
    try {
      window.app.commands.executeCommandById("ai-model-workbench:open-knowledge-index");
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const activePath = window.app?.workspace?.getActiveFile?.()?.path;
        if (activePath === expectedPath) {
          return activePath;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      return window.app?.workspace?.getActiveFile?.()?.path ?? null;
    } finally {
      store.setState({
        currentModelPath: modelPath,
        lastKnowledgeGeneration: state.lastKnowledgeGeneration,
      });
    }
  }, {
    modelPath: workbenchModelVaultPath,
    expectedPath: analysis.knowledgeIndexPath,
  });
  assert(fallbackIndexPath === analysis.knowledgeIndexPath, `Open knowledge index fallback failed: ${fallbackIndexPath}`);

  const directViewResult = await page.evaluate(({ beforeDataUrl, afterDataUrl, analysisPartCount }) => {
    const host = document.querySelector(".ai3d-direct-view .ai3d-preview-host");
    const panel = document.querySelector(".ai3d-direct-workbench-panel");
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
      hasKnowledgeAction: actions.includes("generate-note"),
      hasOpenIndexAction: actions.includes("open-index"),
      hasDiagnosticsCommand: !!window.app?.commands?.commands?.["ai-model-workbench:copy-diagnostics-report"],
      canvasChangedAfterControls: beforeDataUrl !== afterDataUrl,
      activeFile: window.app?.workspace?.getActiveFile?.()?.path ?? null,
      analysisPartCount,
    };
  }, { beforeDataUrl: before, afterDataUrl: after, analysisPartCount: analysis.parts.length });
  assert(directViewResult.hasPanel, "Direct workbench panel did not render");
  assert(!directViewResult.hasExplodeControl, "Direct workbench panel still exposes explode control");
  assert(directViewResult.hasKnowledgeAction, "Direct workbench panel is missing knowledge action");
  assert(directViewResult.hasOpenIndexAction, "Direct workbench panel is missing open index action");
  assert(directViewResult.hasDiagnosticsCommand, "Diagnostics command is missing");
  assert(directViewResult.activeFile === analysis.knowledgeIndexPath, `Open index action did not activate the index: ${directViewResult.activeFile}`);
  assert(directViewResult.canvasChangedAfterControls, "Direct workbench controls did not change the rendered canvas");
  return { ...directViewResult, knowledgeUx, workspaceComfort, knowledgeRecovery };
}

async function verifyNoteUi(page) {
  const notePath = "Note UI Verification.md";
  const content = ["# 模型检查笔记", "", "在正文中查看模型，按需展开高级操作。", "", "```3d", '{"models":[{"path":"models/rubiks-cube-3x3.glb"}],"height":300,"width":720}', "```", "", "## 编辑视图的内嵌模型", "", "![[models/rubiks-cube-3x3.glb|640x300]]", ""].join("\n");
  await page.evaluate(async ({ path, content }) => {
    const plugin = window.app.plugins.plugins["ai-model-workbench"];
    plugin.ps.updateModelProfile("models/rubiks-cube-3x3.glb", existing => ({
      annotations: [...(existing.annotations ?? []), { id: "note-ui-pin", position: [1.4, 1.4, 1.4], label: "检查点", color: "#7056d9", createdAt: new Date().toISOString() }],
    }));
    const file = await window.app.vault.create(path, content);
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    await leaf.setViewState({ type: "markdown", state: { file: path, mode: "preview" } });
    window.__ai3dNoteUiLeaf = leaf;
  }, { path: notePath, content });
  await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-note-preview [data-ai3d-action="toggle-annotation"]')].some(el => el.getBoundingClientRect().width > 0), null, { timeout: 20_000 });
  const frame = page.locator('.markdown-preview-view .ai3d-note-preview:visible').first();
  await frame.scrollIntoViewIfNeeded();
  const toolbar = frame.locator('.ai3d-note-toolbar');
  const pins = toolbar.locator('[data-ai3d-action="toggle-annotation"]');
  await pins.waitFor({ state: "visible", timeout: 20_000 });
  assert(await pins.getAttribute("aria-pressed") === "true", "Reading preview did not announce visible pins");
  await toolbar.locator('[data-ai3d-action="toggle-focus"]').click();
  await pins.click();
  assert(await toolbar.getAttribute("data-ai3d-interaction-mode") === "focus", "Reading pin visibility interrupted focus");
  await pins.click();
  await toolbar.locator('[data-ai3d-action="exit-interaction"]').click();
  await toolbar.locator('.ai3d-mobile-more-toggle').click();
  const widths = await frame.evaluate(async el => {
    const previous = el.style.maxWidth;
    const rows = [];
    for (const width of [320, 360, 480, 720]) {
      el.style.maxWidth = `${width}px`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      rows.push({ width, client: el.clientWidth, scroll: el.scrollWidth });
    }
    el.style.maxWidth = previous;
    return rows;
  });
  for (const row of widths) assert(row.scroll <= row.client + 1, `Reading note frame overflowed: ${JSON.stringify(row)}`);
  if (process.argv.includes("--capture-note-ui")) {
    const output = join(rootDir, ".tmp", "note-ui-showcase");
    await mkdir(output, { recursive: true });
    await toolbar.locator('.ai3d-mobile-more-toggle').click();
    await frame.screenshot({ path: join(output, "obsidian-reading.png") });
  }
  await page.evaluate(async path => {
    await window.__ai3dNoteUiLeaf.setViewState({ type: "markdown", state: { file: path, mode: "source", source: false } });
    const editor = window.__ai3dNoteUiLeaf.view.editor;
    const end = { line: editor.lastLine(), ch: 0 };
    editor.setCursor(end);
    editor.scrollIntoView({ from: end, to: end }, true);
  }, notePath);
  await page.waitForFunction(() => !!document.querySelector('.ai3d-embed-preview, .ai3d-embed-preview-lazy'), null, { timeout: 10_000 });
  await page.evaluate(() => document.querySelector('.ai3d-embed-preview, .ai3d-embed-preview-lazy')?.scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-cm-widget [data-ai3d-action="expand-preview"]')].some(el => !el.disabled), null, { timeout: 20_000 }).catch(async error => {
    console.log(JSON.stringify(await page.evaluate(() => ({
      view: window.__ai3dNoteUiLeaf.getViewState(),
      editorState: (() => {
        const obsidian = window.require("obsidian");
        const state = window.__ai3dNoteUiLeaf.view.editor.cm?.state;
        return { live: state?.field(obsidian.editorLivePreviewField, false), fields: state?.config?.fields?.length };
      })(),
      source: [...document.querySelectorAll('.markdown-source-view')].map(el => ({ display: getComputedStyle(el).display, text: el.innerText.slice(-600), html: el.querySelector('.cm-content')?.innerHTML.slice(-2500) })),
      widgets: [...document.querySelectorAll('.ai3d-cm-widget')].map(el => ({ className: el.className, text: el.innerText.slice(0, 80), width: el.clientWidth, height: el.clientHeight, connected: el.isConnected, parent: el.parentElement?.outerHTML.slice(0, 500) })),
    })), null, 2));
    await page.screenshot({ path: join(rootDir, '.tmp', 'native-note-failure.png') });
    throw error;
  });
  const compact = page.locator('.ai3d-cm-widget.ai3d-note-preview:visible').first();
  await compact.scrollIntoViewIfNeeded();
  await compact.hover();
  await compact.locator('[data-ai3d-action="expand-preview"]').click();
  const live = page.locator('.ai3d-image-viewer-modal .ai3d-note-preview');
  const mountedContent = await page.evaluate(() => window.__ai3dNoteUiLeaf.view.editor.getValue());
  assert(mountedContent === content, "Mounting Live Preview changed the editor document");
  await live.locator('.ai3d-mobile-more-toggle').click();
  assert(await live.locator('[data-ai3d-action="remove-preview"]:visible').count() === 0, "Live Preview exposed a remove action without a handler");
  assert(await live.locator('.ai3d-inline-btn.is-hidden:visible').count() === 0, "More exposed unavailable capabilities in Live Preview");
  await live.locator('[data-ai3d-action="toggle-annotation"]').click();
  await live.locator('[data-ai3d-action="toggle-measurement"]').click();
  assert(await live.locator('.ai3d-note-toolbar').getAttribute("data-ai3d-interaction-mode") === "measurement", "Live Preview toolbar did not activate measurement");
  await live.locator('[data-ai3d-action="exit-interaction"]').click();
  if (process.argv.includes("--capture-note-ui")) {
    await live.screenshot({ path: join(rootDir, ".tmp", "note-ui-showcase", "obsidian-live-preview.png") });
  }
  await page.locator('.ai3d-image-viewer-modal [data-ai3d-action="return-to-note"]').click();
  const editorContent = await page.evaluate(() => window.__ai3dNoteUiLeaf.view.editor.getValue());
  assert(editorContent === content, "Live Preview UI interactions changed the editor document");
  const after = await page.evaluate(async path => window.app.vault.read(window.app.vault.getAbstractFileByPath(path)), notePath);
  assert(after === content, "Live Preview UI interactions changed the Markdown document");
  await page.evaluate(() => { delete window.__ai3dNoteUiLeaf; });
  return { readingPinsIndependent: true, widths, livePreviewToolbar: true, unavailableActionsHidden: true, markdownUnchanged: true };
}

async function verifyImageEmbeds(page) {
  if (process.argv.includes("--image-embeds-babylon")) {
    await page.evaluate(() => {
      const ps = window.app.plugins.plugins["ai-model-workbench"].ps;
      const settings = ps.store.getState().settings;
      window.__ai3dImageSavedSettings = { useThreeRenderer: settings.useThreeRenderer, previewRendererRollout: settings.previewRendererRollout };
      ps.updateSettings({ useThreeRenderer: false, previewRendererRollout: "babylon-safe" });
    });
  }
  const path = "Image Embed Verification.md";
  const content = [
    "# 像图片一样嵌入模型", "",
    "正文前 ![[models/rubiks-cube-3x3.glb|220x160]] 正文后", "",
    "- 列表项 ![[models/rubiks-cube-3x3.glb|180x120]]", "",
    "> 引用区 ![[models/rubiks-cube-3x3.glb|200x140]]", "",
    "| 位置 | 模型 |", "| --- | --- |", "| 表格单元格 | ![[models/rubiks-cube-3x3.glb\\|160x100]] |", "",
    "语法示例：`![[models/rubiks-cube-3x3.glb|99x99]]`", "",
    "```md", "![[models/rubiks-cube-3x3.glb|88x88]]", "```", "",
  ].join("\n");
  await page.evaluate(async ({ path, content }) => {
    const file = await window.app.vault.create(path, content);
    const leaf = window.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    await leaf.setViewState({ type: "markdown", state: { file: path, mode: "preview" } });
    window.__ai3dImageLeaf = leaf;
  }, { path, content });
  const reading = page.locator('.markdown-preview-view:visible').last();
  await page.waitForFunction(() => document.querySelectorAll('.markdown-preview-view .ai3d-image-embed').length >= 4, null, { timeout: 15_000 }).catch(async error => {
    console.log(JSON.stringify(await reading.locator('.internal-embed, .ai3d-image-embed').evaluateAll(elements => elements.map(el => ({ html: el.outerHTML.slice(0, 800) }))), null, 2));
    throw error;
  });
  const embeds = reading.locator('.ai3d-image-embed');
  assert(await embeds.count() === 4, "Reading view rendered a code example or lost an image embed");
  const layouts = await embeds.evaluateAll(elements => elements.map(el => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    list: !!el.closest("li"), quote: !!el.closest("blockquote"), table: !!el.closest("td"),
    display: getComputedStyle(el).display,
    scroll: el.scrollWidth, client: el.clientWidth,
  })));
  for (const [index, width] of [220, 180, 200, 160].entries()) {
    assert(Math.abs(layouts[index].width - width) <= 2, `Reading image width was ignored: ${JSON.stringify(layouts[index])}`);
    assert(layouts[index].display === "inline-block", "Reading embed broke inline text flow");
    assert(layouts[index].scroll <= layouts[index].client + 1, "Reading image embed overflowed");
    assert(Math.abs(layouts[index].height - [160, 120, 140, 100][index]) <= 4, `Reading image height was ignored: ${JSON.stringify(layouts[index])}`);
  }
  assert(layouts[1].list && layouts[2].quote && layouts[3].table, `Embeds escaped their Markdown parents: ${JSON.stringify(layouts)}`);
  for (let index = 0; index < 4; index++) {
    await embeds.nth(index).scrollIntoViewIfNeeded();
    await page.waitForFunction(index => {
      const embed = document.querySelectorAll('.markdown-preview-view .ai3d-image-embed')[index];
      const canvas = embed?.querySelector('canvas');
      const loading = embed?.querySelector('.ai3d-loading-overlay');
      return canvas?.width > 0 && (!loading || loading.classList.contains('is-hidden'));
    }, index, { timeout: 20_000 });
  }
  const small = embeds.nth(3);
  await small.hover();
  const actions = small.locator('.ai3d-image-actions');
  assert(await actions.locator('button:visible').count() === 3, "Thumbnail controls should expose reset, expand and parts");
  assert((await actions.boundingBox()).height <= 44, "Thumbnail controls cover too much of the model");
  assert(await small.locator('.ai3d-note-toolbar:visible').count() === 0, "Full inspection tools obscure the thumbnail");
  await small.evaluate(el => { window.__ai3dImageCanvas = el.querySelector('canvas'); });
  const sizeBefore = await small.boundingBox();
  if (process.argv.includes("--capture-note-ui")) {
    await small.locator('xpath=ancestor::table').screenshot({ path: join(rootDir, ".tmp", "note-ui-showcase", "image-embed-hover.png") });
  }
  await small.locator('[data-ai3d-action="expand-preview"]').click();
  const dialog = page.locator('.ai3d-image-viewer-modal');
  await dialog.waitFor({ state: "visible" });
  assert(await dialog.locator('canvas').evaluate(el => el === window.__ai3dImageCanvas), "Expanding replaced or reloaded the renderer canvas");
  const sizeDuring = await small.boundingBox();
  assert(Math.abs(sizeBefore.height - sizeDuring.height) < 1 && Math.abs(sizeBefore.width - sizeDuring.width) < 1, "Opening the viewer shifted the note layout");
  const modalWidths = await dialog.evaluate(async el => {
    const before = el.style.width;
    const rows = [];
    for (const width of [320, 480, 800]) {
      el.style.width = `${width}px`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      rows.push({ width, client: el.clientWidth, scroll: el.scrollWidth });
    }
    el.style.width = before;
    return rows;
  });
  assert(modalWidths.every(row => row.scroll <= row.client + 1), `Expanded viewer overflows narrow panes: ${JSON.stringify(modalWidths)}`);
  await dialog.locator('[data-ai3d-action="toggle-focus"]').click();
  await dialog.locator('canvas').focus();
  await page.keyboard.press("Escape");
  assert(await dialog.count() === 1, "Escape closed the viewer before leaving its active tool");
  assert(await dialog.locator('.ai3d-note-toolbar').getAttribute('data-ai3d-interaction-mode') === 'idle', "Escape did not leave focus mode");
  if (process.argv.includes("--capture-note-ui")) {
    await dialog.locator('.ai3d-mobile-more-toggle').click();
    await dialog.screenshot({ path: join(rootDir, ".tmp", "note-ui-showcase", "image-embed-expanded.png") });
    await dialog.locator('.ai3d-mobile-more-toggle').click();
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(await small.locator('canvas').evaluate(el => el === window.__ai3dImageCanvas), "Closing lost the original preview");
  assert(await small.locator('[data-ai3d-action="expand-preview"]').evaluate(el => el === document.activeElement), "Closing did not restore keyboard focus");
  assert(Math.abs((await small.boundingBox()).height - sizeBefore.height) < 1, "Closing changed the thumbnail size");
  // A tool shortcut opens its inspector first instead of activating an invisible mode.
  await small.locator('canvas').focus();
  await page.keyboard.press("m");
  await dialog.waitFor({ state: "visible" });
  assert(await dialog.locator('.ai3d-note-toolbar').getAttribute('data-ai3d-interaction-mode') === 'measurement', "Keyboard measurement did not open its inspection context");
  await dialog.locator('[data-ai3d-action="return-to-note"]').click();
  assert(await small.locator('.ai3d-note-toolbar').getAttribute('data-ai3d-interaction-mode') === 'idle', "Closing retained an invisible interaction mode");
  if (process.argv.includes("--capture-note-ui")) {
    await page.mouse.move(20, 20);
    for (const [index, name] of ["paragraph", "list", "quote", "table"].entries()) {
      const parent = await embeds.nth(index).evaluateHandle((el, selector) => el.closest(selector), ["p", "li", "blockquote", "table"][index]);
      const element = parent.asElement();
      assert(element, "Image embed lost its note parent before capture");
      await element.screenshot({ path: join(rootDir, ".tmp", "note-ui-showcase", `image-embed-${name}.png`) });
      await parent.dispose();
    }
  }
  await page.evaluate(async path => {
    await window.__ai3dImageLeaf.setViewState({ type: "markdown", state: { file: path, mode: "source", source: false } });
    const editor = window.__ai3dImageLeaf.view.editor;
    editor.setCursor({ line: 0, ch: 0 });
    editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: editor.lastLine(), ch: 0 } }, true);
  }, path);
  await page.waitForFunction(() => document.querySelectorAll('.markdown-source-view .ai3d-image-embed').length >= 4, null, { timeout: 15_000 });
  const liveContent = await page.evaluate(() => window.__ai3dImageLeaf.view.editor.getValue());
  assert(liveContent === content, "Inline embeds changed the Markdown document");
  const liveLayouts = await page.locator('.markdown-source-view:visible .ai3d-image-embed').evaluateAll(elements => elements.map(el => ({
    width: el.getBoundingClientRect().width, display: getComputedStyle(el).display,
    inLine: !!el.closest('.cm-line'), inTable: !!el.closest('td'),
  })));
  assert(liveLayouts.every(el => el.display === "inline-block"), `Live widgets became block decorations: ${JSON.stringify(liveLayouts)}`);
  assert(liveLayouts.length === 4, "Live Preview rendered code examples or duplicated embeds");
  const liveEmbed = page.locator('.markdown-source-view:visible .ai3d-image-embed').first();
  await page.evaluate(() => {
    const editor = window.__ai3dImageLeaf.view.editor;
    editor.setCursor({ line: 2, ch: 0 });
    editor.scrollIntoView({ from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } }, true);
  });
  await liveEmbed.scrollIntoViewIfNeeded();
  await liveEmbed.locator('canvas').waitFor({ state: "visible", timeout: 20_000 }).catch(async error => {
    console.log('live image state', await page.locator('.markdown-source-view .ai3d-image-embed').evaluateAll(elements => elements.map(el => ({ html: el.outerHTML.slice(0, 1600), rect: el.getBoundingClientRect().toJSON(), parent: el.parentElement.outerHTML.slice(0, 400) }))));
    await page.screenshot({ path: join(rootDir, '.tmp', 'image-live-failure.png') });
    throw error;
  });
  await page.waitForFunction(() => !document.querySelector('.markdown-source-view .ai3d-image-embed [data-ai3d-action="expand-preview"]')?.disabled, null, { timeout: 20_000 });
  await liveEmbed.locator('canvas').focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "visible" });
  assert(await page.evaluate(() => window.__ai3dImageLeaf.view.editor.getValue()) === content, "Moving the Live Preview into a dialog changed Markdown");
  await page.evaluate(async path => {
    await window.__ai3dImageLeaf.setViewState({ type: "markdown", state: { file: path, mode: "source", source: true } });
  }, path);
  await page.waitForFunction(() => !document.querySelector('.markdown-source-view .ai3d-cm-widget.ai3d-image-embed'), null, { timeout: 10_000 });
  await dialog.waitFor({ state: "hidden" });
  const sourceContent = await page.evaluate(() => window.__ai3dImageLeaf.view.editor.getValue());
  assert(sourceContent === content, "Source mode did not preserve editable image syntax");
  await page.evaluate(() => {
    if (window.__ai3dImageSavedSettings) {
      window.app.plugins.plugins["ai-model-workbench"].ps.updateSettings(window.__ai3dImageSavedSettings);
      delete window.__ai3dImageSavedSettings;
    }
    delete window.__ai3dImageLeaf;
    delete window.__ai3dImageCanvas;
  });
  return { layouts, liveLayouts, modalWidths, compactControls: true, sameCanvasRestored: true, keyboardInspection: true, dialogDisposedOnSourceSwitch: true, codeExamplesUntouched: true, markdownUnchanged: true, sourceModeEditable: true };
}

async function verifyKnowledgeOpenRecovery(page, indexPath) {
  await page.evaluate(() => {
    const workspace = window.app.workspace;
    const original = workspace.getLeaf;
    window.__ai3dRestoreKnowledgeOpen = () => { workspace.getLeaf = original; };
    workspace.getLeaf = () => ({ openFile: async () => { throw new Error("Verification note open failure"); } });
  });
  try {
    await page.locator('.ai3d-direct-view [data-ai3d-action="open-index"]:visible').last().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-direct-workbench-open-error')].some(el =>
      el.getBoundingClientRect().width > 0 && el.textContent.includes("Verification note open failure")), null, { timeout: 5_000 });
    const state = await page.evaluate(() => ({
      generation: window.app.plugins.plugins["ai-model-workbench"].ps.store.getState().lastKnowledgeGeneration.status,
      knowledge: [...document.querySelectorAll('.ai3d-direct-workbench-knowledge')].find(el => el.getBoundingClientRect().width > 0)?.dataset.ai3dKnowledgeStatus,
    }));
    assert(state.generation === "success" && state.knowledge === "ready", `Opening a saved note corrupted generation status: ${JSON.stringify(state)}`);
  } finally {
    await page.evaluate(() => {
      window.__ai3dRestoreKnowledgeOpen();
      delete window.__ai3dRestoreKnowledgeOpen;
    });
  }
  const content = await page.evaluate(async path => {
    const file = window.app.vault.getAbstractFileByPath(path);
    const text = await window.app.vault.read(file);
    await window.app.vault.delete(file);
    return text;
  }, indexPath);
  assert(await page.locator('.ai3d-direct-view [data-ai3d-action="open-index"]:visible').last().isDisabled(), "Missing saved index still has an enabled open action");
  await page.evaluate(async ({ path, content }) => { await window.app.vault.create(path, content); }, { path: indexPath, content });
  await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-direct-view [data-ai3d-action="open-index"]')].some(el =>
    el.getBoundingClientRect().width > 0 && !el.disabled));
  const movedPath = `${indexPath}.verification-moved.md`;
  try {
    await page.evaluate(async ({ path, movedPath }) => {
      const file = window.app.vault.getAbstractFileByPath(path);
      await window.app.vault.rename(file, movedPath);
    }, { path: indexPath, movedPath });
    assert(await page.locator('.ai3d-direct-view [data-ai3d-action="open-index"]:visible').last().isDisabled(), "Moving an index left its old open action enabled");
  } finally {
    await page.evaluate(async ({ path, movedPath }) => {
      const file = window.app.vault.getAbstractFileByPath(movedPath);
      if (file) await window.app.vault.rename(file, path);
    }, { path: indexPath, movedPath });
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-direct-view [data-ai3d-action="open-index"]')].some(el =>
    el.getBoundingClientRect().width > 0 && !el.disabled));
  return { inlineOpenError: true, successPreserved: true, missingIndexDisabled: true, restoredIndexEnabled: true, renamedIndexRestored: true };
}

async function verifyDirectWorkspaceComfort(page) {
  const toggle = page.locator('.ai3d-direct-view [data-ai3d-action="toggle-knowledge-sidebar"]:visible').last();
  const before = await page.locator('.ai3d-direct-view .ai3d-preview-host:visible').last().boundingBox();
  await toggle.click();
  assert(await toggle.getAttribute("aria-expanded") === "false", "Sidebar toggle did not collapse");
  const expanded = await page.locator('.ai3d-direct-view .ai3d-preview-host:visible').last().boundingBox();
  assert(expanded.width > before.width + 100, "Collapsing sidebar did not expand model viewport");
  await toggle.click();
  assert(await toggle.getAttribute("aria-expanded") === "true", "Sidebar toggle did not restore");

  const handle = page.locator('.ai3d-direct-view .ai3d-resize-handle-h:visible').last();
  await handle.focus();
  await handle.press("ArrowLeft");
  assert(await handle.getAttribute("aria-valuenow") === "216", "Keyboard sidebar resize did not adjust width");
  await handle.press("Home");
  assert(await handle.getAttribute("aria-valuenow") === "200", "Keyboard resize did not restore minimum width");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragWidth = Number(await handle.getAttribute("aria-valuenow"));
  assert(dragWidth >= 279 && dragWidth <= 281, `Pointer sidebar resize failed: ${dragWidth}`);
  await handle.focus();
  await handle.press("Home");

  const annotate = page.locator('.ai3d-direct-view [data-ai3d-action="toggle-annotation"]:visible').last();
  await annotate.click();
  await page.locator('.ai3d-direct-view canvas:visible').last().focus();
  await page.keyboard.press("m");
  await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-helper-toolbar')].some(el => el.getBoundingClientRect().width > 0 && el.dataset.ai3dInteractionMode === "measurement"));
  assert(await annotate.getAttribute("aria-pressed") === "false", "Keyboard measurement left annotation active");
  await page.locator('.ai3d-direct-view [data-ai3d-action="exit-interaction"]:visible').last().click();
  const mode = await page.locator('.ai3d-direct-view .ai3d-helper-toolbar:visible').last().getAttribute("data-ai3d-interaction-mode");
  assert(mode === "idle", `Exit mode did not return to browsing: ${mode}`);
  return { sidebarToggle: true, keyboardResize: true, pointerResize: true, keyboardMeasurement: true, exitMode: true };
}

async function verifyDirectWorkbenchKnowledgeUx(page) {
  const result = await page.evaluate(async () => {
    const root = [...document.querySelectorAll(".ai3d-direct-view")].find(el => el.getBoundingClientRect().width > 0);
    const workspace = root?.querySelector(".ai3d-workspace");
    const sidebar = root?.querySelector(".ai3d-sidebar-content");
    const diagnostics = root?.querySelector(".ai3d-direct-workbench-diagnostics");
    const labels = ["toggle-focus", "toggle-disassembly", "toggle-measurement", "toggle-annotation"].map(action =>
      root?.querySelector(`[data-ai3d-action="${action}"]`)?.textContent?.trim() ?? "");
    if (!workspace || !sidebar || !diagnostics) throw new Error("Knowledge-first layout missing");
    const originalWidth = workspace.style.width;
    const layouts = [];
    try {
      for (const width of [360, 480, 768]) {
        workspace.style.width = `${width}px`;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const track = root.querySelector(".ai3d-workspace-track-top");
        const handle = root.querySelector(".ai3d-resize-handle-h");
        const toggle = root.querySelector('[data-ai3d-action="toggle-knowledge-sidebar"]');
        toggle.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const collapsed = { columns: getComputedStyle(track).gridTemplateColumns,
          rows: getComputedStyle(track).gridTemplateRows,
          sidebarHidden: getComputedStyle(root.querySelector('.ai3d-workspace-sidebar')).display === 'none' };
        toggle.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        layouts.push({ width, measured: workspace.clientWidth, scroll: workspace.scrollWidth,
          collapsed,
          columns: getComputedStyle(track).gridTemplateColumns,
          handleHidden: getComputedStyle(handle).display === "none",
          contentOverlaps: root.querySelector(".ai3d-sidebar-body").getBoundingClientRect().bottom
            > root.querySelector(".ai3d-direct-workbench-panel").getBoundingClientRect().top + 1 });
      }
    } finally { workspace.style.width = originalWidth; }
    return { labels, knowledgeFirst: sidebar.firstElementChild?.classList.contains("ai3d-sidebar-body"),
      diagnosticsCollapsed: !diagnostics.open, layouts };
  });
  assert(result.labels.every(Boolean), `Missing visible tool labels: ${JSON.stringify(result.labels)}`);
  assert(result.knowledgeFirst, "Knowledge actions are not first in the sidebar");
  assert(result.diagnosticsCollapsed, "Renderer diagnostics should be collapsed initially");
  for (const layout of result.layouts) {
    assert(layout.scroll <= layout.measured + 1, `Narrow leaf overflow: ${JSON.stringify(layout)}`);
    assert(layout.handleHidden === (layout.width <= 640), `Wrong container layout: ${JSON.stringify(layout)}`);
    assert(!layout.contentOverlaps, `Sidebar statistics overlap knowledge actions: ${JSON.stringify(layout)}`);
    assert(layout.collapsed.sidebarHidden && layout.collapsed.columns.trim().split(/\s+/).length === 1
      && layout.collapsed.rows.trim().split(/\s+/).length === 1, `Collapsed sidebar left unused grid space: ${JSON.stringify(layout)}`);
  }

  await page.evaluate(() => {
    const vault = window.app.vault;
    const original = vault.create;
    window.__ai3dRestoreKnowledgeCreate = () => { vault.create = original; };
    vault.create = async function (path, ...args) {
      if (path.endsWith(" Analysis.json")) {
        await new Promise(resolve => { window.__ai3dReleaseKnowledgeFailure = resolve; });
        throw new Error("Verification write failure");
      }
      return original.call(this, path, ...args);
    };
  });
  try {
    await page.locator('.ai3d-direct-view [data-ai3d-action="generate-note"]:visible').last().click();
    await page.waitForFunction(() => typeof window.__ai3dReleaseKnowledgeFailure === "function", null, { timeout: 10_000 });
    const pending = await page.locator('.ai3d-direct-workbench-knowledge:visible').last().evaluate(el => ({
      status: el.dataset.ai3dKnowledgeStatus,
      busy: el.getAttribute("aria-busy"),
      disabled: el.querySelector('[data-ai3d-action="generate-note"]').disabled,
    }));
    assert(pending.status === "generating" && pending.busy === "true" && pending.disabled, `Generation progress missing: ${JSON.stringify(pending)}`);
    await page.evaluate(() => window.__ai3dReleaseKnowledgeFailure());
    await page.waitForFunction(() => [...document.querySelectorAll('.ai3d-direct-workbench-knowledge')].some(el =>
      el.getBoundingClientRect().width > 0 && el.dataset.ai3dKnowledgeStatus === "failed"
      && el.querySelector(".ai3d-direct-workbench-error")), null, { timeout: 10_000 });
    const retry = await page.locator('.ai3d-direct-view [data-ai3d-action="generate-note"]:visible').last().evaluate(el => ({ disabled: el.disabled, primary: el.classList.contains("is-primary") }));
    assert(!retry.disabled && retry.primary, `Failed generation cannot retry: ${JSON.stringify(retry)}`);
    result.progressAndFailureVerified = true;
  } finally {
    await page.evaluate(() => {
      window.__ai3dReleaseKnowledgeFailure?.();
      window.__ai3dRestoreKnowledgeCreate?.();
      delete window.__ai3dReleaseKnowledgeFailure;
      delete window.__ai3dRestoreKnowledgeCreate;
    });
  }
  return result;
}

if (shouldClean) {
  await cleanupVault();
}

try {
  await registerVault();
  await prepareVault();
  await openObsidian();
  await verifyPage();
} finally {
  if (shouldClean) {
    await cleanupVault();
  }
}
