import { NextResponse, type NextRequest } from "next/server";
import {
  detectUnmergedFiles,
  readConflictFileContent,
  resolveConflictFile,
} from "@/lib/git-conflicts";
import { withScannedRepo, type RepoParams } from "../_shared";

export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const conflicts = detectUnmergedFiles(repoRoot).map((c) => ({
    ...c,
    content: readConflictFileContent(repoRoot, c.path),
  }));

  return NextResponse.json({ conflicts, count: conflicts.length });
}

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as { path?: string; content?: string };
  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }

  const result = resolveConflictFile(repoRoot, body.path, body.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const remaining = detectUnmergedFiles(repoRoot);
  return NextResponse.json({ ok: true, remaining: remaining.length });
}
