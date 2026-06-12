import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "components/**/*.test.tsx",
      "scripts/**/*.test.ts",
      "../shared/notes-search/**/*.test.ts",
      "../shared/notes-assets/**/*.test.ts",
      "lib/markdown-convert/**/*.test.ts",
    ],
    globals: false,
  },
});
