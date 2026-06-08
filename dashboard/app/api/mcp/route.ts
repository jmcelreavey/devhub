import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { withErrorHandler } from "@/lib/api-utils";
import {
  listPersonalMcpServerNames,
  readPersonalMcpServer,
  writePersonalMcpServer,
} from "@/lib/mcp-personal";
import {
  listSharedMcpServerNames,
  readSharedMcpServer,
  sharedMcpDir,
  type SharedMcpServer,
} from "@/lib/sync-mcp";

export const dynamic = "force-dynamic";

export type McpCatalogScope = "repo" | "personal";

interface ServerListItem {
  name: string;
  description: string | null;
  command: string;
  scope: McpCatalogScope;
}

const SERVER_SLUG = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

function toListItem(name: string, s: SharedMcpServer, scope: McpCatalogScope): ServerListItem {
  return {
    name,
    description: s.description ?? null,
    command: s.command ?? s.url ?? "",
    scope,
  };
}

export const GET = withErrorHandler(async () => {
  const repoRoot = getRepoRoot();
  const home = os.homedir();
  const out: ServerListItem[] = [];
  const seen = new Set<string>();

  for (const name of listSharedMcpServerNames(repoRoot)) {
    const s = readSharedMcpServer(repoRoot, name);
    if (!s) continue;
    seen.add(name);
    out.push(toListItem(name, s, "repo"));
  }
  for (const name of listPersonalMcpServerNames(home)) {
    if (seen.has(name)) continue;
    const s = readPersonalMcpServer(home, name);
    if (!s) continue;
    out.push(toListItem(name, s, "personal"));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(out);
}, "mcp");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as {
    name?: string;
    command?: string;
    description?: string;
    scope?: McpCatalogScope;
  };
  const raw = body.name?.trim() ?? "";
  if (!raw || !SERVER_SLUG.test(raw)) {
    return NextResponse.json(
      { error: "Invalid name — use letters, numbers, dot, hyphen, underscore (e.g. notes)." },
      { status: 400 },
    );
  }
  const scope: McpCatalogScope = body.scope === "personal" ? "personal" : "repo";
  const payload: SharedMcpServer = {
    command: typeof body.command === "string" && body.command.trim() ? body.command.trim() : "npx",
    args: [],
    env: {},
    ...(body.description?.trim() ? { description: body.description.trim() } : {}),
  };

  if (scope === "personal") {
    const home = os.homedir();
    if (readPersonalMcpServer(home, raw) || readSharedMcpServer(getRepoRoot(), raw)) {
      return NextResponse.json({ error: "Server already exists" }, { status: 409 });
    }
    writePersonalMcpServer(home, raw, payload);
    return NextResponse.json({ ok: true, name: raw, scope: "personal" });
  }

  const dir = sharedMcpDir(getRepoRoot());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${raw}.json`);
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(dir)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Server already exists" }, { status: 409 });
  }
  if (scope === "repo") {
    payload.command =
      typeof body.command === "string" && body.command.trim()
        ? body.command.trim()
        : "REPO_ROOT/path/to/binary";
  }
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  return NextResponse.json({ ok: true, name: raw, scope: "repo" });
}, "mcp");
