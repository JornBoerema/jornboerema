import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Workspace packages ship TypeScript source; bundle them into the API.
  noExternal: [/^@evido\//],
  // Bundled CommonJS dependencies still call require().
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
})
