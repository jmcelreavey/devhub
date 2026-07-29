/**
 * Fail the build if a content route got statically prerendered.
 *
 * Docs read user content from disk and must render per request. `DOCS_DIR` is
 * only known at runtime — in the desktop app it comes from app-support config
 * that does not exist on the build machine — so a prerender
 * bakes in whatever the *builder* could see.
 *
 * This is not hypothetical. The desktop bundle shipped a static `/docs` page
 * whose HTML contained "No docs yet", because the staging build ran without a
 * visible docs directory. The APIs worked; the page was a photograph of an
 * empty room. Nothing in lint, typecheck, tests or the app itself catches that
 * — the page renders fine, it is just permanently wrong.
 *
 * Usage: npx tsx scripts/check-no-prerendered-content-routes.mts [buildDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const buildDir = process.argv[2] ?? path.resolve(HERE, "../.next");

/** Route paths, relative to `.next/server/app`, that must never be static. */
const MUST_BE_DYNAMIC = ["docs"];

const appDir = path.join(buildDir, "server", "app");
if (!fs.existsSync(appDir)) {
  console.error(`No build output at ${appDir} — run a build first.`);
  process.exit(1);
}

const offenders: string[] = [];
for (const route of MUST_BE_DYNAMIC) {
  // A prerendered route leaves `<route>.html` beside its `.rsc` payload.
  // Dynamic routes emit neither.
  const html = path.join(appDir, `${route}.html`);
  if (fs.existsSync(html)) offenders.push(`/${route} → ${path.relative(buildDir, html)}`);
}

if (offenders.length > 0) {
  console.error("Content routes were statically prerendered:\n");
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    '\nAdd `export const dynamic = "force-dynamic"` to the route\'s page.tsx and\n' +
      "layout.tsx. These routes read user content from disk at request time.",
  );
  process.exit(1);
}

console.log(`ok — ${MUST_BE_DYNAMIC.length} content route(s) render per request.`);
