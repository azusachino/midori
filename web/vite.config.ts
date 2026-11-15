import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite dev server on 5173; `/api` proxies to the Bun API (MIDORI_PORT, default 5174).
 * `@midori/domain` aliases the server's DTO module so the client shares one contract.
 */
const apiPort = Number(process.env.MIDORI_PORT ?? 5174);

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@midori/domain": fileURLToPath(new URL("../src/domain", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
