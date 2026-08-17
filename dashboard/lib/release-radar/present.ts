import { partitionByAcknowledgement, pruneAcknowledgements } from "@/lib/radar/acknowledgements";
import type { Advisory } from "./analyse";
import type { ReleaseRadarResult } from "./scan";

export interface PresentedReleaseRadar extends ReleaseRadarResult {
  advisories: Advisory[];
  acknowledged: Array<Advisory & { acknowledgedAt: string; acknowledgedAt_watermark: number }>;
  acknowledgedCount: number;
}

/**
 * Apply acknowledgements to a release-radar scan.
 *
 * Prune against the *unfiltered* advisory list. `prodOnly` is a view: hiding
 * dev-only rows must not delete the acks for those rows. Watermark is
 * `behindRepos.length` (drift magnitude), not `repoCount` (how many repos
 * declare the package).
 */
export function presentReleaseRadar(
  result: ReleaseRadarResult,
  prodOnly: boolean,
): PresentedReleaseRadar {
  const store = pruneAcknowledgements(
    "release",
    result.advisories.map((advisory) => advisory.id),
  );
  const advisories = prodOnly
    ? result.advisories.filter((advisory) => !advisory.devOnly)
    : result.advisories;
  const { visible, acknowledged } = partitionByAcknowledgement(
    advisories,
    "release",
    (advisory) => advisory.id,
    (advisory) => advisory.behindRepos.length,
    store,
  );
  return {
    ...result,
    advisories: visible,
    acknowledged,
    acknowledgedCount: acknowledged.length,
  };
}
