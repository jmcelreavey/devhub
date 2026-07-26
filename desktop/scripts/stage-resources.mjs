#!/usr/bin/env node
/**
 * Stage the generic read-only assets the installed app needs.
 *
 * This script is the personal-data boundary, and it is an **allowlist** for
 * that reason. This repo is the private mirror: notes, tasks, collections,
 * upstarts, and a personal `persona/identity.txt` are committed right next to
 * the code. A denylist here would be one forgotten pattern away from shipping
 * somebody's private notes inside a signed public installer, and you cannot
 * unpublish a release.
 *
 * So nothing is copied unless it is named below, and a manifest of every
 * staged file is written for CI to assert against.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot, resourcesDir } from "./staging-paths.mjs";

function log(msg) {
  process.stdout.write(`[stage-resources] ${msg}\n`);
}

/**
 * What ships. Each entry is a directory or file relative to the repo root.
 *
 * `optional` marks things a public core checkout may legitimately not have.
 * Everything else missing is a build failure — a bundle without skills is not
 * a smaller bundle, it is a broken one.
 */
const ALLOWLIST = [
  { from: "skills/shared", to: "skills/shared" },
  { from: "agents/shared", to: "agents/shared" },
  { from: "mcp/shared", to: "mcp/shared", optional: true },
  { from: "persona/shared-persona.md", to: "persona/shared-persona.md" },
  { from: "persona/deep-preferences.md", to: "persona/deep-preferences.md", optional: true },
  { from: "persona/modes", to: "persona/modes", optional: true },
  { from: "docs", to: "docs", optional: true },
];

/**
 * Files that must never be staged, whatever the allowlist says.
 *
 * Belt and braces on top of the allowlist: `docs/` is allowlisted wholesale
 * and a future commit could drop something personal in there. Cheap to check,
 * catastrophic to miss.
 */
const DENY_NAMES = new Set([
  "identity.txt",
  ".env",
  ".env.local",
  "launcher-settings.json",
  "repo-path.txt",
]);
const DENY_PATTERNS = [/\.pem$/i, /\.key$/i, /id_rsa/i, /credentials?\.json$/i];

/** Noise that should never be inside a signed bundle. Not a security boundary. */
const SKIP_NAMES = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db", ".next"]);

function denied(name) {
  return DENY_NAMES.has(name) || DENY_PATTERNS.some((re) => re.test(name));
}

function copyFiltered(from, to, staged) {
  const stat = fs.statSync(from);
  if (stat.isFile()) {
    if (denied(path.basename(from))) {
      throw new Error(`Refusing to stage denied file: ${path.relative(repoRoot, from)}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    staged.push(to);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    if (denied(entry.name)) {
      log(`skipping denied entry ${path.relative(repoRoot, path.join(from, entry.name))}`);
      continue;
    }
    copyFiltered(path.join(from, entry.name), path.join(to, entry.name), staged);
  }
}

/**
 * The packaged default identity.
 *
 * The private mirror's `persona/identity.txt` is this developer's personal
 * tone file, and it is explicitly denied above. The shipped app still needs
 * *an* L0 identity or the persona UI is empty on first run, so a generic one is
 * written here rather than copied from anywhere.
 */
const GENERIC_IDENTITY = `<!-- ai-dotfiles:identity:start -->
## Who You Are

A capable engineering assistant working inside DevHub. Direct, concrete, and
honest about uncertainty.

## Tone

- Say the useful thing first. Skip the preamble.
- Plain language over jargon. Explain a term the first time it matters.
- Disagree when you have a reason, and give the reason.

## How To Work

- Do the task rather than describing how you would do it.
- Ask before destructive actions; don't ask before creating a file.
- Small, readable changes over clever ones.

## Make This Yours

Edit this file from Settings → Persona. It is loaded at the start of every
session, so keep it short — a few hundred words is plenty.

<!-- ai-dotfiles:identity:end -->
`;

export function stageResources() {
  fs.rmSync(resourcesDir, { recursive: true, force: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const staged = [];
  for (const entry of ALLOWLIST) {
    const from = path.join(repoRoot, entry.from);
    if (!fs.existsSync(from)) {
      if (entry.optional) continue;
      throw new Error(`Required resource missing: ${entry.from}`);
    }
    copyFiltered(from, path.join(resourcesDir, entry.to), staged);
  }

  const identityPath = path.join(resourcesDir, "persona", "identity.txt");
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(identityPath, GENERIC_IDENTITY, "utf8");
  staged.push(identityPath);

  /**
   * A manifest of everything staged, with digests.
   *
   * CI asserts against this before signing. "Every packaged file is listed"
   * turns a leak from something you notice after publishing into a diff a human
   * reviews, and the digests make an unexpected change visible rather than
   * merely present.
   */
  const manifest = staged
    .map((file) => ({
      path: path.relative(resourcesDir, file).split(path.sep).join("/"),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      bytes: fs.statSync(file).size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  fs.writeFileSync(
    path.join(resourcesDir, "MANIFEST.json"),
    `${JSON.stringify({ generatedFrom: "desktop/scripts/stage-resources.mjs", files: manifest }, null, 2)}\n`,
    "utf8",
  );

  log(`staged ${manifest.length} resource files`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    stageResources();
  } catch (err) {
    process.stderr.write(`[stage-resources] ${err.message}\n`);
    process.exit(1);
  }
}
