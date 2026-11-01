import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@shared", replacement: path.resolve(__dirname, "../../packages/shared") },
      { find: "@contracts", replacement: path.resolve(__dirname, "../../packages/shared") },
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    /**
     * 30s per test: several suites spawn real git subprocesses in temp dirs
     * (discard, standup, file-history, devhub-update). On the 5s default they
     * blow their timeout whenever a build hogs the CPU — a load-flake that
     * looks like a regression. A genuinely hung test still fails, just in 30s.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
      "app/**/*.test.tsx",
      "components/**/*.test.tsx",
      // `.ts` too: a hook or a pure helper beside its component needs no JSX,
      // and without this its tests are silently never collected — which is the
      // same failure mode the comment above describes, one glob along.
      "components/**/*.test.ts",
      "scripts/**/*.test.ts",
      "../../apps/core/src/scripts/**/*.test.ts",
      "../../apps/core/src/domains/{tasks,notifications,events}/**/*.test.{ts,tsx}",
      "../../tests/integration/ui-core/**/*.test.ts",
      "../../apps/core/src/lib/**/*.test.{ts,tsx}",
      "../../packages/shared/ui-lib/**/*.test.{ts,tsx}",
      // Private project scripts keep their tests beside the source; public clones have none.
      "../../upstarts/**/*.test.ts",
      "../../packages/shared/notes-search/**/*.test.ts",
      "../../packages/shared/notes-assets/**/*.test.ts",
      "../../packages/shared/markdown-convert/**/*.test.ts",
      "../../packages/shared/meeting-note/**/*.test.ts",
      "../../packages/shared/pr-note/**/*.test.ts",
      "../../packages/shared/entity-note/**/*.test.ts",
      "../../packages/shared/task-note/**/*.test.ts",
      "../../packages/shared/tasks/**/*.test.ts",
      "../../packages/shared/storage/**/*.test.ts",
      "../../apps/core/src/domains/storage/**/*.test.ts",
      "../../apps/core/src/http/*.test.ts",
      "../../apps/core/src/http/routes/**/*.test.ts",
      "../../packages/shared/mcp-history/**/*.test.ts",
      "../../packages/shared/process/**/*.test.ts",
      "../../packages/shared/*.test.ts",
      "../../packages/shared/actions/**/*.test.ts",
      "../../packages/mcp/src/**/*.test.ts",
    ],
    /** Playwright owns e2e/; vitest must not pick those specs up. */
    exclude: ["**/node_modules/**", "**/dist*/**", "e2e/**"],
    globals: false,
  },
});
