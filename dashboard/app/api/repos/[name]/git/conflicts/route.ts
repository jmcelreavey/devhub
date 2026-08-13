import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  deleteConflictFile,
  detectConflictOperation,
  detectGitConflicts,
  readConflictFileContent,
  readConflictSides,
  resolveConflictFile,
  resolveConflictSide,
} from "@/lib/git/conflicts";
import { runGitRepo } from "@/lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../_shared";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), path: z.string().min(1), content: z.string() }),
  z.object({ action: z.literal("delete"), path: z.string().min(1) }),
  z.object({
    action: z.literal("take"),
    path: z.string().min(1),
    side: z.enum(["base", "ours", "theirs"]),
  }),
  z.object({ action: z.literal("continue") }),
  z.object({ action: z.literal("abort") }),
]);

export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const conflicts = detectGitConflicts(repoRoot).map((conflict) => {
    const sides = readConflictSides(repoRoot, conflict.path);
    const content = readConflictFileContent(repoRoot, conflict.path);
    return {
      ...conflict,
      content,
      ...sides,
      binary: sides.binary || Boolean(content?.includes("\0")),
      hasStages: sides.base !== null || sides.ours !== null || sides.theirs !== null,
    };
  });

  return NextResponse.json({
    conflicts,
    count: conflicts.length,
    operation: detectConflictOperation(repoRoot),
  });
}

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === "continue" || body.action === "abort") {
    const operation = detectConflictOperation(repoRoot);
    if (!operation) {
      return NextResponse.json({ error: "No merge, cherry-pick, revert, or rebase is active" }, { status: 400 });
    }
    if (body.action === "continue" && detectGitConflicts(repoRoot).length > 0) {
      return NextResponse.json({ error: "Resolve and stage every conflict before continuing" }, { status: 400 });
    }
    const args =
      body.action === "abort"
        ? [operation, "--abort"]
        : operation === "merge"
          ? ["commit", "--no-edit"]
          : operation === "rebase"
            ? ["-c", "core.editor=true", "rebase", "--continue"]
            : [operation, "--continue"];
    const result = runGitRepo(repoRoot, args);
    if (result.status !== 0) {
      return NextResponse.json(
        { error: result.stderr.trim() || result.stdout.trim() || `${body.action} failed` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, operation, action: body.action });
  }

  if (!detectGitConflicts(repoRoot).some((conflict) => conflict.path === body.path)) {
    return NextResponse.json({ error: "Path is not an active conflict" }, { status: 400 });
  }

  const result =
    body.action === "take"
      ? resolveConflictSide(repoRoot, body.path, body.side)
      : body.action === "delete"
        ? deleteConflictFile(repoRoot, body.path)
        : resolveConflictFile(repoRoot, body.path, body.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const remaining = detectGitConflicts(repoRoot);
  return NextResponse.json({ ok: true, remaining: remaining.length });
}
