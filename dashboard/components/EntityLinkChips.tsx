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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ExternalLink,
  FileText,
  FolderGit2,
  GitPullRequest,
  ListTodo,
  PenTool,
  Tag,
  Ticket,
  X,
} from "lucide-react";
import type { EntityKind, EntityRef } from "@/lib/entity-note";
import { defaultHrefForRef } from "@/lib/entity-note";

interface EntityLinksPayload {
  notes: EntityRef[];
  related: EntityRef[];
}

const KIND_ICON: Record<EntityKind, typeof FileText> = {
  note: FileText,
  diagram: PenTool,
  task: ListTodo,
  calendar: Calendar,
  meeting: Calendar,
  pr: GitPullRequest,
  jira: Ticket,
  repo: FolderGit2,
  tag: Tag,
};

const NOTE_LABEL_MAX = 28;
const CHIP_LIMIT = 6;

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strip a ticket key the host card already displays, then tidy whitespace. */
function stripKey(text: string, key: string | undefined): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!key) return clean;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ").replace(/\s+/g, " ").trim();
}

function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Short chip text — avoid repeating the host title / ticket key. */
export function chipDisplayLabel(
  ref: EntityRef,
  opts?: { suppressJiraKey?: string; hostLabel?: string },
): string {
  let label = stripKey(ref.label || ref.id || "", opts?.suppressJiraKey);

  if (ref.kind === "note") {
    // Companion task notes sit under the row title — never re-echo it / the key.
    if (ref.id.startsWith("task-notes/")) return "Note";
    if (!label || /^(task )?note$/i.test(label)) return "Note";
    if (opts?.hostLabel) {
      const host = normalizeLabel(stripKey(opts.hostLabel, opts.suppressJiraKey));
      // An echo of the host title (whole or leading fragment) adds nothing.
      if (host === normalizeLabel(label)) return "Note";
      if (label.length >= 12 && host.includes(normalizeLabel(label))) return "Note";
    }
    // Prefer a short basename over a long vault path echo.
    if (label.includes("/")) label = label.split("/").pop() || label;
    if (label.length > NOTE_LABEL_MAX) return `${label.slice(0, NOTE_LABEL_MAX - 1)}…`;
    return label || "Note";
  }

  if (ref.kind === "diagram") {
    if (label.includes("/")) label = label.split("/").pop() || label;
    if (label.length > NOTE_LABEL_MAX) return `${label.slice(0, NOTE_LABEL_MAX - 1)}…`;
    return label || "Diagram";
  }

  if (
    ref.kind === "jira" &&
    opts?.suppressJiraKey &&
    ref.id.toUpperCase() === opts.suppressJiraKey.toUpperCase()
  ) {
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
  /** Hide canonical note links when the host already has a note action. */
  showNotes = true,
  /** When set, hide jira chips for this key (host already shows a copy badge). */
  suppressJiraKey,
  /**
   * When set, seed refs (task.links / host-owned edges) get a remove control.
   * Note-derived / reverse links stay read-only.
   */
  onRemoveSeed,
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
  showNotes?: boolean;
  suppressJiraKey?: string;
  onRemoveSeed?: (ref: EntityRef) => void | Promise<void>;
  className?: string;
}) {
  const seedKey = JSON.stringify(seed ?? []);
  const seedKeys = useMemo(
    () => new Set((JSON.parse(seedKey) as EntityRef[]).map(refKey)),
    [seedKey],
  );
  const [data, setData] = useState<EntityLinksPayload | null>(
    seed?.length ? { notes: [], related: seed } : null,
  );
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ kind, id });
    if (date) params.set("date", date);
    if (label) params.set("label", label);
    if (href) params.set("href", href);
    if (meetingTitle) params.set("meetingTitle", meetingTitle);
    if (prRepo) params.set("prRepo", prRepo);
    if (prNumber != null) params.set("prNumber", String(prNumber));

    void fetch(`/api/entity-links?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EntityLinksPayload | null) => {
        if (cancelled || !json) return;
        setData({
          notes: json.notes ?? [],
          related: [...((JSON.parse(seedKey) as EntityRef[]) ?? []), ...(json.related ?? [])],
        });
      })
      .catch(() => {
        /* keep seed */
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, date, label, href, meetingTitle, prRepo, prNumber, seedKey]);

  const chips: EntityRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...(showNotes ? (data?.notes ?? []) : []), ...(data?.related ?? [])]) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    if (ref.kind === kind && ref.id === id) continue;
    if (
      suppressJiraKey &&
      ref.kind === "jira" &&
      ref.id.toUpperCase() === suppressJiraKey.toUpperCase()
    ) {
      // Host already shows JiraKeyChip — hide the hop chip unless it's a
      // seed link the user can remove (otherwise they'd be stuck with it).
      if (!(onRemoveSeed && seedKeys.has(refKey(ref)))) {
        continue;
      }
    }
    seen.add(key);
    chips.push(ref);
  }

  if (chips.length === 0) return null;

  const hidden = expanded ? 0 : Math.max(0, chips.length - CHIP_LIMIT);
  const visible = hidden > 0 ? chips.slice(0, CHIP_LIMIT) : chips;

  const removeSeed = async (ref: EntityRef) => {
    if (!onRemoveSeed || removing) return;
    const key = refKey(ref);
    setRemoving(key);
    const previous = data;
    setData((prev) =>
      prev
        ? {
            notes: prev.notes,
            related: prev.related.filter((r) => refKey(r) !== key),
          }
        : prev,
    );
    try {
      await onRemoveSeed(ref);
    } catch {
      setData(previous);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <ul className={`entity-link-chips ${className ?? ""}`.trim()} aria-label="Linked entities">
      {visible.map((ref) => {
        const Icon = KIND_ICON[ref.kind] ?? ExternalLink;
        const target = defaultHrefForRef(ref);
        const text = chipDisplayLabel(ref, { suppressJiraKey, hostLabel: label });
        const external = !!target && /^https?:\/\//i.test(target);
        const removable = !!onRemoveSeed && seedKeys.has(refKey(ref));
        const inner = (
          <>
            <Icon size={10} aria-hidden />
            <span>{text}</span>
            {external ? <ExternalLink size={9} aria-hidden className="entity-link-chip-out" /> : null}
          </>
        );
        return (
          <li key={refKey(ref)} className={removable ? "entity-link-chip-item" : undefined}>
            {target ? (
              <Link
                href={target}
                className="entity-link-chip"
                data-kind={ref.kind}
                title={ref.label || text}
                // External chips must not navigate the app (or the desktop
                // shell) away from the page the user is working on.
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={(e) => e.stopPropagation()}
              >
                {inner}
              </Link>
            ) : (
              <span className="entity-link-chip" data-kind={ref.kind} title={ref.label || text}>
                {inner}
              </span>
            )}
            {removable ? (
              <button
                type="button"
                className="entity-link-chip-remove"
                aria-label={`Remove ${text} link`}
                disabled={removing === refKey(ref)}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void removeSeed(ref);
                }}
              >
                <X size={10} aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li>
          <button
            type="button"
            className="entity-link-chip entity-link-chip-more"
            aria-label={`Show ${hidden} more linked ${hidden === 1 ? "entity" : "entities"}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            +{hidden}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
