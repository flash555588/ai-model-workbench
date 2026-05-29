import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(join(rootDir, "package-lock.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));
const versions = JSON.parse(await readFile(join(rootDir, "versions.json"), "utf8"));

assert(packageJson.version === manifest.version, `package.json version ${packageJson.version} does not match manifest ${manifest.version}`);
assert(packageLock.version === manifest.version, `package-lock version ${packageLock.version} does not match manifest ${manifest.version}`);
assert(packageLock.packages?.[""]?.version === manifest.version, `package-lock root package version does not match manifest ${manifest.version}`);
assert(versions[manifest.version] === manifest.minAppVersion, `versions.json missing ${manifest.version} -> ${manifest.minAppVersion}`);

const assets = [];
for (const file of releaseFiles) {
  const filePath = join(rootDir, file);
  const info = await stat(filePath);
  assert(info.isFile(), `${file} is not a file`);
  assert(info.size > 0, `${file} is empty`);
  assets.push({
    file,
    size: info.size,
    sha256: await sha256(filePath),
  });
}

const result = {
  version: manifest.version,
  minAppVersion: manifest.minAppVersion,
  assets,
};

if (process.argv.includes("--format") && process.argv[process.argv.indexOf("--format") + 1] === "markdown") {
  console.log(`# AI Model Workbench ${result.version}`);
  console.log("");
  console.log("Release assets are built from source by GitHub Actions and include only the Obsidian-supported files.");
  console.log("");
  console.log(`- Manifest version: \`${result.version}\``);
  console.log(`- Minimum Obsidian version: \`${result.minAppVersion}\``);
  console.log("");
  console.log("| Asset | Size | SHA-256 |");
  console.log("|-------|------|---------|");
  for (const asset of result.assets) {
    console.log(`| \`${asset.file}\` | ${asset.size.toLocaleString("en-US")} bytes | \`${asset.sha256}\` |`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
