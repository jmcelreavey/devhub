import { repoGitConflicts, repoGitConflictsList, type RepoGitConflictsResult } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { z } from "zod";
import { parseBody } from "../../../../../../lib/api-utils";
import {
  deleteConflictFile,
  detectConflictOperation,
  detectGitConflictsAsync,
  readConflictFileContent,
  readConflictSides,
  resolveConflictFile,
  resolveConflictSide,
} from "../../../../../../lib/git/conflicts";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { withRepoGitMutation } from "../../../../../../lib/git/mutation-queue";
import { parseUnifiedDiff, type DiffLine } from "../../../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import { withScannedRepo, type RepoParams } from "../_shared";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), path: z.string().min(1), content: z.string(), expectedContent: z.string().nullable() }),
  z.object({ action: z.literal("delete"), path: z.string().min(1) }),
  z.object({
    action: z.literal("take"),
    path: z.string().min(1),
    side: z.enum(["base", "ours", "theirs"]),
  }),
  z.object({ action: z.literal("continue") }),
  z.object({ action: z.literal("abort") }),
]);

async function comparisonLines(
  repoRoot: string,
  filePath: string,
  ours: string | null,
  theirs: string | null,
  binary: boolean,
): Promise<DiffLine[]> {
  if (binary) return [];
  if (ours !== null && theirs !== null) {
    const diff = await runGitRepoAsync(repoRoot, [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--unified=3",
      `:2:${filePath}`,
      `:3:${filePath}`,
      "--",
    ]);
    if (diff.status === 0 && diff.stdout.trim()) return parseUnifiedDiff(diff.stdout);
  }
  return [
    ...(ours ?? "").split("\n").map((text) => ({ type: "del" as const, text: `-${text}` })),
    ...(theirs ?? "").split("\n").map((text) => ({ type: "add" as const, text: `+${text}` })),
  ];
}

function conflictsResponse(result: RepoGitConflictsResult): Response {
  return result.kind === "preview"
    ? Response.json({ error: result.message }, { status: 400 })
    : Response.json(result.response.body, { status: result.response.status });
}

export async function GET(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  return httpAction(repoGitConflictsList, {
    input: () => ({ name, action: "list" }),
    context: () => ({ conflicts: async () => {
      const response = await readRepoConflicts(req, routeParams);
      return { status: response.status, body: await response.json() };
    } }),
    response: conflictsResponse,
  })(req);
}

async function readRepoConflicts(_req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const conflicts = [];
  for (const conflict of await detectGitConflictsAsync(repoRoot)) {
    const sides = await readConflictSides(repoRoot, conflict.path);
    const content = readConflictFileContent(repoRoot, conflict.path);
    const binary = sides.binary || Boolean(content?.includes("\0"));
    conflicts.push({
      ...conflict,
      content,
      ...sides,
      binary,
      hasStages: sides.base !== null || sides.ours !== null || sides.theirs !== null,
      comparison: await comparisonLines(repoRoot, conflict.path, sides.ours, sides.theirs, binary),
    });
  }

  return Response.json({
    conflicts,
    count: conflicts.length,
    operation: await detectConflictOperation(repoRoot),
  });
}

export async function POST(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.action === "resolve") {
    return httpAction(repoGitConflicts, {
      input: () => ({ name, action: "resolve", path: body.path, content: body.content, expectedContent: body.expectedContent, confirm: true }),
      context: () => ({ conflicts: async () => {
        const response = await withRepoGitMutation(repoRoot, () => applyConflictAction(repoRoot, body));
        return { status: response.status, body: await response.json() };
      } }),
      response: conflictsResponse,
    })(req);
  }
  return withRepoGitMutation(repoRoot, () => applyConflictAction(repoRoot, body));
}

async function applyConflictAction(repoRoot: string, body: z.infer<typeof BodySchema>) {

  if (body.action === "continue" || body.action === "abort") {
    const operation = await detectConflictOperation(repoRoot);
    if (!operation) {
      return Response.json({ error: "No merge, cherry-pick, revert, or rebase is active" }, { status: 400 });
    }
    if (body.action === "continue" && (await detectGitConflictsAsync(repoRoot)).length > 0) {
      return Response.json({ error: "Resolve and stage every conflict before continuing" }, { status: 400 });
    }
    const args =
      body.action === "abort"
        ? [operation, "--abort"]
        : operation === "merge"
          ? ["commit", "--no-edit"]
          : operation === "rebase"
            ? ["-c", "core.editor=true", "rebase", "--continue"]
            : [operation, "--continue"];
    const result = await runGitRepoAsync(repoRoot, args);
    if (result.status !== 0) {
      return Response.json(
        { error: result.stderr.trim() || result.stdout.trim() || `${body.action} failed` },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, operation, action: body.action });
  }

  if (!(await detectGitConflictsAsync(repoRoot)).some((conflict) => conflict.path === body.path)) {
    if (body.action === "resolve") {
      return Response.json({ error: "File is no longer an active conflict. Copy your draft and refresh." }, { status: 409 });
    }
    return Response.json({ error: "Path is not an active conflict" }, { status: 400 });
  }

  const result = await (
    body.action === "take"
      ? resolveConflictSide(repoRoot, body.path, body.side)
      : body.action === "delete"
        ? deleteConflictFile(repoRoot, body.path)
        : resolveConflictFile(repoRoot, body.path, body.content, body.expectedContent));
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: "code" in result && result.code === "content_changed" ? 409 : 400 });
  }

  const remaining = await detectGitConflictsAsync(repoRoot);
  return Response.json({ ok: true, remaining: remaining.length });
}
