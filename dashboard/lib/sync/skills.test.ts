import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_MD } from "@/lib/skills/shared";
import { syncSkills, TOOL_DIRS } from "@/lib/sync/skills";

describe("syncSkills merged catalog", () => {
  const prev = {
    HOME: process.env.HOME,
    AI_TOOLS_ROOT: process.env.AI_TOOLS_ROOT,
    AI_TOOLS_REFRESH_ON_SYNC: process.env.AI_TOOLS_REFRESH_ON_SYNC,
  };

  let repo: string;
  let aiTools: string;
  let home: string;

  afterEach(() => {
    for (const [key, val] of Object.entries(prev)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    for (const dir of [repo, aiTools, home]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup() {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-repo-"));
    aiTools = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-aitools-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-home-"));
    process.env.HOME = home;
    process.env.AI_TOOLS_ROOT = aiTools;
    process.env.AI_TOOLS_REFRESH_ON_SYNC = "0";

    fs.mkdirSync(path.join(repo, "skills/shared/local-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "skills/shared/local-skill", SKILL_MD),
      "---\ndescription: local\n---\nbody local\n",
    );

    fs.mkdirSync(path.join(aiTools, "skills/upstream-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(aiTools, "skills/upstream-skill", SKILL_MD),
      "---\nname: upstream-skill\ndescription: upstream\n---\nbody upstream\n",
    );
  }

  it("syncs devhub and ai-tools skills to a tool directory", async () => {
    setup();
    const lines: string[] = [];
    const code = await syncSkills({
      repoRoot: repo,
      emit: (l) => lines.push(l),
      refreshAiTools: false,
      tool: "codex",
    });
    expect(code).toBe(0);

    const dst = path.join(home, ".codex/skills");
    expect(fs.readFileSync(path.join(dst, "local-skill", SKILL_MD), "utf-8")).toContain("body local");
    const upstream = fs.readFileSync(path.join(dst, "bi-upstream-skill", SKILL_MD), "utf-8");
    expect(upstream).toContain("name: bi-upstream-skill");
    expect(upstream).toContain("body upstream");
  });

  it("prunes tool dirs for skills removed from the merged catalog", async () => {
    setup();
    const codex = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(codex, "stale-skill"), { recursive: true });
    fs.writeFileSync(path.join(codex, "stale-skill", SKILL_MD), "stale\n");

    await syncSkills({
      repoRoot: repo,
      emit: () => {},
      refreshAiTools: false,
      tool: "codex",
      prune: true,
    });

    expect(fs.existsSync(path.join(codex, "stale-skill"))).toBe(false);
    expect(fs.existsSync(path.join(codex, "bi-upstream-skill"))).toBe(true);
  });

  it("preserves extra tool-dir skills unless prune is enabled", async () => {
    setup();
    const codex = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(codex, "stale-skill"), { recursive: true });
    fs.writeFileSync(path.join(codex, "stale-skill", SKILL_MD), "stale\n");

    await syncSkills({
      repoRoot: repo,
      emit: () => {},
      refreshAiTools: false,
      tool: "codex",
    });

    expect(fs.existsSync(path.join(codex, "stale-skill"))).toBe(true);
  });

  it("does not sync or prune excluded skills", async () => {
    setup();
    const codex = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(codex, "bi-upstream-skill"), { recursive: true });
    fs.writeFileSync(path.join(codex, "bi-upstream-skill", SKILL_MD), "kept-old-version\n");

    fs.writeFileSync(
      path.join(aiTools, "skills/upstream-skill", SKILL_MD),
      "---\nname: upstream-skill\ndescription: upstream\n---\nbody upstream-new\n",
    );

    await syncSkills({
      repoRoot: repo,
      emit: () => {},
      refreshAiTools: false,
      tool: "codex",
      prune: true,
      excludeSkills: ["bi-upstream-skill"],
    });

    expect(fs.readFileSync(path.join(codex, "bi-upstream-skill", SKILL_MD), "utf-8")).toBe(
      "kept-old-version\n",
    );
    expect(fs.existsSync(path.join(codex, "local-skill"))).toBe(true);
  });

  it("does not prune excluded local-only skills missing from catalog", async () => {
    setup();
    const codex = path.join(home, ".codex/skills");
    fs.mkdirSync(path.join(codex, "orphan-local"), { recursive: true });
    fs.writeFileSync(path.join(codex, "orphan-local", SKILL_MD), "keep me\n");

    await syncSkills({
      repoRoot: repo,
      emit: () => {},
      refreshAiTools: false,
      tool: "codex",
      prune: true,
      excludeSkills: ["orphan-local"],
    });

    expect(fs.readFileSync(path.join(codex, "orphan-local", SKILL_MD), "utf-8")).toBe("keep me\n");
    expect(fs.existsSync(path.join(codex, "stale-skill"))).toBe(false);
  });
});

describe("Cursor skill sync targets", () => {
  it("writes user skills to ~/.cursor/skills and ~/.agents/skills, not skills-cursor", () => {
    expect(TOOL_DIRS.cursor).toBe(".cursor/skills");
    expect(TOOL_DIRS.agents).toBe(".agents/skills");
    expect(TOOL_DIRS.chatgpt).toBe(".codex/skills");
    expect(TOOL_DIRS.chatgpt).toBe(TOOL_DIRS.codex);
    expect(TOOL_DIRS).not.toHaveProperty("cursor-skills-cursor");
    expect(Object.values(TOOL_DIRS).join(" ")).not.toContain("skills-cursor");
  });
});

describe("syncSkills vendor gate", () => {
  const prev = {
    HOME: process.env.HOME,
    AI_TOOLS_ROOT: process.env.AI_TOOLS_ROOT,
    AI_TOOLS_REFRESH_ON_SYNC: process.env.AI_TOOLS_REFRESH_ON_SYNC,
  };
  let repo: string;
  let aiTools: string;
  let home: string;

  afterEach(() => {
    for (const [key, val] of Object.entries(prev)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    for (const dir of [repo, aiTools, home]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupVendor(skillBody: string, extraFiles?: Record<string, string>) {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-vendor-"));
    aiTools = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-aitools-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-sync-home-"));
    process.env.HOME = home;
    process.env.AI_TOOLS_ROOT = aiTools;
    process.env.AI_TOOLS_REFRESH_ON_SYNC = "0";
    fs.mkdirSync(path.join(repo, "skills/shared/local-skill"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/local-skill", SKILL_MD), "---\ndescription: local\n---\n");
    fs.mkdirSync(path.join(repo, "skills/vendor/bad-vendor"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/vendor/bad-vendor", SKILL_MD), skillBody);
    for (const [rel, body] of Object.entries(extraFiles ?? {})) {
      const full = path.join(repo, "skills/vendor/bad-vendor", rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  }

  it("refuses to sync a vendored skill missing provenance", async () => {
    setupVendor("---\ndescription: nope\n---\n");
    const lines: string[] = [];
    const code = await syncSkills({
      repoRoot: repo,
      emit: (l) => lines.push(l),
      refreshAiTools: false,
      tool: "codex",
    });
    expect(code).toBe(1);
    expect(fs.existsSync(path.join(home, ".codex/skills/bad-vendor"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".codex/skills/local-skill"))).toBe(true);
    expect(lines.join("\n")).toMatch(/missing provenance/);
  });

  it("counts vendor separately from DevHub in the summary", async () => {
    setupVendor(`---
name: good-vendor
description: A vendored skill.
license: Apache-2.0
metadata:
  author: "Upstream"
  version: "1.0.0"
  source: "https://example.com"
---
`);
    fs.renameSync(
      path.join(repo, "skills/vendor/bad-vendor"),
      path.join(repo, "skills/vendor/good-vendor"),
    );
    const lines: string[] = [];
    const code = await syncSkills({
      repoRoot: repo,
      emit: (l) => lines.push(l),
      refreshAiTools: false,
      tool: "codex",
    });
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("1 vendor"))).toBe(true);
    expect(lines.some((l) => l.includes("SYNCED [vendor]: good-vendor"))).toBe(true);
  });
});
