import { repoGitRange, repoGitRangeDashboard, repoGitRangeInput } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { isSafeRepoRelPath } from "../../../../../../lib/git/ref-safety";
import { parseNameStatus, parseUnifiedContext, parseUnifiedDiff } from "../../../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import { gitFail, repoDashboardQueryHttp, withScannedRepo, type RepoParams } from "../_shared";

/**
 * Diff a whole range — "what does this branch change vs main" — rather than a
 * single commit. History already answers "what did this commit do"; this is the
 * review-shaped question that needed a second endpoint.
 */

/** Branch/tag names as well as SHAs, since a range is usually `main...feature`. */
const REF_RE = /^[0-9A-Za-z._\-/]{1,200}$/;

function isSafeRangeRef(ref: string): boolean {
  if (!ref || !REF_RE.test(ref)) return false;
  // `..`/`...` are the range operators; a ref containing them would let the
  // caller smuggle a second range in. Also blocks the `.lock`-style traversals.
  if (ref.includes("..")) return false;
  return !ref.startsWith("-") && !ref.endsWith("/");
}

export async function GET(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  const search = new URL(req.url).searchParams;
  const rawContext = search.get("context");
  const input = {
    name,
    base: search.get("base") ?? undefined,
    head: search.get("head") ?? undefined,
    path: search.get("path") ?? undefined,
    context: rawContext ? Number(rawContext) : undefined,
  };
  const allowed = new Set(["base", "head", "path", "context"]);
  if ([...search.keys()].every((key) => allowed.has(key)) && repoGitRangeInput.safeParse(input).success) {
    return httpAction(repoGitRange, {
      input: () => input,
      context: () => ({ range: async () => {
        const response = await readRepoGitRange(req, routeParams);
        return { status: response.status, body: await response.json() };
      } }),
      response: (result) => Response.json(result.response.body, { status: result.response.status }),
    })(req);
  }
  return repoDashboardQueryHttp(repoGitRangeDashboard, req, routeParams, readRepoGitRange);
}

async function readRepoGitRange(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const headParam = new URL(req.url).searchParams.get("head")?.trim() || "HEAD";
  let baseParam = new URL(req.url).searchParams.get("base")?.trim() || "";
  if (!baseParam) {
    // Default to the repo's own trunk rather than assuming "main".
    baseParam = (await resolveDefaultRemoteBranch(repoRoot)) ?? "origin/main";
  }
  if (!isSafeRangeRef(headParam) || !isSafeRangeRef(baseParam)) {
    return Response.json({ error: "Invalid ref" }, { status: 400 });
  }

  const filePath = new URL(req.url).searchParams.get("path");
  if (filePath && !isSafeRepoRelPath(filePath)) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  const unified = parseUnifiedContext(
    new URL(req.url).searchParams.get("context"),
    new URL(req.url).searchParams.get("full") === "1",
  );

  // Merge-base range (`...`): shows what HEAD added, not what it's missing from
  // base. That's what a reviewer means by "the changes on this branch".
  const range = `${baseParam}...${headParam}`;

  if (new URL(req.url).searchParams.get("format") === "patch") {
    const patch = await runGitRepoAsync(repoRoot, ["diff", range], { timeout: 30_000 });
    if (patch.status !== 0) return gitFail(patch, "Range diff failed");
    return Response.json({
      base: baseParam,
      head: headParam,
      patch: patch.stdout || "",
    });
  }

  const [files, counts, diff] = await Promise.all([
    runGitRepoAsync(repoRoot, ["diff", "--name-status", range], { timeout: 30_000 }),
    runGitRepoAsync(repoRoot, ["rev-list", "--left-right", "--count", range], { timeout: 30_000 }),
    runGitRepoAsync(
      repoRoot,
      [
        "diff",
        `-U${unified}`,
        range,
        ...(filePath ? ["--", filePath] : []),
      ],
      { timeout: 30_000 },
    ),
  ]);

  if (files.status !== 0) return gitFail(files, "Range diff failed");

  const [behind = "0", ahead = "0"] = (counts.stdout || "").trim().split(/\s+/);

  return Response.json({
    base: baseParam,
    head: headParam,
    behind: Number(behind) || 0,
    ahead: Number(ahead) || 0,
    files: parseNameStatus(files.stdout || ""),
    path: filePath ?? null,
    lines: diff.status === 0 ? parseUnifiedDiff(diff.stdout || "") : [],
  });
}
