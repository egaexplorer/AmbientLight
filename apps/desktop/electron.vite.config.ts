import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The workspace packages are bundled from their TypeScript sources, so the app needs no `tsc` build first.
const alias = {
  "@ambientlight/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
  "@ambientlight/node": fileURLToPath(new URL("../../packages/node/src/index.ts", import.meta.url)),
};

export default defineConfig({
  main: {
    resolve: { alias },
    // screenshot-desktop stays external: it runs files from its own folder.
    build: { externalizeDeps: { exclude: ["@ambientlight/core", "@ambientlight/node"] } },
  },
  preload: {
    resolve: { alias },
    // A sandboxed preload must be CommonJS.
    build: { rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
});
