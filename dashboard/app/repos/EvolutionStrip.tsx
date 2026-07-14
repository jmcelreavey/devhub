"use client";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { buildEvolutionHeadline } from "@/lib/capability/headline";
import type { CapabilityDiff } from "@/lib/capability/types";

interface RadarPayload {
  diff: CapabilityDiff | null;
}

/**
 * Compact one-line "engineering evolution" banner for the top of /repos.
 * Reads the latest Capability Radar diff and, when something changed since the
 * previous scan, links through to /radar. Renders nothing when there's no
 * snapshot yet or no changes — it should never add noise to a steady week.
 */
export function EvolutionStrip() {
  const { data } = useLive<RadarPayload>("/api/capability/radar", {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const diff = data?.diff ?? null;
  if (!diff || !diff.fromId) return null;
  if (diff.added.length === 0 && diff.spread.length === 0) return null;

  // Same summary the weekly digest uses, so the strip and /radar never drift.
  const headline = buildEvolutionHeadline(diff);

  return (
    <Link
      href="/radar"
      className="card card-body mb-3 flex items-center gap-3 no-underline evolution-strip"
      style={{ borderLeft: "3px solid var(--accent)", textDecoration: "none" }}
    >
      <TrendingUp size={15} style={{ color: "var(--accent)" }} className="shrink-0" aria-hidden />
      <div className="flex-1 min-w-0 text-sm truncate" style={{ color: "var(--text)" }}>
        <span style={{ color: "var(--text-subtle)" }}>This week: </span>
        {headline}
      </div>
      <span className="text-xs shrink-0" style={{ color: "var(--accent)" }}>
        Open Radar <span className="evolution-arrow">→</span>
      </span>
    </Link>
  );
}
