/**
 * Capability Radar — evolution headline builder. Pure and client-safe, so the
 * weekly digest (server) and the /repos EvolutionStrip (client) render the
 * exact same summary of a diff.
 */

import type { CapabilityDiff } from "./types";

/** Areas that represent a structural / architectural shift for the headline. */
export const ARCH_AREAS: ReadonlySet<string> = new Set(["arch", "deploy", "infra"]);

/**
 * One-line summary of a diff, e.g. "+Flux · +Kafka — 2 arch shifts".
 * Falls back to "N spreading" and finally "no changes".
 */
export function buildEvolutionHeadline(diff: CapabilityDiff): string {
  const news = diff.added.slice(0, 3).map((e) => `+${e.label}`);
  let head = news.join(" · ");
  if (diff.added.length > 3) head += ` · +${diff.added.length - 3} more`;
  if (!head) head = diff.spread.length ? `${diff.spread.length} spreading` : "no changes";

  const shifts = [...diff.added, ...diff.spread].filter((e) => ARCH_AREAS.has(e.area)).length;
  const shiftPart = shifts ? ` - ${shifts} arch shift${shifts === 1 ? "" : "s"}` : "";
  return `${head}${shiftPart}`;
}
