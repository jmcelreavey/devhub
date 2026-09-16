/**
 * POST /api/github/prs/pipeline-investigate — start pipeline investigate agent job.
 *
 * Same prompt/note path as UI "Investigate pipeline". Never posts GitHub reviews.
 * Auth: requireDashboardAuth.
 *
 * Body: `{ repo, number, url?, title?, confirm?: boolean, rerunFailed?: boolean, dryRun?: boolean }`
 * Without confirm (and not dryRun), returns the would-start payload.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import {
  pipelineInvestigateNotePath,
  rerunFailedChecksForPr,
  startOpenCodePipelineInvestigate,
} from "@/lib/github/pipeline-investigate";
import { agentPipelineInvestigatePrompt } from "@/lib/pr-pipeline-prompt";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repo: z.string().min(3),
  number: z.number().int().positive(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  /** Required true to start the agent (unless dryRun). */
  confirm: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  /** Confirm-gated re-run of failed Actions for the PR head branch. */
  rerunFailed: z.boolean().optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const { repo, number, title, confirm, dryRun, rerunFailed } = parsed.data;
  const url = parsed.data.url ?? `https://github.com/${repo}/pull/${number}`;
  const row = { repo, number, url, title: title ?? `PR #${number}` };
  const notePath = pipelineInvestigateNotePath(row);
  const prompt = agentPipelineInvestigatePrompt(url, notePath);

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json(
      {
        configured: false,
        error: "GitHub CLI not authenticated — run `gh auth login`.",
        notePath,
        prompt,
      },
      { status: 503 },
    );
  }

  if (dryRun || !confirm) {
    return NextResponse.json({
      configured: true,
      dryRun: true,
      repo,
      number,
      url,
      notePath,
      prompt,
      message: dryRun
        ? "Dry-run — no agent started."
        : "Would start pipeline investigate. Re-run with confirm: true.",
    });
  }

  try {
    let rerun = null as Awaited<ReturnType<typeof rerunFailedChecksForPr>> | null;
    if (rerunFailed) {
      try {
        rerun = await rerunFailedChecksForPr(repo, number);
      } catch (err) {
        rerun = {
          attempted: 0,
          reran: 0,
          runIds: [],
          errors: [err instanceof Error ? err.message : String(err)],
        };
      }
    }

    const started = await startOpenCodePipelineInvestigate({ row, notePath });
    return NextResponse.json({
      configured: true,
      dryRun: false,
      started: {
        repo,
        number,
        url,
        sessionId: started.sessionId,
        notePath: started.notePath,
      },
      rerun,
    });
  } catch (error) {
    console.error("[api:github:prs:pipeline-investigate]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.pipeline-investigate");
