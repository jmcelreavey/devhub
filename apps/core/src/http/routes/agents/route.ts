import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getResourceRoot } from "../../../lib/desktop/runtime-paths";
import { resolveAgentSources } from "../../../lib/sync/agents";
import { descriptionFromFrontmatter } from "../../../lib/skills/shared";
import { withErrorHandler } from "../../../lib/api-utils";
import { httpAction } from "../../../lib/actions/http";
import { agentCatalogCreate, agentCatalogCreateInput, agentsCatalogList } from "../../../../../../packages/shared/actions/agents";

interface AgentInfo {
  name: string;
  description: string | null;
  readOnly: boolean;
  /** "core" or "plugin:<name>", so the catalog can be filtered to one plugin. */
  origin: string;
}

export const GET = withErrorHandler(async (req: Request) => httpAction(agentsCatalogList, {
  input: () => ({}),
  context: () => ({ read: listAgents }),
  response: (agents) => Response.json(agents),
})(req), "agents");

function listAgents() {
  // Merge core agents/shared with plugin-contributed agents (core wins). Plugin agents
  // are read-only here — they're edited in their plugin repo.
  const sources = resolveAgentSources(getResourceRoot(), os.homedir());
  const agents: AgentInfo[] = [];
  for (const [name, src] of sources) {
    let description: string | null = null;
    try {
      description = descriptionFromFrontmatter(fs.readFileSync(src.file, "utf-8"));
    } catch {
      // unreadable agent file — list it without a description
    }
    agents.push({ name, description, readOnly: src.origin !== "core", origin: src.origin });
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export const POST = withErrorHandler(async (req: Request) => {
  const body = (await req.json()) as { name?: string; description?: string };
  const raw = body.name?.trim().toLowerCase() ?? "";
  if (!agentCatalogCreateInput.shape.name.safeParse(raw).success) {
    return Response.json({ error: "Invalid name - use lowercase letters, numbers, hyphen, underscore." }, { status: 400 });
  }

  const agentsDir = path.join(getResourceRoot(), "agents", "shared");
  const file = path.join(agentsDir, `${raw}.md`);
  const resolvedFile = path.resolve(file);
  if (path.dirname(resolvedFile) !== path.resolve(agentsDir)) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  if (fs.existsSync(resolvedFile)) {
    return Response.json({ error: "Agent already exists" }, { status: 409 });
  }

  fs.mkdirSync(agentsDir, { recursive: true });
  const desc = body.description?.trim() || `Agent ${raw}`;
  return httpAction(agentCatalogCreate, {
    input: () => ({ name: raw, description: desc }),
    context: () => ({ execute: ({ name, description }) => createAgent(resolvedFile, name, description) }),
    response: (response) => response as Response,
  })(req);
}, "agents");

function createAgent(file: string, name: string, description: string) {
  const content = `---
name: ${name}
description: ${description} Use when <specific trigger for delegation>.
mode: subagent
readonly: false
---

# ${name}

## When You Are Called

- 

## Rules

- 

`;
  fs.writeFileSync(file, content, "utf-8");
  return Response.json({ ok: true, name });
}
