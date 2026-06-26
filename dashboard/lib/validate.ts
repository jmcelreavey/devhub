/**
 * In-process port of scripts/validate.sh — repo integrity checks.
 *
 * The original 378-line bash version checked shell+python syntax and script
 * permissions, which are now gone (the scripts moved into lib/). What
 * remains: skill, persona, notes, gitignore, MCP config, and rubber-duck
 * compatibility checks.
 */
import fs from "node:fs";
import path from "node:path";
import { agentFrontmatterMalformed, agentHasLegacyFrontmatter } from "./agent-sync-format";
import { findRawSecretPath } from "./opencode-secrets";
import { devhubSharedSkillsDir, listSkillDirNames, SKILL_MD } from "./skills-shared";

export interface ValidateOptions {
  emit: (line: string) => void;
  repoRoot: string;
}

export async function validateRepo(opts: ValidateOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  let warnings = 0;
  let errors = 0;

  function ok(msg: string) {
    emit(`  ✓ ${msg}`);
  }
  function warn(msg: string) {
    emit(`  ⚠ ${msg}`);
    warnings++;
  }
  function err(msg: string) {
    emit(`  ✗ ${msg}`);
    errors++;
  }
  function exists(rel: string): boolean {
    return fs.existsSync(path.join(repoRoot, rel));
  }

  // [1] Skills
  emit("[1] Skill validation...");
  const skillsDir = devhubSharedSkillsDir(repoRoot);
  if (!fs.existsSync(skillsDir)) {
    err("skills/shared directory missing");
  } else {
    const names = listSkillDirNames(skillsDir);
    let valid = 0;
    for (const name of names) {
      const skillFile = path.join(skillsDir, name, SKILL_MD);
      const content = fs.readFileSync(skillFile, "utf-8");
      if (!content.startsWith("---")) {
        warn(`${name}: missing YAML frontmatter`);
        continue;
      }
      valid++;
    }
    const missingMd = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !names.includes(e.name));
    for (const entry of missingMd) {
      warn(`${entry.name}: missing ${SKILL_MD}`);
    }
    ok(`${valid}/${names.length + missingMd.length} skills have valid ${SKILL_MD}`);
  }

  // [2] Shared agents
  emit("[2] Shared agent validation...");
  const agentsDir = path.join(repoRoot, "agents", "shared");
  if (!fs.existsSync(agentsDir)) {
    warn("agents/shared directory missing");
  } else {
    const agentFiles = fs
      .readdirSync(agentsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"));
    let withDescription = 0;
    for (const f of agentFiles) {
      const name = f.name.slice(0, -".md".length);
      const content = fs.readFileSync(path.join(agentsDir, f.name), "utf-8");
      if (!content.startsWith("---")) {
        warn(`${name}: missing YAML frontmatter`);
        continue;
      }
      if (agentFrontmatterMalformed(content)) {
        err(`${name}: malformed frontmatter (check closing --- after readonly)`);
        continue;
      }
      if (!/^description:\s*.+/m.test(content)) {
        warn(`${name}: missing description in frontmatter`);
        continue;
      }
      if (!/mode:\s*subagent/m.test(content)) {
        warn(`${name}: expected mode: subagent`);
      }
      if (!/^readonly:\s*(true|false)/m.test(content)) {
        warn(`${name}: missing readonly: true|false (canonical catalog field)`);
      }
      if (agentHasLegacyFrontmatter(content)) {
        warn(`${name}: remove legacy tools:/model: — sync derives per-platform permissions`);
      }
      withDescription++;
    }
    ok(`${withDescription}/${agentFiles.length} shared agent(s) have description frontmatter`);
  }

  // [3] .gitignore coverage
  emit("[3] .gitignore coverage...");
  const giPath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(giPath)) {
    err(".gitignore missing");
  } else {
    const content = fs.readFileSync(giPath, "utf-8");
    const required = ["node_modules", ".next", ".env"];
    for (const pattern of required) {
      if (content.includes(pattern)) ok(`.gitignore covers ${pattern}`);
      else warn(`.gitignore missing pattern: ${pattern}`);
    }
  }

  // [4] AGENTS.md (generated target — should exist with markers after first sync)
  emit("[4] AGENTS.md...");
  if (exists("AGENTS.md")) ok("AGENTS.md present at repo root");
  else warn("AGENTS.md missing — run sync_native_persona to generate");

  // [5] Persona layer files
  emit("[5] Persona layer files...");
  for (const f of [
    "persona/shared-persona.md",
    "persona/identity.txt",
    "persona/deep-preferences.md",
    "skills/shared/deep-preferences/SKILL.md",
  ]) {
    if (exists(f)) ok(f);
    else err(`${f} missing`);
  }

  // [6] Notes system
  emit("[6] Notes system...");
  for (const f of [
    "notes/index.json",
    "notes/learnings/engineering.json",
    "notes/learnings/tools.json",
    "notes/learnings/prompts.json",
    "notes/learnings/projects.json",
  ]) {
    if (exists(f)) ok(f);
    else warn(`${f} missing`);
  }
  for (const d of ["notes/learnings/archive", "notes/sessions"]) {
    if (exists(d)) ok(`${d}/ exists`);
    else warn(`${d}/ missing`);
  }

  // [7] MCP configs (mcp/shared/<name>.json — one file per server)
  emit("[7] MCP server configs...");
  const sharedMcp = path.join(repoRoot, "mcp/shared");
  if (!fs.existsSync(sharedMcp)) {
    err("mcp/shared/ directory missing");
  } else {
    const files = fs
      .readdirSync(sharedMcp, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"));
    if (files.length === 0) warn("mcp/shared/ has no servers");
    let valid = 0;
    let hasNotes = false;
    for (const f of files) {
      const full = path.join(sharedMcp, f.name);
      try {
        const json = JSON.parse(fs.readFileSync(full, "utf-8"));
        if (typeof json?.command !== "string" && typeof json?.url !== "string") {
          warn(`mcp/shared/${f.name}: missing string \`command\` or \`url\``);
          continue;
        }
        valid++;
        if (f.name === "devhub.json") hasNotes = true;
      } catch {
        warn(`mcp/shared/${f.name}: invalid JSON`);
      }
    }
    ok(`${valid}/${files.length} MCP server file(s) valid`);
    if (!hasNotes) warn("mcp/shared/devhub.json missing — run Sync MCP to install it");
  }
  if (exists("mcp-servers/devhub-server/src/mcp.ts")) ok("DevHub MCP server source exists");
  else err("mcp-servers/devhub-server/src/mcp.ts missing");
  if (exists("dashboard/package.json")) ok("Dashboard package.json exists");
  else err("dashboard/package.json missing");

  // [8] OpenCode shared config — parses + no raw secrets
  emit("[8] OpenCode shared config...");
  const ocFile = path.join(repoRoot, "opencode/shared/opencode.json");
  if (!fs.existsSync(ocFile)) {
    warn("opencode/shared/opencode.json missing — run Collect from local or Sync OpenCode");
  } else {
    try {
      const oc = JSON.parse(fs.readFileSync(ocFile, "utf-8"));
      const rawSecret = findRawSecretPath(oc);
      if (rawSecret) err(`opencode/shared/opencode.json: raw secret at ${rawSecret} (use {env:VAR})`);
      else ok("opencode/shared/opencode.json valid; secrets are {env:VAR} references");
    } catch {
      err("opencode/shared/opencode.json: invalid JSON");
    }
  }

  // [9] Rubber-duck skill compatibility (sanity check that it's persona-agnostic)
  emit("[9] Rubber-duck skill compatibility...");
  const rd = path.join(repoRoot, "skills/shared/rubber-duck/SKILL.md");
  if (fs.existsSync(rd)) {
    const c = fs.readFileSync(rd, "utf-8");
    if (/L0|L1|L2/.test(c)) ok("rubber-duck skill is persona-agnostic");
    else warn("rubber-duck skill: layer-tier hints not found");
    if (/##\s/.test(c)) ok("rubber-duck has standard skill sections");
    else warn("rubber-duck: missing standard sections");
  } else {
    warn("rubber-duck skill missing");
  }

  emit("=== Results ===");
  if (errors === 0 && warnings === 0) emit("All checks passed!");
  else emit(`${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}
