import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import {
  detectGitConflicts,
  readConflictFileContent,
  resolveConflictFile,
} from "@/lib/git-conflicts";
import { getRepoRoot } from "@/lib/notes-dir";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const repoRoot = getRepoRoot();
  const conflicts = detectGitConflicts(repoRoot);
  return NextResponse.json({
    conflicts: conflicts.map((c) => ({
      ...c,
      content: readConflictFileContent(repoRoot, c.path),
    })),
    count: conflicts.length,
  });
}, "git conflicts");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as { path?: string; content?: string };
  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }
  const result = resolveConflictFile(getRepoRoot(), body.path, body.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const remaining = detectGitConflicts(getRepoRoot());
  return NextResponse.json({ ok: true, remaining: remaining.length });
}, "git conflicts resolve");
