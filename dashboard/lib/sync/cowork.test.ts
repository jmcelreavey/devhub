import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { SKILL_MD } from "@/lib/skills/shared";
import {
  buildCoworkPlugin,
  COWORK_EXCLUDED_SERVERS,
  coworkBundlePath,
  verifyCoworkPlugin,
} from "@/lib/sync/cowork";
import { TOOL_DIRS } from "@/lib/sync/skills";

describe("buildCoworkPlugin", () => {
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
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cowork-repo-"));
    aiTools = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cowork-aitools-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cowork-home-"));
    process.env.HOME = home;
    process.env.AI_TOOLS_ROOT = aiTools;
    process.env.AI_TOOLS_REFRESH_ON_SYNC = "0";

    fs.mkdirSync(path.join(repo, "skills/shared/local-skill/references"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "skills/shared/local-skill", SKILL_MD),
      "---\nname: local-skill\ndescription: local\n---\nbody local\n",
    );
    fs.writeFileSync(
      path.join(repo, "skills/shared/local-skill/references/deep.md"),
      "nested reference\n",
    );

    fs.mkdirSync(path.join(aiTools, "skills/upstream-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(aiTools, "skills/upstream-skill", SKILL_MD),
      "---\nname: upstream-skill\ndescription: upstream\n---\nbody upstream\n",
    );

    fs.mkdirSync(path.join(repo, "agents/shared"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "agents/shared/reviewer.md"),
      "---\nname: reviewer\ndescription: reviews things\n---\nreviewer body\n",
    );

    fs.mkdirSync(path.join(repo, "mcp/shared"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "mcp/shared/devhub.json"),
      JSON.stringify({
        command: "REPO_ROOT/mcp-servers/devhub-server/node_modules/.bin/tsx",
        args: ["REPO_ROOT/mcp-servers/devhub-server/src/mcp.ts"],
        env: { NOTES_DIR: "REPO_ROOT/notes" },
      }),
    );
  }

  function entries(bundle: string): string[] {
    return new AdmZip(bundle).getEntries().map((e) => e.entryName);
  }

  function readEntry(bundle: string, name: string): string {
    const entry = new AdmZip(bundle).getEntry(name);
    if (!entry) throw new Error(`missing entry: ${name}`);
    return entry.getData().toString("utf-8");
  }

  it("bundles skills, agents and MCP servers into an installable plugin", async () => {
    setup();
    const lines: string[] = [];
    const result = await buildCoworkPlugin({ repoRoot: repo, emit: (l) => lines.push(l) });

    expect(result.code).toBe(0);
    expect(result.skills).toBe(2);
    expect(result.agents).toBe(1);

    const bundle = coworkBundlePath(repo);
    expect(result.bundlePath).toBe(bundle);
    expect(fs.existsSync(bundle)).toBe(true);

    const names = entries(bundle);
    expect(names).toContain(".claude-plugin/plugin.json");
    expect(names).toContain(".mcp.json");
    expect(names).toContain("skills/local-skill/SKILL.md");
    expect(names).toContain("agents/reviewer.md");

    expect(readEntry(bundle, "skills/local-skill/SKILL.md")).toContain("body local");
  });

  it("carries nested skill reference files into the bundle", async () => {
    setup();
    const bundle = coworkBundlePath(repo);
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });

    expect(entries(bundle)).toContain("skills/local-skill/references/deep.md");
    expect(readEntry(bundle, "skills/local-skill/references/deep.md")).toContain("nested reference");
  });

  it("rewrites ai-tools frontmatter names the same way other sync targets do", async () => {
    setup();
    const bundle = coworkBundlePath(repo);
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });

    const upstream = readEntry(bundle, "skills/bi-upstream-skill/SKILL.md");
    expect(upstream).toContain("name: bi-upstream-skill");
    expect(upstream).toContain("body upstream");
  });

  it("substitutes REPO_ROOT in MCP server definitions", async () => {
    setup();
    const bundle = coworkBundlePath(repo);
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });

    const mcp = JSON.parse(readEntry(bundle, ".mcp.json")) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(mcp.mcpServers.devhub.command).toBe(
      path.join(repo, "mcp-servers/devhub-server/node_modules/.bin/tsx"),
    );
    expect(mcp.mcpServers.devhub.env.NOTES_DIR).toBe(path.join(repo, "notes"));
    expect(JSON.stringify(mcp)).not.toContain("REPO_ROOT");
  });

  it("excludes servers that would shadow or hijack Cowork's own tools", async () => {
    setup();
    for (const name of COWORK_EXCLUDED_SERVERS) {
      fs.writeFileSync(
        path.join(repo, "mcp/shared", `${name}.json`),
        JSON.stringify({ command: `/usr/local/bin/${name}` }),
      );
    }

    const bundle = coworkBundlePath(repo);
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });

    const mcp = JSON.parse(readEntry(bundle, ".mcp.json")) as { mcpServers: Record<string, unknown> };
    for (const name of COWORK_EXCLUDED_SERVERS) {
      expect(mcp.mcpServers).not.toHaveProperty(name);
    }
    expect(mcp.mcpServers).toHaveProperty("devhub");
  });

  it("skips servers explicitly disabled in the catalog", async () => {
    setup();
    fs.writeFileSync(
      path.join(repo, "mcp/shared/turned-off.json"),
      JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
    );

    const bundle = coworkBundlePath(repo);
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });

    const mcp = JSON.parse(readEntry(bundle, ".mcp.json")) as { mcpServers: Record<string, unknown> };
    expect(mcp.mcpServers).not.toHaveProperty("turned-off");
  });

  it("honours skill and agent exclusions", async () => {
    setup();
    const bundle = coworkBundlePath(repo);
    const result = await buildCoworkPlugin({
      repoRoot: repo,
      emit: () => {},
      excludeSkills: ["local-skill"],
      excludeAgents: ["reviewer"],
    });

    expect(result.skills).toBe(1);
    expect(result.agents).toBe(0);
    const names = entries(bundle);
    expect(names).not.toContain("skills/local-skill/SKILL.md");
    expect(names).not.toContain("agents/reviewer.md");
  });

  it("skips rezipping when nothing changed, and rebuilds when a skill does", async () => {
    setup();
    const bundle = coworkBundlePath(repo);

    const first = await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });
    expect(first.unchanged).toBe(false);

    const second = await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });
    expect(second.unchanged).toBe(true);

    fs.writeFileSync(
      path.join(repo, "skills/shared/local-skill", SKILL_MD),
      "---\nname: local-skill\ndescription: local\n---\nbody changed\n",
    );
    const third = await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });
    expect(third.unchanged).toBe(false);
    expect(readEntry(bundle, "skills/local-skill/SKILL.md")).toContain("body changed");
  });

  it("writes nothing on a dry run", async () => {
    setup();
    const lines: string[] = [];
    const result = await buildCoworkPlugin({ repoRoot: repo, emit: (l) => lines.push(l), dryRun: true });

    expect(result.code).toBe(0);
    expect(result.bundlePath).toBeNull();
    expect(fs.existsSync(coworkBundlePath(repo))).toBe(false);
    expect(lines.join("\n")).toContain("DRY RUN");
  });

  it("does not leave the repo checkout dirty (output is under gitignored .devhub)", async () => {
    setup();
    await buildCoworkPlugin({ repoRoot: repo, emit: () => {} });
    expect(coworkBundlePath(repo).startsWith(path.join(repo, ".devhub"))).toBe(true);
  });
});

describe("verifyCoworkPlugin", () => {
  let repo: string;

  afterEach(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  it("reports a missing bundle rather than passing vacuously", () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cowork-verify-"));
    const result = verifyCoworkPlugin(repo);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("Bundle not found");
  });

  it("flags a skill directory with no SKILL.md", () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cowork-verify-"));
    const bundle = coworkBundlePath(repo);
    fs.mkdirSync(path.dirname(bundle), { recursive: true });

    const zip = new AdmZip();
    zip.addFile(".claude-plugin/plugin.json", Buffer.from('{"name":"devhub-cowork"}'));
    zip.addFile(".mcp.json", Buffer.from('{"mcpServers":{}}'));
    zip.addFile("skills/broken/notes.md", Buffer.from("no SKILL.md here"));
    zip.writeZip(bundle);

    const result = verifyCoworkPlugin(repo);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("Skill missing SKILL.md: broken");
  });
});

describe("cowork is not a TOOL_DIRS copy target", () => {
  // Cowork reads skills only from installed plugins. A TOOL_DIRS entry would make
  // verifySync() check <root>/<skill>/SKILL.md and report success for skills Cowork
  // cannot see, which is worse than not syncing at all.
  it("stays out of TOOL_DIRS so verifySync cannot report false health", () => {
    expect(Object.keys(TOOL_DIRS)).not.toContain("cowork");
    expect(Object.values(TOOL_DIRS).join(" ")).not.toContain("local-agent-mode-sessions");
  });
});
