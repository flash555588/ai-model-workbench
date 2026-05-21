import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(rootDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const pluginId = manifest.id;
const pluginFiles = ["main.js", "manifest.json", "styles.css"];

function parseVaultArgs(argv) {
  const vaults = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--vault" || arg === "-v") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--vault requires a path");
      }
      vaults.push(value);
      index++;
    }
  }
  return vaults;
}

function defaultVaults() {
  const localTestVault = join(rootDir, "_obsidian_test_vault");
  return existsSync(join(localTestVault, ".obsidian")) ? [localTestVault] : [];
}

function getObsidianDir(vaultPath) {
  const resolved = resolve(vaultPath);
  if (basename(resolved) === ".obsidian") {
    return resolved;
  }
  return join(resolved, ".obsidian");
}

async function enablePlugin(obsidianDir) {
  const enabledPath = join(obsidianDir, "community-plugins.json");
  let enabled = [];
  if (existsSync(enabledPath)) {
    enabled = JSON.parse(await readFile(enabledPath, "utf8"));
    if (!Array.isArray(enabled)) {
      enabled = [];
    }
  }
  if (!enabled.includes(pluginId)) {
    enabled.push(pluginId);
    await writeFile(enabledPath, `${JSON.stringify(enabled, null, 2)}\n`, "utf8");
  }
}

async function installToVault(vaultPath) {
  const obsidianDir = getObsidianDir(vaultPath);
  if (!existsSync(obsidianDir)) {
    throw new Error(`Not an Obsidian vault: ${vaultPath}`);
  }

  const targetDir = join(obsidianDir, "plugins", pluginId);
  await mkdir(targetDir, { recursive: true });
  for (const file of pluginFiles) {
    await copyFile(join(rootDir, file), join(targetDir, file));
  }
  await enablePlugin(obsidianDir);
  return targetDir;
}

const vaults = parseVaultArgs(process.argv.slice(2));
const targets = vaults.length > 0 ? vaults : defaultVaults();
if (targets.length === 0) {
  throw new Error("No vault path provided. Use --vault <path>.");
}

for (const vault of targets) {
  const targetDir = await installToVault(vault);
  console.log(`Installed ${pluginId} to ${targetDir}`);
}
