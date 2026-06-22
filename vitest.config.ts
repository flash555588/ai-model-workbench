import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "ai3d-raw-python-template",
      async resolveId(source, importer) {
        if (!source.endsWith(".py") || !importer) {
          return null;
        }
        return resolve(dirname(importer), source);
      },
      async load(id) {
        if (!id.endsWith(".py")) {
          return null;
        }
        const contents = await readFile(id, "utf8");
        return `export default ${JSON.stringify(contents)};`;
      },
    },
  ],
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
});
