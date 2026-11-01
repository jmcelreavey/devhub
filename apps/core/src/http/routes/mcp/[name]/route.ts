import { mcpCatalogDelete } from "../../../../../../../packages/shared/actions/assets";
import { mcpCatalogRename } from "../../../../../../../packages/shared/actions/assets";
import { mcpCatalogSave } from "../../../../../../../packages/shared/actions/assets";
import { mcpCatalogRead } from "../../../../../../../packages/shared/actions/assets";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { deletePersonalMcpServer, resolvePersonalMcpFile } from "../../../../lib/mcp/personal";
import { sharedMcpDir } from "../../../../lib/sync/mcp";
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
  const dir = sharedMcpDir(getResourceRoot());
  const file = path.join(dir, `${name}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(dir)) return null;
  return { file: resolved, dir: path.resolve(dir) };
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);

  return await mcpCatalogRead.handler({ name, scope }, { execute: async () => {
    const target = resolveServerFile(name, scope);
    if (!target) return Response.json({ error: "Invalid name" }, { status: 400 });
    if (!fs.existsSync(target.file)) return Response.json({ error: "Not found" }, { status: 404 });
    const content = fs.readFileSync(target.file, "utf-8");
    const stat = fs.statSync(target.file);
    return Response.json({ name, scope, content, modified: stat.mtimeMs });
  } }) as Response;
}

export async function PUT(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  const target = resolveServerFile(name, scope);
  if (!target) return Response.json({ error: "Invalid name" }, { status: 400 });
  const body = await req.json();
  const { content } = body as { content?: string };
  if (typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "Content required" }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return Response.json(
      { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Response.json({ error: "Server JSON must be an object." }, { status: 400 });
  }
  if (typeof (parsed as { command?: unknown }).command !== "string" && typeof (parsed as { url?: unknown }).url !== "string") {
    return Response.json({ error: "Server JSON must have a string `command` or `url`." }, { status: 400 });
  }

  return await mcpCatalogSave.handler({ name, scope, content }, { execute: async () => {
    fs.mkdirSync(target.dir, { recursive: true });
    fs.writeFileSync(target.file, content.endsWith("\n") ? content : content + "\n", "utf-8");
    const stat = fs.statSync(target.file);
    return Response.json({ ok: true, name, scope, modified: stat.mtimeMs });
  } }) as Response;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);
  const target = resolveServerFile(name, scope);
  if (!target) return Response.json({ error: "Invalid name" }, { status: 400 });
  if (!fs.existsSync(target.file)) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { newName } = body as { newName?: string };
  if (typeof newName !== "string" || !newName.trim()) {
    return Response.json({ error: "newName required" }, { status: 400 });
  }
  const raw = newName.trim();
  if (!SERVER_SLUG.test(raw)) {
    return Response.json({ error: "Invalid name format" }, { status: 400 });
  }

  return await mcpCatalogRename.handler({ name, scope, newName: raw }, { execute: async () => {
    if (raw === name) {
      return Response.json({ ok: true, name, scope });
    }

    const newTarget = resolveServerFile(raw, scope);
    if (!newTarget) return Response.json({ error: "Invalid new name" }, { status: 400 });
    if (fs.existsSync(newTarget.file)) {
      return Response.json({ error: "Name already taken" }, { status: 409 });
    }

    fs.renameSync(target.file, newTarget.file);
    return Response.json({ ok: true, name: raw, scope });
  } }) as Response;
}

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const scope = scopeFromRequest(req);

  return await mcpCatalogDelete.handler({ name, scope }, { execute: async () => {
    if (scope === "personal") {
      if (!deletePersonalMcpServer(os.homedir(), name)) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ ok: true, name, scope });
    }
    const target = resolveServerFile(name, "repo");
    if (!target) return Response.json({ error: "Invalid name" }, { status: 400 });
    if (!fs.existsSync(target.file)) return Response.json({ error: "Not found" }, { status: 404 });
    fs.rmSync(target.file, { force: true });
    return Response.json({ ok: true, name, scope });
  } }) as Response;
}
