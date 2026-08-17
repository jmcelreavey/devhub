import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, widened to every dist dir
    // next.config.ts can produce: `.next-verify` for `npm run verify`, and
    // whatever DEVHUB_DIST_DIR names for a second local instance. Enumerating
    // them meant one stray build dir (`.next-rebuild`, 3.5k files) walked into
    // the lint run and OOM-crashed it at the 4 GB heap limit.
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

