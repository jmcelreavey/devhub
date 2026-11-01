import { radarReleaseView } from "../../../../../../../packages/shared/actions/workspace";
import { withErrorHandler } from "../../../../lib/api-utils";
import { presentReleaseRadar } from "../../../../lib/release-radar/present";
import { runReleaseRadar } from "../../../../lib/release-radar/scan";


/**
 * GET /api/radar/releases?prodOnly=1
 *
 * Where the estate disagrees with itself about a dependency's major version.
 *
 * Acknowledgements use `behindRepos.length` as the watermark, so acknowledging
 * a split across three laggards stays quiet at three and re-surfaces when a
 * fourth repo falls behind. Same store and same semantics as capability drift —
 * two radar surfaces behaving differently is how the first one became
 * unreadable.
 *
 * `prodOnly` filters the view, not the prune set: a hidden dev-only ack must
 * still be there when you turn the filter off.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const prodOnly = new URL(req.url).searchParams.get("prodOnly") === "1";

  return await radarReleaseView.handler({ prodOnly }, { execute: async () => {
    return Response.json(presentReleaseRadar(runReleaseRadar(), prodOnly));
  } }) as Response;
}, "release radar");
