"use client";

/**
 * Compact hop-around chips for cards (tasks, calendar, PRs).
 * Shows linked notes + related entities with clear icons — always visible
 * when present, not buried in hover chrome.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ExternalLink,
  FileText,
  GitPullRequest,
  ListTodo,
  Ticket,
} from "lucide-react";
import type { EntityKind, EntityRef } from "@/lib/entity-note";
import { defaultHrefForRef } from "@/lib/entity-note";

interface EntityLinksPayload {
  notes: EntityRef[];
  related: EntityRef[];
}

const KIND_ICON: Record<EntityKind, typeof FileText> = {
  note: FileText,
  task: ListTodo,
  calendar: Calendar,
  meeting: Calendar,
  pr: GitPullRequest,
  jira: Ticket,
};

export function EntityLinkChips({
  kind,
  id,
  date,
  label,
  href,
  meetingTitle,
  prRepo,
  prNumber,
  /** Extra refs known client-side (e.g. task.links) shown immediately. */
  seed,
  className,
}: {
  kind: EntityKind;
  id: string;
  date?: string;
  label?: string;
  href?: string;
  meetingTitle?: string;
  prRepo?: string;
  prNumber?: number;
  seed?: EntityRef[];
  className?: string;
}) {
  const [data, setData] = useState<EntityLinksPayload | null>(
    seed?.length ? { notes: [], related: seed } : null,
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ kind, id });
    if (date) params.set("date", date);
    if (label) params.set("label", label);
    if (href) params.set("href", href);
    if (meetingTitle) params.set("meetingTitle", meetingTitle);
    if (prRepo) params.set("prRepo", prRepo);
    if (prNumber != null) params.set("prNumber", String(prNumber));
    const seedKey = JSON.stringify(seed ?? []);

    void fetch(`/api/entity-links?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EntityLinksPayload | null) => {
        if (cancelled || !json) return;
        const seeded = seedKey ? (JSON.parse(seedKey) as EntityRef[]) : [];
        setData({
          notes: json.notes ?? [],
          related: [...seeded, ...(json.related ?? [])],
        });
      })
      .catch(() => {
        /* keep seed */
      });
    return () => {
      cancelled = true;
    };
    // seed serialized to avoid identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, date, label, href, meetingTitle, prRepo, prNumber, JSON.stringify(seed ?? [])]);

  const chips: EntityRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...(data?.notes ?? []), ...(data?.related ?? [])]) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    if (ref.kind === kind && ref.id === id) continue;
    seen.add(key);
    chips.push(ref);
  }

  if (chips.length === 0) return null;

  return (
    <ul
      className={`entity-link-chips ${className ?? ""}`.trim()}
      aria-label="Linked entities"
    >
      {chips.slice(0, 6).map((ref) => {
        const Icon = KIND_ICON[ref.kind] ?? ExternalLink;
        const target = defaultHrefForRef(ref) ?? ref.href;
        const inner = (
          <>
            <Icon size={10} aria-hidden />
            <span>{ref.label}</span>
          </>
        );
        return (
          <li key={`${ref.kind}:${ref.id}`}>
            {target ? (
              <Link
                href={target}
                className="entity-link-chip"
                data-kind={ref.kind}
                title={ref.label}
                onClick={(e) => e.stopPropagation()}
              >
                {inner}
              </Link>
            ) : (
              <span className="entity-link-chip" data-kind={ref.kind}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
