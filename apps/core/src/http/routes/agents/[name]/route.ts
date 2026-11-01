import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { resolveAgentSources } from "../../../../lib/sync/agents";
import { httpAction } from "../../../../lib/actions/http";
import { agentCatalogDelete, agentCatalogRead, agentCatalogRename, agentCatalogRenameInput, agentCatalogSave, agentCatalogSaveInput } from "../../../../../../../packages/shared/actions/agents";

const READ_ONLY_PLUGIN_AGENT_ERROR =
  "Plugin agents are read-only in DevHub — edit them in the plugin repo.";

function resolveAgentFile(name: string): string | null {
  const agentsDir = path.join(getResourceRoot(), "agents", "shared");
  const file = path.join(agentsDir, `${name}.md`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(agentsDir)) return null;
  return resolved;
}

/** Resolve an agent across core + plugin sources (for read). */
function resolveAgentEntry(name: string): { file: string; readOnly: boolean } | null {
  const src = resolveAgentSources(getResourceRoot(), os.homedir()).get(name);
  if (!src) return null;
  return { file: src.file, readOnly: src.origin !== "core" };
}

/** Guard mutations: 404 if unknown, 403 if plugin-owned. null = ok to mutate core. */
function mutationBlock(name: string): Response | null {
  const entry = resolveAgentEntry(name);
  if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
  if (entry.readOnly) return Response.json({ error: READ_ONLY_PLUGIN_AGENT_ERROR }, { status: 403 });
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return httpAction(agentCatalogRead, {
    input: () => ({ name }),
    context: () => ({ execute: ({ name }) => readAgent(name) }),
    response: (response) => response as Response,
  })(_req);
}

function readAgent(name: string) {
  const entry = resolveAgentEntry(name);
  if (!entry || !fs.existsSync(entry.file)) return Response.json({ error: "Not found" }, { status: 404 });
  const content = fs.readFileSync(entry.file, "utf-8");
  const stat = fs.statSync(entry.file);
  return Response.json({ name, content, modified: stat.mtimeMs, readOnly: entry.readOnly });
}

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { content?: string };
  const content = agentCatalogSaveInput.shape.content.safeParse(body.content);
  if (!content.success) return Response.json({ error: "Content required" }, { status: 400 });
  return httpAction(agentCatalogSave, {
    input: () => ({ name, content: content.data }),
    context: () => ({ execute: ({ name, content }) => saveAgent(file, name, content) }),
    response: (response) => response as Response,
  })(req);
}

function saveAgent(file: string, name: string, content: string) {
  fs.writeFileSync(file, content, "utf-8");
  const stat = fs.statSync(file);
  return Response.json({ ok: true, name, modified: stat.mtimeMs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return Response.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim().toLowerCase();
  if (!agentCatalogRenameInput.shape.newName.safeParse(raw).success) {
    return Response.json({ error: "Invalid name format" }, { status: 400 });
  }
  return httpAction(agentCatalogRename, {
    input: () => ({ name, newName: raw }),
    context: () => ({ execute: ({ name, newName }) => renameAgent(file, name, newName) }),
    response: (response) => response as Response,
  })(req);
}

function renameAgent(file: string, name: string, targetName: string) {
  if (targetName === name) {
    return Response.json({ ok: true, name });
  }

  const agentsDir = path.join(getResourceRoot(), "agents", "shared");
  const newFile = path.join(agentsDir, `${targetName}.md`);
  if (path.resolve(newFile) !== path.join(path.resolve(agentsDir), `${targetName}.md`)) {
    return Response.json({ error: "Invalid name" }, { status: 400 });
  }
  if (fs.existsSync(newFile)) {
    return Response.json({ error: "Name already taken" }, { status: 409 });
  }

  fs.renameSync(file, newFile);
  return Response.json({ ok: true, name: targetName });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return httpAction(agentCatalogDelete, {
    input: () => ({ name }),
    context: () => ({ execute: ({ name }) => deleteAgent(name) }),
    response: (response) => response as Response,
  })(_req);
}

function deleteAgent(name: string) {
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return Response.json({ error: "Not found" }, { status: 404 });
  fs.rmSync(file, { force: true });
  return Response.json({ ok: true, name });
}
