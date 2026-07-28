"use client";

/**
 * Compact hop-around chips for cards (tasks, calendar, PRs).
 * Shows linked notes + related entities with clear icons — always visible
 * when present, not buried in hover chrome.
 *
 * Dedupes against the host card: e.g. a task row with a JiraKeyChip should
 * not also show a jira entity chip for the same key, and companion notes
 * should not re-echo the full task title.
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

const NOTE_LABEL_MAX = 28;

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Short chip text — avoid repeating the host title / ticket key. */
export function chipDisplayLabel(
  ref: EntityRef,
  opts?: { suppressJiraKey?: string; hostLabel?: string },
): string {
  let label = (ref.label || ref.id || "").replace(/\s+/g, " ").trim();

  if (opts?.suppressJiraKey) {
    const re = new RegExp(`\\b${opts.suppressJiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    label = label.replace(re, " ").replace(/\s+/g, " ").trim();
  }

  if (ref.kind === "note") {
    // Companion task notes sit under the row title — never re-echo it / the key.
    if (ref.id.startsWith("task-notes/")) return "Note";
    if (!label || /^note$/i.test(label) || /^task note$/i.test(label)) return "Note";
    if (opts?.hostLabel) {
      let host = opts.hostLabel.replace(/\s+/g, " ").trim();
      if (opts.suppressJiraKey) {
        const re = new RegExp(
          `\\b${opts.suppressJiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "gi",
        );
        host = host.replace(re, " ").replace(/\s+/g, " ").trim();
      }
      if (normalizeLabel(label) === normalizeLabel(host)) return "Note";
      // Title with key at either end should still collapse.
      if (
        normalizeLabel(host).includes(normalizeLabel(label)) &&
        label.length >= 12
      ) {
        return "Note";
      }
      if (normalizeLabel(host).startsWith(normalizeLabel(label)) && label.length >= 12) {
        return "Note";
      }
    }
    // Prefer a short basename over a long vault path echo.
    if (label.includes("/")) {
      label = label.split("/").pop() || label;
    }
    if (label.length > NOTE_LABEL_MAX) return `${label.slice(0, NOTE_LABEL_MAX - 1)}…`;
    return label || "Note";
  }

  if (ref.kind === "jira" && opts?.suppressJiraKey && ref.id.toUpperCase() === opts.suppressJiraKey.toUpperCase()) {
    return opts.suppressJiraKey;
  }

  return label || ref.id;
}

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
  /** When set, hide jira chips for this key (host already shows a copy badge). */
  suppressJiraKey,
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
  suppressJiraKey?: string;
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
    if (
      suppressJiraKey &&
      ref.kind === "jira" &&
      ref.id.toUpperCase() === suppressJiraKey.toUpperCase()
    ) {
      continue;
    }
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
        const text = chipDisplayLabel(ref, { suppressJiraKey, hostLabel: label });
        const inner = (
          <>
            <Icon size={10} aria-hidden />
            <span>{text}</span>
          </>
        );
        return (
          <li key={`${ref.kind}:${ref.id}`}>
            {target ? (
              <Link
                href={target}
                className="entity-link-chip"
                data-kind={ref.kind}
                title={ref.label || text}
                onClick={(e) => e.stopPropagation()}
              >
                {inner}
              </Link>
            ) : (
              <span className="entity-link-chip" data-kind={ref.kind} title={ref.label || text}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
