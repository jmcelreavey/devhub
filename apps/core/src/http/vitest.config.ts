import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");

export default defineConfig({
  root: directory,
  resolve: {
    alias: [
      { find: "@shared", replacement: path.join(root, "packages/shared") },
      { find: "@contracts", replacement: path.join(root, "packages/shared") },
      { find: "@", replacement: path.join(root, "apps/ui") },
    ],
  },
  test: { environment: "node", include: ["*.test.ts"] },
});
