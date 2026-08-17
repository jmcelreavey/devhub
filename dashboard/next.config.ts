import type { NextConfig } from "next";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/** Repo root — used for production file tracing only (not Turbopack dev root). */
const repoRoot = path.join(__dirname, "..");

/**
 * Next.js 16+ blocks browser requests to dev-only paths under `/_next/*` (and
 * related) unless the `Origin` host is allowlisted. The dev server’s bind
 * host (`0.0.0.0` → treated as `localhost` here) does not cover “open this
 * site from my phone at http://192.168.x.x:1337”, so chunks never load and
 * the UI sits in loading forever. Wildcards use Next’s dot-segment rules; see
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
 */
/**
 * RFC1918 reserves 172.16.0.0/12 — that is 172.16.* through 172.31.*, NOT all of
 * 172.*. The old `172.*.*.*` entry allowed ~15 extra /16s of public address space
 * for no benefit. Next's matcher has no CIDR support, so the range is enumerated.
 */
const RFC1918_172: readonly string[] = Array.from(
  { length: 16 },
  (_, i) => `172.${16 + i}.*.*`,
);

const DEFAULT_ALLOWED_DEV_ORIGINS: readonly string[] = [
  "192.168.*.*",
  "10.*.*.*",
  ...RFC1918_172,
  "100.*.*.*", // CGNAT — Tailscale
  "*.local", // mDNS
];

function extraAllowedDevOriginsFromEnv(): string[] {
  const raw = process.env.DEVHUB_ALLOWED_DEV_ORIGINS;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * `output: "standalone"` is desktop-only, and deliberately opt-in.
 *
 * Standalone emits `.next/standalone/server.js` plus a traced `node_modules`
 * subset — exactly what the Tauri sidecar needs to run without a checkout, npm,
 * or a global Node. It is NOT enabled for normal `next build` because tracing
 * changes what gets bundled and adds build time that browser-mode users never
 * benefit from. `desktop/scripts/stage-dashboard.mjs` sets DEVHUB_DESKTOP_BUILD=1.
 */
const desktopBuild = process.env.DEVHUB_DESKTOP_BUILD === "1";
/** Isolate `npm run verify` / pre-push builds from a live `next-server` `.next` dir. */
const verifyBuild = process.env.DEVHUB_VERIFY_BUILD === "1";
/** Second local instance (e.g. PORT=1347) — keep it off the live `.next` cache. */
const isolatedDist = process.env.DEVHUB_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  ...(desktopBuild ? ({ output: "standalone" } as const) : {}),
  ...(verifyBuild
    ? ({ distDir: ".next-verify" } as const)
    : isolatedDist
      ? ({ distDir: isolatedDist } as const)
      : {}),
  /**
   * Pin the default so a corrupted/partial config merge cannot blow up as
   * `TypeError: generate is not a function` inside Next's generateBuildId.
   * Returning null keeps Next's nanoid fallback.
   *
   * Note: the packaged desktop server sets `__NEXT_PRIVATE_STANDALONE_CONFIG`
   * (JSON, functions stripped). If that leaks into `next build`, this pin is
   * never read — scrub it in scrubDesktopRuntimeEnv / pre-push instead.
   */
  generateBuildId: () => null,
  /**
   * `npm run verify` runs `tsc --noEmit` before `next build`. Skipping Next's second
   * full-program typecheck avoids CI OOM (~2GB default heap) and saves minutes.
   * Standalone `npm run build` still typechecks unless DEVHUB_SKIP_NEXT_TYPECHECK is set.
   */
  typescript: {
    ignoreBuildErrors: process.env.DEVHUB_SKIP_NEXT_TYPECHECK === "true",
  },
  /** @blocknote/xl-ai/server is tagged "use client"; keep it out of the App Route bundle. */
  serverExternalPackages: ["@blocknote/xl-ai", "@blocknote/core", "adm-zip"],
  allowedDevOrigins: [...DEFAULT_ALLOWED_DEV_ORIGINS, ...extraAllowedDevOriginsFromEnv()],
  outputFileTracingExcludes: {
    "/*": ["./next.config.ts"],
    "/api/skills/\\[name\\]": ["./next.config.ts"],
  },
  outputFileTracingRoot: repoRoot,
  /** Empty turbopack block keeps Next 16 happy with the webpack config below. Do NOT set turbopack.root
   *  to repoRoot — Turbopack would watch notes/, docs/, tasks/, etc. and can fork workers until RAM is gone. */
  /**
   * React Compiler — auto-memoisation for the whole tree.
   *
   * Kept on evidence, not faith. Measured on /repos (52 cards re-rendering on
   * every filter keystroke), summing the *synchronous* work of each update:
   *
   *   off: 32.1 / 32.9 / 34.4 ms      on: 28.3 / 26.6 / 26.4 ms
   *
   * ~18% less render work, non-overlapping across three runs each, and the
   * worst single update drops from 8.8ms to 6.8ms. Costs ~20s of build time.
   *
   * An earlier attempt concluded the opposite, because that benchmark waited on
   * requestAnimationFrame between updates and so measured frame scheduling
   * (14 updates x 2 frames ~= 224ms) rather than React. If you re-evaluate this,
   * measure the synchronous span around the dispatch — see PF3.
   */
  reactCompiler: true,
  // experimental.viewTransition: REMOVED — see the Traps section in
  // CONTRIBUTING.md. It made Next call
  // document.startViewTransition on navigation, which threw
  // "InvalidStateError: Transition was aborted because of invalid state" on both
  // dev and prod and replayed the boot screen mid-session. React 19.2.4 stable
  // exports no ViewTransition component, so the React half was a no-op anyway.

  turbopack: {},
  // Don't watch notes/ — large dir unrelated to app code (webpack / `next dev --webpack`)
  webpack: (config, { isServer, dev }) => {
    /**
     * Disk cache, version-keyed to app/globals.css content. Webpack's
     * persistent cache repeatedly pinned stale PostCSS/Tailwind output for
     * globals.css — edits compiled to no-ops until the cache was deleted by
     * hand. This bit dev AND production builds: a `next build` (e.g. Electron's
     * "Switch to Production") would reuse the stale CSS, so globals.css edits
     * and newly-used Tailwind classes never reached the prod bundle even though
     * dev/HMR showed them. Keying `cache.version` to a hash of the file starts a
     * fresh cache whenever globals.css changes (correct CSS) while unrelated
     * builds keep the warm cache (fast). Applies to both modes for this reason.
     */
    {
      let cssHash = "none";
      try {
        cssHash = crypto
          .createHash("sha1")
          .update(fs.readFileSync(path.join(__dirname, "app", "globals.css")))
          .digest("hex")
          .slice(0, 12);
      } catch {
        /* missing file — fall through with a constant */
      }
      config.cache = {
        ...(typeof config.cache === "object" ? config.cache : {}),
        type: "filesystem",
        version: `devhub-css-${cssHash}${dev ? "-dev" : "-prod"}`,
      };
    }
    // Dev webpack compiles instrumentation.ts into a server bundle; without this,
    // `node:child_process` (via scheduler → scripts-runner) triggers UnhandledSchemeError.
    if (isServer) {
      const existing = config.externals;
      const prior = Array.isArray(existing)
        ? existing
        : existing
          ? [existing]
          : [];
      config.externals = [
        ...prior,
        ({ request }: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
          // `adm-zip` uses bare require("path"); webpack then fails compiling instrumentation.
          if (request?.startsWith("node:") || request === "adm-zip") {
            callback(null, `commonjs ${request}`);
            return;
          }
          callback();
        },
      ];
    }

    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/notes/**", "**/node_modules/**", "**/.git/**"],
    };
    return config;
  },
};

/**
 * Bundle analysis, opt-in via `ANALYZE=1 npm run build`.
 *
 * `@next/bundle-analyzer` is an optional devDependency and is only `require`d
 * when ANALYZE is set, so a normal install/build never needs it present. If it
 * is missing we warn and continue rather than failing the build.
 */
function withOptionalAnalyzer(config: NextConfig): NextConfig {
  if (process.env.ANALYZE !== "1" && process.env.ANALYZE !== "true") return config;
  try {
    type AnalyzerFactory = (opts: { enabled: boolean }) => (c: NextConfig) => NextConfig;
    const load = createRequire(__filename);
    const withBundleAnalyzer = (load("@next/bundle-analyzer") as AnalyzerFactory)({ enabled: true });
    return withBundleAnalyzer(config);
  } catch {
    console.warn(
      "[next.config] ANALYZE is set but @next/bundle-analyzer is not installed.\n" +
        "             Run: npm i -D @next/bundle-analyzer",
    );
    return config;
  }
}

export default withOptionalAnalyzer(nextConfig);
