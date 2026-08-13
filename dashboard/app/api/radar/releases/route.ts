import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { runReleaseRadar } from "@/lib/release-radar/scan";
import { partitionByAcknowledgement, pruneAcknowledgements } from "@/lib/radar/acknowledgements";

export const dynamic = "force-dynamic";

/**
 * GET /api/radar/releases?prodOnly=1
 *
 * Where the estate disagrees with itself about a dependency's major version.
 *
 * Acknowledgements use `repoCount` as the watermark, so acknowledging a split
 * across three repos stays quiet at three and re-surfaces when a fourth repo
 * adopts a divergent line. Same store and same semantics as capability drift —
 * two radar surfaces behaving differently is how the first one became
 * unreadable.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const prodOnly = req.nextUrl.searchParams.get("prodOnly") === "1";
  const result = runReleaseRadar({ prodOnly });

  const store = pruneAcknowledgements("release", result.advisories.map((a) => a.id));
  const { visible, acknowledged } = partitionByAcknowledgement(
    result.advisories,
    "release",
    (a) => a.id,
    (a) => a.repoCount,
    store,
  );

  return NextResponse.json({
    ...result,
    advisories: visible,
    acknowledged,
    acknowledgedCount: acknowledged.length,
  });
}, "release radar");
