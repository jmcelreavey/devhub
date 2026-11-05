import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stageResources } from "./stage-resources.mjs";
import { resourcesDir } from "./staging-paths.mjs";

test("installed resources contain runnable bootstraps with all local imports", async () => {
  const manifest = stageResources();
  for (const resource of ["package.json", "CHANGELOG.md", "scripts/workspace-paths.mjs", "scripts/checkout-rebuild.mjs", "scripts/checkout-payload-smoke.mjs", "scripts/paseo-web-keyboard.mjs", "scripts/paseo-web-image-send.mjs", "apps/core/src/lib/desktop/build-env.mjs"]) {
    assert.equal(manifest.filter((entry) => entry.path === resource).length, 1);
  }
  const bootstrap = await import(pathToFileURL(path.join(resourcesDir, "scripts", "checkout-rebuild.mjs")).href);
  assert.equal(bootstrap.optionsFromArgs(["--launcher=systemd-run", "--pull"]).launcher, "systemd-run");
  assert.equal(typeof bootstrap.runRebuild, "function");
  const paseoBootstrap = await import(pathToFileURL(path.join(resourcesDir, "scripts", "paseo-web-bootstrap.mjs")).href);
  assert.equal(typeof paseoBootstrap.installDevHubBootstrap, "function");
});

test("resource staging replaces personal voice files with a generic guide", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-resource-privacy-"));
  try {
    const scripts = path.join(root, "apps/desktop/scripts");
    fs.mkdirSync(scripts, { recursive: true });
    for (const name of ["stage-resources.mjs", "staging-paths.mjs", "verify-staging.mjs", "is-entry.mjs"]) {
      fs.copyFileSync(new URL(name, import.meta.url), path.join(scripts, name));
    }
    fs.writeFileSync(path.join(scripts, "native-binaries.mjs"), "export const NATIVE_BINARY_PATTERN = /\\.node$/; export function isMuslLinked() { return false; }\n");
    fs.writeFileSync(path.join(scripts, "stage-dashboard.mjs"), "export async function verifyPayload() {}\n");
    const files = [
      "extensions/devhub-selection/package.json",
      "extensions/devhub-selection/dist/extension.js",
      "extensions/devhub-selection/README.md",
      "extensions/devhub-selection/LICENSE",
      "skills/shared/my-voice/SKILL.md",
      "skills/shared/my-voice/writing-style.md",
      "skills/shared/my-voice/learned-voice.md",
      "skills/shared/other/writing-style.md",
      "scripts/checkout-rebuild.mjs",
      "scripts/checkout-payload-smoke.mjs",
      "scripts/git-locked.mjs",
      "apps/core/src/lib/git/mutation-queue.ts",
      "apps/core/src/lib/process-lock.ts",
      "packages/shared/process/directory-lock.ts",
      "apps/core/src/lib/desktop/build-env.mjs",
      "scripts/install-paseo.mjs",
      "scripts/paseo-config.mjs",
      "scripts/paseo-service.mjs",
      "scripts/paseo-web-bootstrap.mjs",
      "scripts/paseo-web-keyboard.mjs",
      "scripts/paseo-web-image-send.mjs",
      "scripts/paseo-release.json",
      "agents/shared/example.md",
      "persona/shared-persona.md",
      "CHANGELOG.md",
    ];
    for (const relative of files) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `synthetic ${relative}`);
    }
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "devhub" }));
    fs.copyFileSync(new URL("../../../scripts/workspace-paths.mjs", import.meta.url), path.join(root, "scripts/workspace-paths.mjs"));
    fs.writeFileSync(path.join(root, "scripts/build-editor-extension.mjs"), "export function buildEditorExtension() {}\n");
    const fixture = await import(pathToFileURL(path.join(scripts, "stage-resources.mjs")).href);
    const paths = fixture.stageResources().map((entry) => entry.path);
    assert.ok(paths.includes("skills/shared/my-voice/SKILL.md"));
    assert.ok(paths.includes("skills/shared/other/writing-style.md"));
    assert.equal(paths.includes("skills/shared/my-voice/writing-style.md"), true);
    assert.equal(paths.includes("skills/shared/my-voice/learned-voice.md"), false);
    const stagedGuide = fs.readFileSync(path.join(root, "apps/desktop/staging/resources/skills/shared/my-voice/writing-style.md"), "utf8");
    assert.equal(stagedGuide, fixture.GENERIC_WRITING_STYLE);
    assert.notEqual(stagedGuide, "synthetic skills/shared/my-voice/writing-style.md");
    assert.equal(fs.readFileSync(path.join(root, "skills/shared/my-voice/writing-style.md"), "utf8"),
      "synthetic skills/shared/my-voice/writing-style.md");

    const resources = path.join(root, "apps/desktop/staging/resources");
    const manifestPath = path.join(resources, "MANIFEST.json");
    const verify = () => spawnSync(process.execPath, [path.join(scripts, "verify-staging.mjs")], { encoding: "utf8", timeout: 10_000 });
    const replaceStagedFile = (relative, content) => {
      const file = path.join(resources, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const entry = manifest.files.find((candidate) => candidate.path === relative);
      const metadata = { path: relative, sha256: crypto.createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content) };
      if (entry) Object.assign(entry, metadata);
      else manifest.files.push(metadata);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    };
    const clean = verify();
    assert.equal(clean.status, 0, clean.stderr);
    replaceStagedFile("skills/shared/my-voice/writing-style.md", "synthetic private writing style");
    const privateStyle = verify();
    assert.notEqual(privateStyle.status, 0);
    assert.match(privateStyle.stderr, /writing-style\.md.*generic/i);
    replaceStagedFile("skills/shared/my-voice/writing-style.md", fixture.GENERIC_WRITING_STYLE);
    replaceStagedFile("skills/shared/my-voice/learned-voice.md", "synthetic private learned voice");
    const learnedVoice = verify();
    assert.notEqual(learnedVoice.status, 0);
    assert.match(learnedVoice.stderr, /learned-voice\.md/i);

    const learnedPath = path.join(resources, "skills/shared/my-voice/learned-voice.md");
    fs.unlinkSync(learnedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files = manifest.files.filter((entry) => entry.path !== "skills/shared/my-voice/learned-voice.md");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const serverVoice = path.join(root, "apps/desktop/staging/server/skills/shared/my-voice/writing-style.md");
    fs.mkdirSync(path.dirname(serverVoice), { recursive: true });
    fs.writeFileSync(serverVoice, "synthetic private server voice");
    const serverLeak = verify();
    assert.notEqual(serverLeak.status, 0);
    assert.match(serverLeak.stderr, /personal voice paths staged in the server/i);

    const privateDirectory = path.join(root, "private-content");
    fs.mkdirSync(privateDirectory);
    fs.writeFileSync(path.join(privateDirectory, "voice.md"), "synthetic private data");
    const privateLink = path.join(root, "skills/shared/other/private-link");
    fs.symlinkSync(privateDirectory, privateLink, "junction");
    assert.throws(() => fixture.stageResources(), /symbolic link/i);
    fs.unlinkSync(privateLink);
    const movedSkills = path.join(root, "linked-skills");
    fs.renameSync(path.join(root, "skills"), movedSkills);
    fs.symlinkSync(movedSkills, path.join(root, "skills"), "junction");
    assert.throws(() => fixture.stageResources(), /symbolic link/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
