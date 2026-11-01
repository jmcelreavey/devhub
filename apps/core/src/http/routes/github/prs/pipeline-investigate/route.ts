/**
 * POST /api/github/prs/pipeline-investigate — start pipeline investigate agent job.
 *
 * Same prompt/note path as UI "Investigate pipeline". Never posts GitHub reviews.
 * Auth: requireDashboardAuth.
 *
 * Body: `{ repo, number, url?, title?, confirm?: boolean, rerunFailed?: boolean, dryRun?: boolean }`
 * Without confirm (and not dryRun), returns the would-start payload.
 */
import { z } from "zod";
import { prPipelineInvestigate, prPipelineInvestigateInput } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { isGithubCliAuthenticated, mapGithubCliError } from "../../../../../lib/gh-exec";
import {
  pipelineInvestigateNotePath,
  rerunFailedChecksForPr,
  startPipelineInvestigateAgent,
} from "../../../../../lib/github/pipeline-investigate";
import { agentPipelineInvestigatePrompt } from "../../../../../../../../packages/shared/ui-lib/github/pipeline-prompt";


const BodySchema = prPipelineInvestigateInput.extend({
  repo: prPipelineInvestigateInput.shape.repo.min(3),
  url: prPipelineInvestigateInput.shape.url.unwrap().url().optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  return httpAction(prPipelineInvestigate, {
    input: () => parsed.data,
    context: () => ({ investigate: async (input, mayStart) => {
      const response = await investigatePipeline(input, mayStart);
      return { status: response.status, body: await response.json() };
    } }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "github.prs.pipeline-investigate");

async function investigatePipeline(input: z.output<typeof BodySchema>, mayStart: boolean) {
  const { repo, number, title, dryRun, rerunFailed } = input;
  const url = input.url ?? `https://github.com/${repo}/pull/${number}`;
  const row = { repo, number, url, title: title ?? `PR #${number}` };
  const notePath = pipelineInvestigateNotePath(row);
  const prompt = agentPipelineInvestigatePrompt(url, notePath);

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return Response.json(
      {
        configured: false,
        error: "GitHub CLI not authenticated — run `gh auth login`.",
        notePath,
        prompt,
      },
      { status: 503 },
    );
  }

  if (!mayStart) {
    return Response.json({
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

    const started = await startPipelineInvestigateAgent({ row, notePath });
    return Response.json({
      configured: true,
      dryRun: false,
      started: {
        repo,
        number,
        url,
        runId: started.runId,
        sessionId: started.sessionId,
        providerLabel: started.providerLabel,
        notePath: started.notePath,
      },
      rerun,
    });
  } catch (error) {
    console.error("[api:github:prs:pipeline-investigate]", error);
    const mapped = mapGithubCliError(error);
    return Response.json({ error: mapped.error }, { status: mapped.status });
  }
}
