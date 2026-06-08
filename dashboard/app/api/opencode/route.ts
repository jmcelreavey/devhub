import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { withErrorHandler } from "@/lib/api-utils";
import {
  listOpencodeSecretEnvNames,
  sharedOpencodeConfigPath,
} from "@/lib/sync-opencode-config";
import { findRawSecretPath } from "@/lib/opencode-secrets";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const repoRoot = getRepoRoot();
  const file = sharedOpencodeConfigPath(repoRoot);
  const exists = fs.existsSync(file);
  const content = exists ? fs.readFileSync(file, "utf-8") : "";
  const envNames = listOpencodeSecretEnvNames(repoRoot);
  const unresolved = envNames.filter((n) => !(process.env[n] ?? "").trim());
  return NextResponse.json({ exists, content, envNames, unresolved });
}, "opencode");

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as { content?: string };
  const content = body.content;
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
    return NextResponse.json({ error: "OpenCode config must be a JSON object." }, { status: 400 });
  }
  const rawPath = findRawSecretPath(parsed);
  if (rawPath) {
    return NextResponse.json(
      { error: `Refusing to save a raw secret at "${rawPath}". Use an {env:VAR} placeholder instead.` },
      { status: 400 },
    );
  }
  const file = sharedOpencodeConfigPath(getRepoRoot());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : content + "\n", "utf-8");
  return NextResponse.json({ ok: true });
}, "opencode");
