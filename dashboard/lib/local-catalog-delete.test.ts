import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteLocalAgentInstallations, deleteLocalSkillInstallations } from "./local-catalog-delete";

describe("deleteLocalSkillInstallations", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("removes skill directories from all tool installs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-del-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-del-repo-"));
    process.env.HOME = tmp;
    const skillDir = path.join(tmp, ".codex/skills/doomed-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# x\n");
    fs.mkdirSync(path.join(repo, "skills/shared"), { recursive: true });

    const result = deleteLocalSkillInstallations(repo, "doomed-skill");
    expect(result?.tools).toContain("codex");
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it("returns null for unknown slug", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-del-repo2-"));
    expect(deleteLocalSkillInstallations(repo, "NOT-VALID")).toBeNull();
  });
});

describe("deleteLocalAgentInstallations", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("removes agent markdown files from tool dirs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-del-agent-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-del-agent-repo-"));
    process.env.HOME = tmp;
    const agentsRoot = path.join(tmp, ".cursor/agents");
    fs.mkdirSync(agentsRoot, { recursive: true });
    const agentFile = path.join(agentsRoot, "ghost.md");
    fs.writeFileSync(agentFile, "# agent\n");
    fs.mkdirSync(path.join(repo, "agents/shared"), { recursive: true });

    const result = deleteLocalAgentInstallations(repo, "ghost");
    expect(result?.name).toBe("ghost");
    expect(fs.existsSync(agentFile)).toBe(false);
  });
});
