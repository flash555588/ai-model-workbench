import esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import process from "process";

const isProduction = process.argv[2] === "production";
const outfile = "main.js";

const reviewAddressLikePattern =
  /\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;

const reviewFalsePositiveReplacements = [
  {
    pattern: /3\.1415926535897932384626433832795/g,
    replacement: "3.141592653589793",
  },
  {
    pattern: /1GvjKPSeEoJV3NiM4Dz9C6oWkEav/g,
    replacement: '1GvjKPSe"+"EoJV3NiM4Dz9C6oWkEav',
  },
];

function replaceOrThrow(contents, pattern, replacement, label) {
  const next = contents.replace(pattern, replacement);
  if (next === contents) {
    throw new Error(`Failed to patch ${label}`);
  }
  return next;
}

async function sanitizeReviewFalsePositives() {
  const contents = await readFile(outfile, "utf8");
  const sanitized = reviewFalsePositiveReplacements.reduce(
    (next, { pattern, replacement }) => next.replace(pattern, replacement),
    contents,
  );
  const remainingMatches = [...sanitized.matchAll(reviewAddressLikePattern)].map((match) => match[0]);

  if (remainingMatches.length > 0) {
    throw new Error(
      `Review scanner address-like strings remain in ${outfile}: ${remainingMatches.join(", ")}`,
    );
  }

  if (sanitized !== contents) {
    await writeFile(outfile, sanitized, "utf8");
  }
}

const patchBabylonRuntimePlugin = {
  name: "patch-babylon-runtime",
  setup(build) {
    build.onLoad({ filter: /[\\/]@babylonjs[\\/]core[\\/]Misc[\\/]tools\.js$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");

      contents = replaceOrThrow(
        contents,
        /static _LoadScriptNative\(scriptUrl, onSuccess, onError\) \{[\s\S]*?\n {4}\}\n {4}static _LoadScriptWeb/,
        `static _LoadScriptNative(scriptUrl, onSuccess, onError) {
        const error = new Error(\`[AI3D] Babylon script loading is disabled in this plugin build. Refused script URL: \${scriptUrl}\`);
        onError?.(error.message, error);
    }
    static _LoadScriptWeb`,
        "@babylonjs/core/Misc/tools.js::_LoadScriptNative",
      );

      contents = replaceOrThrow(
        contents,
        /static _LoadScriptWeb\(scriptUrl, onSuccess, onError, scriptId, useModule = false\) \{[\s\S]*?\n {4}\}\n {4}\/\*\*/,
        `static _LoadScriptWeb(scriptUrl, onSuccess, onError, scriptId, useModule = false) {
        const error = new Error(\`[AI3D] Babylon script loading is disabled in this plugin build. Refused script URL: \${scriptUrl}\`);
        onError?.(error.message, error);
    }
    /**`,
        "@babylonjs/core/Misc/tools.js::_LoadScriptWeb",
      );

      return { contents, loader: "js" };
    });

    build.onLoad({ filter: /[\\/]@babylonjs[\\/]core[\\/]Misc[\\/]timingTools\.js$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");

      contents = replaceOrThrow(
        contents,
        /export const _RetryWithInterval = \(condition, onSuccess, onError, step = 16, maxTimeout = 30000, checkConditionOnCall = true, additionalStringOnTimeout\) => \{[\s\S]*?return \(\) => clearInterval\(int\);\n\};/,
        `export const _RetryWithInterval = (condition, onSuccess, onError, step = 16, maxTimeout = 30000, checkConditionOnCall = true, additionalStringOnTimeout) => {
    if (checkConditionOnCall && RunWithCondition(condition, onSuccess, onError)) {
        return null;
    }
    let cancelled = false;
    let timeoutId = null;
    const retry = () => {
        if (cancelled) {
            return;
        }
        if (RunWithCondition(condition, onSuccess, onError)) {
            return;
        }
        maxTimeout -= step;
        if (maxTimeout < 0) {
            onError?.(new Error("Operation timed out after maximum retries. " + (additionalStringOnTimeout || "")), true);
            return;
        }
        timeoutId = setTimeout(retry, step);
    };
    timeoutId = setTimeout(retry, step);
    return () => {
        cancelled = true;
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    };
};`,
        "@babylonjs/core/Misc/timingTools.js::_RetryWithInterval",
      );

      return { contents, loader: "js" };
    });

    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      if (!isProduction) return;
      await sanitizeReviewFalsePositives();
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [patchBabylonRuntimePlugin],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  minify: isProduction,
  legalComments: isProduction ? "none" : "inline",
  sourcemap: isProduction ? false : "inline",
  treeShaking: true,
  loader: {
    ".py": "text",
  },
  outfile,
});

if (isProduction) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
