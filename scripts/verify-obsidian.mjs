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
    assert(result.canvases.length >= 2, `Expected at least 2 preview canvases, got ${result.canvases.length}`);
    const renderedCanvases = result.canvases.filter((canvas) => canvas.nonEmptyRatio > 0.05 && canvas.contrast > 20);
    assert(renderedCanvases.length >= 2, `Expected at least 2 rendered canvases, got ${renderedCanvases.length}`);
    for (const [index, canvas] of result.canvases.entries()) {
      assert(canvas.width > 0 && canvas.height > 0, `Canvas ${index} has invalid size`);
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
    await window.app.vault.modify(file, content.replace("## User Notes\n\n- ", `## User Notes\n\n${line}\n- `));
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
      return writes.at(-1) ?? "";
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
  assert(diagnosticsReport.includes(analysis.knowledgeIndexPath), "Diagnostics report is missing generated index path");
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
  return directViewResult;
}

await registerVault();
await prepareVault();
await openObsidian();
await verifyPage();

if (shouldClean) {
  await cleanupVault();
}
