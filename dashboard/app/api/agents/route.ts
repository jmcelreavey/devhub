import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { resolveAgentSources } from "@/lib/sync-agents";
import { descriptionFromFrontmatter } from "@/lib/skills-shared";
import { withErrorHandler } from "@/lib/api-utils";

interface AgentInfo {
  name: string;
  description: string | null;
  readOnly: boolean;
}

const AGENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const GET = withErrorHandler(async () => {
  // Merge core agents/shared with plugin-contributed agents (core wins). Plugin agents
  // are read-only here — they're edited in their plugin repo.
  const sources = resolveAgentSources(getRepoRoot(), os.homedir());
  const agents: AgentInfo[] = [];
  for (const [name, src] of sources) {
    let description: string | null = null;
    try {
      description = descriptionFromFrontmatter(fs.readFileSync(src.file, "utf-8"));
    } catch {
      // unreadable agent file — list it without a description
    }
    agents.push({ name, description, readOnly: src.origin !== "core" });
  }

  return NextResponse.json(agents.sort((a, b) => a.name.localeCompare(b.name)));
}, "agents");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as { name?: string; description?: string };
  const raw = body.name?.trim().toLowerCase() ?? "";
  if (!raw || !AGENT_SLUG.test(raw)) {
    return NextResponse.json({ error: "Invalid name - use lowercase letters, numbers, hyphen, underscore." }, { status: 400 });
  }

  const agentsDir = path.join(getRepoRoot(), "agents", "shared");
  const file = path.join(agentsDir, `${raw}.md`);
  const resolvedFile = path.resolve(file);
  if (path.dirname(resolvedFile) !== path.resolve(agentsDir)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (fs.existsSync(resolvedFile)) {
    return NextResponse.json({ error: "Agent already exists" }, { status: 409 });
  }

  fs.mkdirSync(agentsDir, { recursive: true });
  const desc = body.description?.trim() || `Agent ${raw}`;
  const content = `---
name: ${raw}
description: ${desc} Use when <specific trigger for delegation>.
mode: subagent
readonly: false
---

# ${raw}

## When You Are Called

- 

## Rules

- 

`;
  fs.writeFileSync(resolvedFile, content, "utf-8");
  return NextResponse.json({ ok: true, name: raw });
}, "agents");
