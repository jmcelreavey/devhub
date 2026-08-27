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
  {
    /**
     * React Compiler's correctness rules, run by ESLint.
     *
     * The compiler transform is off for the dev server (see next.config.ts), so
     * without these a violation — a ref read during render, state set during
     * render — would only surface at build time. Here it surfaces in the editor.
     *
     * Free to enable: the codebase already passes all four, and they add no
     * measurable lint time because the plugin does this analysis regardless.
     */
    rules: {
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
    },
  },
]);

export default eslintConfig;

