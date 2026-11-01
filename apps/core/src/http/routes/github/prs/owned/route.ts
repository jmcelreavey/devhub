import { prOwnedList, prOwnedRemote, prOwnedRemoteInput } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { loadOwnedPrs, loadRemoteOwnedPrs } from "../../../../../lib/github/owned-prs-load";


export const GET = withErrorHandler(async (req: Request) => {
  if (new URL(req.url).searchParams.get("scope") !== "remote") return httpAction(prOwnedList, {
    input: () => ({}),
    context: () => ({ load: loadOwnedPrs }),
    response: (result) => Response.json(result),
  })(req);
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = prOwnedRemoteInput.safeParse({ repos: new URL(req.url).searchParams.getAll("repo") });
  if (!parsed.success) {
    return Response.json({ error: "Invalid repositories" }, { status: 400 });
  }
  return httpAction(prOwnedRemote, {
    input: () => parsed.data,
    context: () => ({ load: loadRemoteOwnedPrs }),
    response: (result) => Response.json(result),
  })(req);
}, "github.prs.owned");
