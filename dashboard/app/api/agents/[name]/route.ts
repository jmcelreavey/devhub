import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { resolveAgentSources } from "@/lib/sync-agents";

const AGENT_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const READ_ONLY_PLUGIN_AGENT_ERROR =
  "Plugin agents are read-only in DevHub — edit them in the plugin repo.";

function resolveAgentFile(name: string): string | null {
  const agentsDir = path.join(getRepoRoot(), "agents", "shared");
  const file = path.join(agentsDir, `${name}.md`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(agentsDir)) return null;
  return resolved;
}

/** Resolve an agent across core + plugin sources (for read). */
function resolveAgentEntry(name: string): { file: string; readOnly: boolean } | null {
  const src = resolveAgentSources(getRepoRoot(), os.homedir()).get(name);
  if (!src) return null;
  return { file: src.file, readOnly: src.origin !== "core" };
}

/** Guard mutations: 404 if unknown, 403 if plugin-owned. null = ok to mutate core. */
function mutationBlock(name: string): NextResponse | null {
  const entry = resolveAgentEntry(name);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (entry.readOnly) return NextResponse.json({ error: READ_ONLY_PLUGIN_AGENT_ERROR }, { status: 403 });
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const entry = resolveAgentEntry(name);
  if (!entry || !fs.existsSync(entry.file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const content = fs.readFileSync(entry.file, "utf-8");
  const stat = fs.statSync(entry.file);
  return NextResponse.json({ name, content, modified: stat.mtimeMs, readOnly: entry.readOnly });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { content?: string };
  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }
  fs.writeFileSync(file, body.content, "utf-8");
  const stat = fs.statSync(file);
  return NextResponse.json({ ok: true, name, modified: stat.mtimeMs });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return NextResponse.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim().toLowerCase();
  if (!AGENT_SLUG.test(raw)) {
    return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
  }
  if (raw === name) {
    return NextResponse.json({ ok: true, name });
  }

  const agentsDir = path.join(getRepoRoot(), "agents", "shared");
  const newFile = path.join(agentsDir, `${raw}.md`);
  if (path.resolve(newFile) !== path.join(path.resolve(agentsDir), `${raw}.md`)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  if (fs.existsSync(newFile)) {
    return NextResponse.json({ error: "Name already taken" }, { status: 409 });
  }

  fs.renameSync(file, newFile);
  return NextResponse.json({ ok: true, name: raw });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const blocked = mutationBlock(name);
  if (blocked) return blocked;
  const file = resolveAgentFile(name);
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  fs.rmSync(file, { force: true });
  return NextResponse.json({ ok: true, name });
}
