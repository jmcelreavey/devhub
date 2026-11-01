import { prState, prStateInput } from "../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../lib/actions/http";
import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { githubScreen } from "../../../../lib/integrations/screen-data";
const fetchPrState = githubScreen.state;


/** `?repo=owner/name&number=N` → live checks, reviews and merge state (MCP `events_wait`). */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  const number = Number(new URL(req.url).searchParams.get("number"));
  const parsed = prStateInput.safeParse({ repo, number });
  if (!parsed.success) {
    return Response.json({ error: "repo (owner/name) and a positive PR number are required" }, { status: 400 });
  }
  return httpAction(prState, {
    input: () => parsed.data,
    context: () => ({ read: readPrState }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "github.pr-state");

async function readPrState(repo: string, number: number) {
  try {
    return { status: 200, body: { pr: await fetchPrState(repo, number) } };
  } catch (err) {
    // execExternal's message is just "Command failed: <argv>"; gh says why on stderr.
    const stderr = (err as { stderr?: unknown }).stderr;
    const reason =
      (typeof stderr === "string" && stderr.trim()) || (err instanceof Error ? err.message : String(err));
    return { status: 502, body: { error: `gh pr view failed: ${reason.split("\n")[0]}` } };
  }
}
