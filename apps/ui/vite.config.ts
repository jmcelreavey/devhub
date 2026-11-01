import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { getLogoBootstrapInlineScript } from "./lib/themes/brand-mark";
import { getThemeBootstrapInlineScript } from "./lib/themes/presets";

export default defineConfig({
  plugins: [react(), {
    name: "devhub-theme-bootstrap",
    transformIndexHtml() {
      return [getThemeBootstrapInlineScript(), getLogoBootstrapInlineScript()].map((script) => ({
        tag: "script",
        children: script.replace(/<\/script/gi, "<\\/script"),
        injectTo: "head" as const,
      }));
    },
  }],
  resolve: {
    alias: [
      { find: "@shared", replacement: fileURLToPath(new URL("../../packages/shared", import.meta.url)) },
      { find: "@contracts", replacement: fileURLToPath(new URL("../../packages/shared", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL(".", import.meta.url)) },
    ],
  },
  publicDir: "public",
  build: { outDir: process.env.DEVHUB_DIST_DIR || "dist" },
  define: {
    "process.env.NEXT_PUBLIC_TERMINAL_PORT": "undefined",
    "process.env.NEXT_PUBLIC_REPO_ROOT": "undefined",
    "process.env.NEXT_PUBLIC_JIRA_DOMAIN": "undefined",
    "process.env.JIRA_DOMAIN": "undefined",
  },
  server: {
    host: "127.0.0.1",
    port: 1438,
    strictPort: true,
    proxy: {
      "^/api(?:/|\\?|$)": {
        target: "http://127.0.0.1:1437",
        // Keep Host and Origin together so the existing API guard still applies.
        changeOrigin: false,
      },
    },
  },
});
