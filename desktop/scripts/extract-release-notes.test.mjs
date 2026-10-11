import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./extract-release-notes.mjs", import.meta.url));

test("extracts a release body verbatim and fails clearly for missing entries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-release-notes-"));
  try {
    const source = path.join(directory, "CHANGELOG.md");
    const output = path.join(directory, "release.md");
    fs.writeFileSync(source, "## Unreleased\n- Future\n\n## 2.1.0 — 2026-10-10\n### Added\n- **Highlight**\n\n## 2.0.5\n- Older\n");
    const result = spawnSync(process.execPath, [script, "v2.1.0", source, output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, "utf8"), "### Added\n- **Highlight**\n");
    const missing = spawnSync(process.execPath, [script, "2.2.0", source], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Update CHANGELOG before release/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the release workflow gates every platform and uses the changelog body", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/release-desktop.yml", import.meta.url), "utf8");
  assert.match(workflow, /Validate release notes before building/);
  assert.match(workflow, /wsl-payload:\n\s+name:.*\n\s+needs: plan/);
  assert.match(workflow, /body_path: dist\/release-notes\.md/);
  assert.match(workflow, /generate_release_notes: false/);
  assert.match(workflow, /::warning::No changelog entry for this dry-run version/);
});
