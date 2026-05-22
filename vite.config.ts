import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { envOnlyMacros } from "vite-env-only";

// Native node modules that should never be bundled or pre-bundled by Vite.
// ssh2 ships native bindings (sshcrypto.node, cpu-features), pg/postgres
// works fine externally, sharp is server-only.
const NATIVE_EXTERNALS = ["ssh2", "cpu-features", "sharp", "node:crypto"];

export default defineConfig({
  resolve: {
    alias: {
      "~": new URL("./src", import.meta.url).pathname,
    },
  },
  optimizeDeps: {
    exclude: NATIVE_EXTERNALS,
  },
  ssr: {
    external: NATIVE_EXTERNALS,
    noExternal: [],
  },
  build: {
    rollupOptions: {
      external: NATIVE_EXTERNALS,
    },
  },
  plugins: [envOnlyMacros(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
});
