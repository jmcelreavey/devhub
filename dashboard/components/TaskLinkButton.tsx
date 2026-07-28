"use client";

/**
 * Lightweight dialog to attach a PR / calendar / note / Jira link to a task.
 * Writes Task.links via PATCH — same EntityRef shape as notes ## Links.
 */

import { useState } from "react";
import { Link2 } from "lucide-react";
import type { EntityKind, EntityRef } from "@/lib/entity-note";
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";
import { useToast } from "@/lib/hooks/use-toast";
import { HoverTip } from "@/components/ui/HoverTip";

const KINDS: { id: EntityKind; label: string }[] = [
  { id: "pr", label: "Pull request" },
  { id: "calendar", label: "Calendar" },
  { id: "note", label: "Note path" },
  { id: "jira", label: "Jira" },
  { id: "task", label: "Task id" },
];

export function TaskLinkButton({
  taskId,
  date,
  existing,
  onChanged,
}: {
  taskId: string;
  date: string;
  existing?: EntityRef[];
  onChanged?: (links: EntityRef[]) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EntityKind>("pr");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const raw = value.trim();
    if (!raw) return;
    setBusy(true);
    try {
      let ref: EntityRef;
      if (kind === "pr") {
        const parsed = parseGithubPrUrl(raw) || parseGithubPrUrl(`https://github.com/${raw}`);
        if (!parsed && !raw.includes("#")) {
          throw new Error("Use a GitHub PR URL or owner/repo#123");
        }
        if (parsed) {
          ref = {
            kind: "pr",
            id: `${parsed.repo}#${parsed.number}`,
            label: `${parsed.repo}#${parsed.number}`,
            href: `https://github.com/${parsed.repo}/pull/${parsed.number}`,
          };
        } else {
          ref = { kind: "pr", id: raw, label: raw };
        }
      } else if (kind === "jira") {
        ref = { kind: "jira", id: raw.toUpperCase(), label: raw.toUpperCase() };
      } else if (kind === "note") {
        const path = raw.replace(/^\/notes\//, "").replace(/\.json$/, "");
        ref = {
          kind: "note",
          id: path,
          label: path.split("/").pop() || path,
          href: `/notes/${path.split("/").map(encodeURIComponent).join("/")}`,
        };
      } else if (kind === "calendar") {
        ref = {
          kind: "calendar",
          id: raw,
          label: "Calendar event",
          href: raw.startsWith("http") ? raw : "/calendar",
        };
      } else {
        ref = { kind: "task", id: raw, label: raw, href: "/work?tab=tasks" };
      }

      const next = [...(existing ?? []).filter((r) => !(r.kind === ref.kind && r.id === ref.id)), ref];
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, date, links: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      onChanged?.(next);
      setOpen(false);
      setValue("");
      toast.success("Link added");
    } catch (e) {
      console.error("task link:", e);
      toast.error(e instanceof Error ? e.message : "Couldn't add link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <HoverTip label="Link PR, calendar, or note" pos="top-end" className="task-action-tip">
        <button
          type="button"
          className="task-icon-action"
          aria-label="Link entity"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Link2 size={12} aria-hidden />
        </button>
      </HoverTip>
      {open ? (
        <div
          className="entity-link-dialog pop-soft"
          role="dialog"
          aria-label="Link entity"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="entity-link-dialog-head">Link to…</div>
          <div className="entity-link-dialog-kinds">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="entity-link-kind"
                data-active={kind === k.id ? "true" : undefined}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            className="input"
            style={{ fontSize: 12, width: "100%" }}
            placeholder={
              kind === "pr"
                ? "https://github.com/org/repo/pull/1"
                : kind === "note"
                  ? "task-notes/2026-07-28-…"
                  : kind === "jira"
                    ? "PTF-1234"
                    : "id or URL"
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            autoFocus
          />
          <div className="entity-link-dialog-actions">
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs"
              disabled={busy || !value.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Add link"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
