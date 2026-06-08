import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { deletePersonalMcpServer, resolvePersonalMcpFile } from "@/lib/mcp-personal";
import { sharedMcpDir } from "@/lib/sync-mcp";
import type { McpCatalogScope } from "../route";

const SERVER_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

function scopeFromRequest(req: Request): McpCatalogScope {
  const url = new URL(req.url);
  return url.searchParams.get("scope") === "personal" ? "personal" : "repo";
}

function resolveServerFile(name: string, scope: McpCatalogScope): { file: string; dir: string } | null {
  if (!SERVER_SLUG.test(name)) return null;
  if (scope === "personal") {
    const file = resolvePersonalMcpFile(os.homedir(), name);
    if (!file) return null;
    return { file, dir: path.dirname(file) };
  }
  const dir = sharedMcpDir(getRepoRoot());
  const file = path.join(dir, `${name}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(dir)) return null;
  return { file: resolved, dir: path.resolve(dir) };
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  const target = resolveServerFile(name, scope);
  if (!target) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  if (!fs.existsSync(target.file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const content = fs.readFileSync(target.file, "utf-8");
  const stat = fs.statSync(target.file);
  return NextResponse.json({ name, scope, content, modified: stat.mtimeMs });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  const target = resolveServerFile(name, scope);
  if (!target) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  const body = await req.json();
  const { content } = body as { content?: string };
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return NextResponse.json(
      { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Server JSON must be an object." }, { status: 400 });
  }
  if (typeof (parsed as { command?: unknown }).command !== "string" && typeof (parsed as { url?: unknown }).url !== "string") {
    return NextResponse.json({ error: "Server JSON must have a string `command` or `url`." }, { status: 400 });
  }
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.file, content.endsWith("\n") ? content : content + "\n", "utf-8");
  const stat = fs.statSync(target.file);
  return NextResponse.json({ ok: true, name, scope, modified: stat.mtimeMs });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  const target = resolveServerFile(name, scope);
  if (!target) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  if (!fs.existsSync(target.file)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return NextResponse.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim();
  if (!SERVER_SLUG.test(raw)) {
    return NextResponse.json({ error: "Invalid name format" }, { status: 400 });
  }
  if (raw === name) {
    return NextResponse.json({ ok: true, name, scope });
  }

  const newTarget = resolveServerFile(raw, scope);
  if (!newTarget) return NextResponse.json({ error: "Invalid new name" }, { status: 400 });
  if (fs.existsSync(newTarget.file)) {
    return NextResponse.json({ error: "Name already taken" }, { status: 409 });
  }

  fs.renameSync(target.file, newTarget.file);
  return NextResponse.json({ ok: true, name: raw, scope });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  if (scope === "personal") {
    if (!deletePersonalMcpServer(os.homedir(), name)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, name, scope });
  }
  const target = resolveServerFile(name, "repo");
  if (!target) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  if (!fs.existsSync(target.file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  fs.rmSync(target.file, { force: true });
  return NextResponse.json({ ok: true, name, scope });
}
