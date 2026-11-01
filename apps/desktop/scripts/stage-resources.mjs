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
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEnvFile, repoRoot, resourcesDir } from "./staging-paths.mjs";
import { isEntry } from "./is-entry.mjs";

const { buildEditorExtension } = await import(pathToFileURL(path.join(repoRoot, "scripts", "build-editor-extension.mjs")).href);
const buildEnvRelative = path.relative(repoRoot, buildEnvFile).split(path.sep).join("/");

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
  { from: "extensions/devhub-selection/package.json", to: "extensions/devhub-selection/package.json" },
  { from: "extensions/devhub-selection/dist", to: "extensions/devhub-selection/dist" },
  { from: "extensions/devhub-selection/README.md", to: "extensions/devhub-selection/README.md" },
  { from: "extensions/devhub-selection/LICENSE", to: "extensions/devhub-selection/LICENSE" },
  { from: "skills/shared", to: "skills/shared" },
  { from: "package.json", to: "package.json" },
  { from: "CHANGELOG.md", to: "CHANGELOG.md" },
  { from: "scripts/workspace-paths.mjs", to: "scripts/workspace-paths.mjs" },
  { from: "scripts/checkout-rebuild.mjs", to: "scripts/checkout-rebuild.mjs" },
  { from: "scripts/checkout-payload-smoke.mjs", to: "scripts/checkout-payload-smoke.mjs" },
  { from: "scripts/git-locked.mjs", to: "scripts/git-locked.mjs" },
  { from: "apps/core/src/lib/git/mutation-queue.ts", to: "apps/core/src/lib/git/mutation-queue.ts" },
  { from: "apps/core/src/lib/process-lock.ts", to: "apps/core/src/lib/process-lock.ts" },
  { from: "packages/shared/process/directory-lock.ts", to: "packages/shared/process/directory-lock.ts" },
  { from: buildEnvRelative, to: buildEnvRelative },
  // Managed Paseo setup/updates must also work without a linked checkout.
  { from: "scripts/install-paseo.mjs", to: "scripts/install-paseo.mjs" },
  { from: "scripts/paseo-config.mjs", to: "scripts/paseo-config.mjs" },
  { from: "scripts/paseo-service.mjs", to: "scripts/paseo-service.mjs" },
  { from: "scripts/paseo-web-bootstrap.mjs", to: "scripts/paseo-web-bootstrap.mjs" },
  { from: "scripts/paseo-release.json", to: "scripts/paseo-release.json" },
  // Vendored upstream skills are read-only catalog entries; without them the
  // Skills page offers "Add to catalog" for skills the repo already owns.
  { from: "skills/vendor", to: "skills/vendor", optional: true },
  { from: "agents/shared", to: "agents/shared" },
  { from: "mcp/shared", to: "mcp/shared", optional: true },
  { from: "persona/shared-persona.md", to: "persona/shared-persona.md" },
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
const PERSONAL_ROOTS = new Set(["notes", "diagrams", "tasks", "collections", "upstarts", "reps", "private", "reviews", ".devhub"]);
const PERSONAL_FILES = new Set([
  "persona/identity.txt",
  "skills/shared/my-voice/writing-style.md",
  "skills/shared/my-voice/learned-voice.md",
]);

export function isPersonalSourcePath(relative) {
  return PERSONAL_ROOTS.has(relative.split("/")[0]) || PERSONAL_FILES.has(relative);
}

/** Noise that should never be inside a signed bundle. Not a security boundary. */
const SKIP_NAMES = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db", ".next"]);

function denied(file) {
  const name = path.basename(file);
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  return isPersonalSourcePath(relative) || DENY_NAMES.has(name) || DENY_PATTERNS.some((re) => re.test(name));
}

function assertNoLinkedParents(file) {
  const parents = path.relative(repoRoot, file).split(path.sep).slice(0, -1);
  let current = repoRoot;
  for (const parent of parents) {
    current = path.join(current, parent);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to stage symbolic link: ${path.relative(repoRoot, current)}`);
    }
  }
}

function copyFiltered(from, to, staged) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to stage symbolic link: ${path.relative(repoRoot, from)}`);
  }
  if (stat.isFile()) {
    if (denied(from)) {
      throw new Error(`Refusing to stage denied file: ${path.relative(repoRoot, from)}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    staged.push(to);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Refusing to stage non-regular resource: ${path.relative(repoRoot, from)}`);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    if (denied(source)) {
      log(`skipping denied entry ${path.relative(repoRoot, source)}`);
      continue;
    }
    copyFiltered(source, path.join(to, entry.name), staged);
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

export const GENERIC_WRITING_STYLE = `# Writing style

This is a generic starting point for \`my-voice\`. Customise it in your private
mirror, or use DevHub's **Voice** page to train a guide from your own answers.
Keep writing samples and the generated \`learned-voice.md\` out of the public core.

## Default style

Lead with the answer or the concrete change. Use plain words, short paragraphs
and active verbs. Keep technical identifiers exact.

Use British spelling and contractions unless the user asks otherwise. Cut
corporate filler, invented enthusiasm and unnecessary apologies. Explain the
reason for a choice when it helps the reader decide what to do.

## Match the context

- **Chat and explanations:** answer directly, then add the detail needed to act.
- **Tasks and tickets:** describe the problem, expected behaviour and acceptance criteria.
- **PRs and commits:** state what changes and why, with relevant validation. Preserve conventional commit prefixes.
- **Email:** use a greeting and a short sign-off when appropriate.
- **Slack:** keep it conversational; skip email greetings and closings.

## Personalise this guide

Add preferences for tone, spelling, register, openings and closings in your
private mirror. Include a few examples that you have permission to use. Avoid
secrets and confidential customer or company material.

If \`learned-voice.md\` exists, the skill loads it alongside this guide. Learned
preferences take precedence where they disagree; put durable corrections here.
`;

export function stageResources() {
  buildEditorExtension();
  fs.rmSync(resourcesDir, { recursive: true, force: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const staged = [];
  for (const entry of ALLOWLIST) {
    const from = path.join(repoRoot, entry.from);
    if (!fs.existsSync(from)) {
      if (entry.optional) continue;
      throw new Error(`Required resource missing: ${entry.from}`);
    }
    assertNoLinkedParents(from);
    copyFiltered(from, path.join(resourcesDir, entry.to), staged);
  }

  const identityPath = path.join(resourcesDir, "persona", "identity.txt");
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(identityPath, GENERIC_IDENTITY, "utf8");
  staged.push(identityPath);

  const stylePath = path.join(resourcesDir, "skills", "shared", "my-voice", "writing-style.md");
  fs.mkdirSync(path.dirname(stylePath), { recursive: true });
  fs.writeFileSync(stylePath, GENERIC_WRITING_STYLE, "utf8");
  staged.push(stylePath);

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
    `${JSON.stringify({ generatedFrom: path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join("/"), files: manifest }, null, 2)}\n`,
    "utf8",
  );

  log(`staged ${manifest.length} resource files`);
  return manifest;
}

if (isEntry(import.meta.url)) {
  try {
    stageResources();
  } catch (err) {
    process.stderr.write(`[stage-resources] ${err.message}\n`);
    process.exit(1);
  }
}
