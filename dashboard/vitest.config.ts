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
    /**
     * Default `node` — almost everything under test is pure logic, and booting
     * a DOM per file would be overhead for no gain.
     *
     * Tests that need a DOM opt in with a docblock on line 1:
     *
     *     /** @vitest-environment jsdom *\/
     *
     * (`environmentMatchGlobs` would be the automatic way, but Vitest 4
     * removed it — and removed it *silently*, so a config still carrying it
     * looks like it works while every `.test.tsx` quietly runs under node.)
     *
     * That silence is how this repo ended up with two component tests that
     * asserted on `renderToStaticMarkup` strings: the include glob matched
     * `components/**` `/*.test.tsx`, but there was never a DOM for them to use.
     */
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "app/**/*.test.ts",
      "components/**/*.test.tsx",
      "scripts/**/*.test.ts",
      "../shared/notes-search/**/*.test.ts",
      "../shared/notes-assets/**/*.test.ts",
      "../shared/markdown-convert/**/*.test.ts",
      "../shared/appraisal/**/*.test.ts",
      "../shared/meeting-note/**/*.test.ts",
      "../shared/pr-note/**/*.test.ts",
      "../shared/entity-note/**/*.test.ts",
      "../mcp-servers/devhub-server/src/**/*.test.ts",
    ],
    /** Playwright owns e2e/; vitest must not pick those specs up. */
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    globals: false,
  },
});
