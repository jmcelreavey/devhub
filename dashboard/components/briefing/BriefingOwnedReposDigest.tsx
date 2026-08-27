"use client";

import Link from "next/link";
import { FolderGit2 } from "lucide-react";

/**
 * Matches `/api/dashboard/morning-briefing` and `/api/radar/personal` rows.
 *
 * The optionals are real: both routes build these from repo scans that can be
 * partial, so the type says what actually arrives instead of asserting a shape
 * the component then has to re-check with `?.` at every use.
 */
export interface BriefingRepoAttentionRow {
  repo?: { fullName?: string };
  attention?: { score?: number; reasons?: string[] };
}

/** Rows shown before the digest stops — the widget is a glance, not a list. */
const MAX_ROWS = 4;

interface DigestRow {
  fullName: string;
  href: string;
  reasons: string;
}

function toDigestRow(row: BriefingRepoAttentionRow): DigestRow | null {
  const fullName = row.repo?.fullName?.trim();
  if (!fullName) return null;
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    href:
      owner && name
        ? `/own/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
        : `/repos/${encodeURIComponent(name ?? fullName)}`,
    reasons: (row.attention?.reasons ?? []).slice(0, 2).join(" · "),
  };
}

/**
 * Morning-briefing slice of the owned-repo attention digest — same data Radar
 * uses, trimmed for the Today widget.
 */
export function BriefingOwnedReposDigest({ rows }: { rows: BriefingRepoAttentionRow[] }) {
  // Filter before slicing: slicing first meant one unnamed repo in the top four
  // rendered as a hole, and the widget silently showed three.
  const digest = rows.map(toDigestRow).filter((row): row is DigestRow => row !== null);
  if (digest.length === 0) return null;

  return (
    <div className="briefing-repos-digest" aria-label="Owned repositories needing attention">
      <div className="briefing-repos-digest-head">
        <FolderGit2 size={12} aria-hidden className="text-warning" />
        <span className="text-xs font-semibold text-text">Repos</span>
      </div>
      <ul className="briefing-repos-digest-list">
        {digest.slice(0, MAX_ROWS).map((row) => (
          <li key={row.fullName}>
            <Link href={row.href} className="briefing-repos-digest-row">
              <span className="briefing-repos-digest-name">{row.fullName}</span>
              <span className="briefing-repos-digest-reason">{row.reasons}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
