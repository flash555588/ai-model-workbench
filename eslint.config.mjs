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
