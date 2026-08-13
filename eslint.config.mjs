import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      ".tmp/**",
      ".venv/**",
      "_obsidian_test_vault/**",
      "_pr_work/**",
      "main.js",
      "main.js.map",
      "*.zip",
      "*.png",
      "models/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      // Match the Obsidian plugin review's type-checked linting so local `npm run lint`
      // predicts review warnings. These rules fire only when a value is actually `any`;
      // the review's mass 0.7.7 warnings were an artifact of its failed `npm ci`
      // (stale lockfile) leaving node types unresolved.
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      globals: {
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "obsidianmd/prefer-active-window-timers": "off",
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,ts}", "*.config.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-active-doc": "off",
      "@microsoft/sdl/no-inner-html": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-restricted-globals": "off",
    },
  },
]);
