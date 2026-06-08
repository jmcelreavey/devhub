import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSyncPreview } from "./sync-preview";

describe("buildSyncPreview", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("shows skill writes without pruning by default", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-repo-"));
    process.env.HOME = home;

    fs.mkdirSync(path.join(repo, "skills/shared/alpha"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/alpha/SKILL.md"), "repo alpha\n");
    fs.mkdirSync(path.join(repo, "skills/shared/ignored"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/ignored/SKILL.md"), "repo ignored\n");

    const target = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(target, "alpha"), { recursive: true });
    fs.writeFileSync(path.join(target, "alpha/SKILL.md"), "local alpha\n");
    fs.mkdirSync(path.join(target, "old"), { recursive: true });
    fs.writeFileSync(path.join(target, "old/SKILL.md"), "old\n");
    fs.mkdirSync(path.join(target, "ignored"), { recursive: true });
    fs.writeFileSync(path.join(target, "ignored/SKILL.md"), "local ignored\n");

    const preview = buildSyncPreview({ kind: "skill", repoRoot: repo, exclude: ["ignored"] });
    const codex = preview.targets.find((targetPreview) => targetPreview.tool === "codex");

    expect(codex?.writes).toEqual([{ name: "alpha", reason: "changed" }]);
    expect(codex?.prunes).toEqual([]);
    expect(preview.sourceCount).toBe(1);
  });

  it("shows skill prunes only when prune is enabled", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-repo-"));
    process.env.HOME = home;

    fs.mkdirSync(path.join(repo, "skills/shared/alpha"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/alpha/SKILL.md"), "repo alpha\n");

    const target = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(target, "old"), { recursive: true });
    fs.writeFileSync(path.join(target, "old/SKILL.md"), "old\n");

    const preview = buildSyncPreview({ kind: "skill", repoRoot: repo, prune: true });
    const codex = preview.targets.find((targetPreview) => targetPreview.tool === "codex");

    expect(codex?.prunes).toEqual(["old"]);
  });

  it("shows agent writes and respects prune=false", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-preview-repo-"));
    process.env.HOME = home;

    fs.mkdirSync(path.join(repo, "agents/shared"), { recursive: true });
    fs.writeFileSync(path.join(repo, "agents/shared/reviewer.md"), "repo reviewer\n");

    const target = path.join(home, ".config/opencode/agent");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "old.md"), "old\n");

    const preview = buildSyncPreview({ kind: "agent", repoRoot: repo, prune: false });
    const opencode = preview.targets.find(
      (targetPreview) => targetPreview.tool === "opencode" && targetPreview.path.endsWith(".config/opencode/agent"),
    );

    expect(opencode?.writes).toEqual([{ name: "reviewer", reason: "missing" }]);
    expect(opencode?.prunes).toEqual([]);
  });
});
