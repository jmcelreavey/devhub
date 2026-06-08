import type { NextConfig } from "next";
import path from "node:path";

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
const DEFAULT_ALLOWED_DEV_ORIGINS: readonly string[] = [
  "192.168.*.*",
  "10.*.*.*",
  "172.*.*.*",
  "100.*.*.*",
  "*.local",
];

function extraAllowedDevOriginsFromEnv(): string[] {
  const raw = process.env.DEVHUB_ALLOWED_DEV_ORIGINS;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const nextConfig: NextConfig = {
  /**
   * `npm run verify` runs `tsc --noEmit` before `next build`. Skipping Next's second
   * full-program typecheck avoids CI OOM (~2GB default heap) and saves minutes.
   * Standalone `npm run build` still typechecks unless DEVHUB_SKIP_NEXT_TYPECHECK is set.
   */
  typescript: {
    ignoreBuildErrors: process.env.DEVHUB_SKIP_NEXT_TYPECHECK === "true",
  },
  /** @blocknote/xl-ai/server is tagged "use client"; keep it out of the App Route bundle. */
  serverExternalPackages: ["@blocknote/xl-ai", "@blocknote/core"],
  allowedDevOrigins: [...DEFAULT_ALLOWED_DEV_ORIGINS, ...extraAllowedDevOriginsFromEnv()],
  outputFileTracingExcludes: {
    "/*": ["./next.config.ts"],
    "/api/skills/\\[name\\]": ["./next.config.ts"],
  },
  outputFileTracingRoot: repoRoot,
  /** Empty turbopack block keeps Next 16 happy with the webpack config below. Do NOT set turbopack.root
   *  to repoRoot — Turbopack would watch notes/, docs/, tasks/, etc. and can fork workers until RAM is gone. */
  turbopack: {},
  // Don't watch notes/ — large dir unrelated to app code (webpack / `next dev --webpack`)
  webpack: (config, { isServer }) => {
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
          if (request?.startsWith("node:")) {
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

export default nextConfig;
