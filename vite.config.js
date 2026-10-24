import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "./",
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        r001: fileURLToPath(new URL("./r001.html", import.meta.url)),
        r002: fileURLToPath(new URL("./r002.html", import.meta.url)),
      },
    },
  },
});
