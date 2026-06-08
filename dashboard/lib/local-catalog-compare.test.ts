import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatAgentForTool } from "./agent-sync-format";
import { classifyLocalAgentRecord } from "./local-catalog-compare";

describe("classifyLocalAgentRecord", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-agent-compare-"));
  });

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reports in-sync when local is synced OpenCode shape and repo is canonical", () => {
    const canonical = `---
name: ci-investigator
description: CI helper. Use when checks fail.
mode: subagent
readonly: true
---

Body here.
`;
    const repoPath = path.join(tmp, "repo.md");
    const localPath = path.join(tmp, "local.md");
    fs.writeFileSync(repoPath, canonical, "utf-8");
    fs.writeFileSync(localPath, formatAgentForTool(canonical, "opencode"), "utf-8");
    fs.utimesSync(repoPath, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(localPath, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));

    const result = classifyLocalAgentRecord(localPath, repoPath);
    expect(result.status).toBe("in-sync");
  });

  it("still reports local-newer when content actually differs", () => {
    const repoPath = path.join(tmp, "repo.md");
    const localPath = path.join(tmp, "local.md");
    fs.writeFileSync(repoPath, "repo-only\n", "utf-8");
    fs.writeFileSync(localPath, "local-edit\n", "utf-8");
    fs.utimesSync(repoPath, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.utimesSync(localPath, new Date("2026-05-01T00:00:00Z"), new Date("2026-05-01T00:00:00Z"));

    expect(classifyLocalAgentRecord(localPath, repoPath).status).toBe("local-newer");
  });
});
