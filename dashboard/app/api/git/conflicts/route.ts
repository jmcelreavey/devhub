import { parseBody } from "@/lib/api-utils";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import {
  detectGitConflicts,
  readConflictFileContent,
  resolveConflictFile,
} from "@/lib/git/conflicts";
import { getRepoRoot } from "@/lib/notes/dir";

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

const ResolveConflictSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, ResolveConflictSchema);
  if (!parsed.ok) return parsed.response;
  const result = resolveConflictFile(getRepoRoot(), parsed.data.path, parsed.data.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const remaining = detectGitConflicts(getRepoRoot());
  return NextResponse.json({ ok: true, remaining: remaining.length });
}, "git conflicts resolve");
