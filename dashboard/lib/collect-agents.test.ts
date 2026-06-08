import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectAgents, scanLocalAgentImportCandidates } from "./collect-agents";

describe("scanLocalAgentImportCandidates", () => {
  const prevHome = process.env.HOME;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
  });

  it("classifies local newer agents and explicit import updates the repo copy", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-agent-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-agent-repo-"));
    process.env.HOME = tmp;

    const repoDir = path.join(repo, "agents/shared");
    const localDir = path.join(tmp, ".codex/agents");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(localDir, { recursive: true });
    const repoFile = path.join(repoDir, "reviewer.md");
    const localFile = path.join(localDir, "reviewer.md");
    fs.writeFileSync(repoFile, "repo\n");
    fs.writeFileSync(localFile, "local\n");
    fs.utimesSync(repoFile, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(localFile, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

    const candidate = scanLocalAgentImportCandidates(repo).find((x) => x.name === "reviewer");
    expect(candidate?.status).toBe("local-newer");

    const code = await collectAgents({
      repoRoot: repo,
      emit: () => {},
      importAgentNames: ["reviewer"],
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(repoFile, "utf-8")).toBe("local\n");
  });

  it("lists agents with markdown files under tool agent dirs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-agents-home-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-agents-repo-"));
    process.env.HOME = tmp;
    fs.mkdirSync(path.join(tmp, ".config/opencode/agent"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".config/opencode/agent/ci-investigator.md"), "---\ndescription: CI agent\n---\n");
    fs.mkdirSync(path.join(repo, "agents/shared"), { recursive: true });

    const candidates = scanLocalAgentImportCandidates(repo);
    const agent = candidates.find((x) => x.name === "ci-investigator");
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("agent");
    expect(agent!.alreadyInRepo).toBe(false);
    expect(agent!.status).toBe("new");
    expect(agent!.sources.some((s) => s.tool === "opencode" && s.kind === "agent")).toBe(true);
  });
});
