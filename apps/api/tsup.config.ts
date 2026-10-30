import { defineConfig } from "tsup"

export default defineConfig({
  // index: self-hosted Node server; app: imported by the Vercel Function (api/index.js).
  entry: ["src/index.ts", "src/app.ts"],
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
