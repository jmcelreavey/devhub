/**
 * Validate every Mermaid diagram in `docs/`.
 *
 * Mermaid needs a real DOM to parse, so this drives a headless Chromium with the
 * bundled `mermaid` build rather than trying to parse in Node. Cheap enough to
 * run on demand, and it catches the failure mode that is otherwise invisible:
 * a diagram that renders as an empty box in the app with nothing in the console.
 *
 * Usage: npx tsx scripts/check-docs-diagrams.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  buildMermaidTheme,
  DARK_FALLBACK_PALETTE,
  LIGHT_FALLBACK_PALETTE,
} from "../lib/docs/mermaid-theme";

/** Shape of the probe we inject into the harness page. */
interface CheckWindow {
  __check: (code: string) => Promise<string | null>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(HERE, "../../docs");
const MERMAID_DIST = path.resolve(HERE, "../node_modules/mermaid/dist/mermaid.min.js");

/** The exact theme config the app ships, in both modes. */
const THEMES = {
  dark: buildMermaidTheme(DARK_FALLBACK_PALETTE, true),
  light: buildMermaidTheme(LIGHT_FALLBACK_PALETTE, false),
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

/** Pull fenced ```mermaid blocks with their 1-based start line. */
function extractDiagrams(file: string) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const out: Array<{ line: number; code: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*```mermaid\s*$/.test(lines[i])) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    out.push({ line: i + 1, code: body.join("\n") });
    i = j;
  }
  return out;
}

const diagrams = walk(DOCS_ROOT).flatMap((file) =>
  extractDiagrams(file).map((d) => ({ ...d, file: path.relative(DOCS_ROOT, file) })),
);

if (diagrams.length === 0) {
  console.log("No mermaid diagrams found.");
  process.exit(0);
}

// The harness is written to disk beside node_modules so the script tag
// resolves. Uses the UMD build: the ESM entry pulls lazy chunks that do not
// resolve over file://.
const harness = path.resolve(HERE, ".mermaid-check.html");
fs.writeFileSync(
  harness,
  `<!doctype html><html><body>
<script src=${JSON.stringify(pathToFileURL(MERMAID_DIST).href)}></script>
<script>
window.__themes = ${JSON.stringify(THEMES)};
window.__check = async (code) => {
  // Validate under both themes: the app drives Mermaid from design tokens, and
  // a bad token only breaks the mode it belongs to.
  for (const [name, themeVariables] of Object.entries(window.__themes)) {
    try {
      mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables });
      await mermaid.parse(code);
      await mermaid.render("probe-" + Math.random().toString(36).slice(2), code);
    } catch (e) {
      return name + ": " + String(e && e.message ? e.message : e).split("\\n")[0];
    }
  }
  return null;
};
</script></body></html>`,
);

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(pathToFileURL(harness).href);
  await page.waitForFunction(
    () => typeof (window as unknown as CheckWindow).__check === "function",
    null,
    { timeout: 20_000 },
  );
} finally {
  fs.rmSync(harness, { force: true });
}

let failures = 0;
for (const diagram of diagrams) {
  const error = await page.evaluate(
    (code: string) => (window as unknown as CheckWindow).__check(code),
    diagram.code,
  );
  const label = `${diagram.file}:${diagram.line}`;
  if (error) {
    failures += 1;
    console.error(`FAIL ${label}\n     ${error}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

await browser.close();
console.log(`\n${diagrams.length - failures}/${diagrams.length} diagrams render.`);
process.exit(failures > 0 ? 1 : 0);
