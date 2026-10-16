import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Web dev/build configuration.
 * - Dev server proxies `/api` to the Hono server so the browser always talks to one origin
 *   (no CORS; cookies and SSE behave in dev exactly as when Hono serves the built SPA).
 * - `@` maps to `src/` and must stay in sync with the `paths` entry in tsconfig.json.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Bind IPv4 loopback explicitly: the default `localhost` resolves to `::1` on Windows,
    // which would make http://127.0.0.1:5173 unreachable while the API server binds 127.0.0.1.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
});
