"use client";

import { useCallback, useState } from "react";
import { mutate as globalMutate } from "swr";
import { Loader2, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { RichTextField } from "@/components/RichTextField";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { JIRA_KEY_RE } from "@/lib/utils";
import { issueTypeForParent } from "@/lib/jira-issue-type";
import type { JiraMeta } from "@/lib/jira-client";
import type { Task } from "@/components/TaskList";

type ParentMode = "linked" | "other" | "none";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;

function projectOf(key: string | undefined, fallback = "PTF"): string {
  if (!key) return fallback;
  const prefix = key.split("-")[0]?.toUpperCase();
  return prefix && PROJECT_KEY_RE.test(prefix) ? prefix : fallback;
}

/** Strip a Jira key (and trailing separators) from text to seed the summary. */
function summaryFromTask(text: string, jiraKey?: string): string {
  let s = text;
  if (jiraKey) {
    s = s
      .replace(new RegExp(`\\b${jiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return s.replace(/\s+/g, " ").trim().replace(/^[-–—,:]\s*/, "").trim();
}

export interface AddToJiraModalProps {
  open: boolean;
  task: Task;
  onClose: () => void;
  /** Called after a ticket is created so the caller can rewrite the task text. */
  onCreated: (newKey: string, newUrl: string) => void;
}

export function AddToJiraModal({ open, task, onClose, onCreated }: AddToJiraModalProps) {
  const toast = useToast();
  const linkedKey = task.jiraKey;

  // Modal mounts fresh per open, so initial state derives straight from the task.
  const [summary, setSummary] = useState(() => summaryFromTask(task.text, linkedKey));
  const [description, setDescription] = useState("");
  const [parentMode, setParentMode] = useState<ParentMode>(linkedKey ? "linked" : "none");
  const [otherKey, setOtherKey] = useState("");
  const [includeSprint, setIncludeSprint] = useState(true);
  const [creating, setCreating] = useState(false);

  const resolvedParentKey =
    parentMode === "linked" ? linkedKey ?? null : parentMode === "other" ? otherKey.trim().toUpperCase() || null : null;

  const projectKey = projectOf(
    parentMode === "linked" ? linkedKey : parentMode === "other" ? resolvedParentKey ?? undefined : linkedKey,
  );

  const otherKeyValid = parentMode !== "other" || JIRA_KEY_RE.test(otherKey.trim().toUpperCase());

  const parentLookupKey = resolvedParentKey?.trim().toUpperCase() ?? null;
  const parentKeyValid = !parentLookupKey || JIRA_KEY_RE.test(parentLookupKey);

  const metaParams = new URLSearchParams({ project: projectKey });
  if (resolvedParentKey) metaParams.set("reference", resolvedParentKey);
  const { data: meta, isLoading: metaLoading } = useLive<JiraMeta>(
    open ? `/api/jira/meta?${metaParams.toString()}` : null,
    { refreshInterval: 0 },
  );

  // Look up the chosen parent's title (and its parent) before creating.
  const { data: parent, isLoading: parentLoading } = useLive<{
    key: string;
    summary?: string;
    issuetype?: string;
    grandparent?: { key: string; summary: string } | null;
  }>(open && parentLookupKey && parentKeyValid ? `/api/jira/ticket/${parentLookupKey}` : null, {
    refreshInterval: 0,
  });

  const willRemoveLink = !!linkedKey && parentMode !== "linked";
  const issueTypeName = resolvedParentKey ? issueTypeForParent(parent?.issuetype) : "Task";
  const parentMissing = !!resolvedParentKey && !parentLoading && !parent?.key;
  const descriptionValid = description.trim().length > 0;

  const create = useCallback(async () => {
    if (creating) return;
    const trimmedSummary = summary.trim();
    if (!trimmedSummary) {
      toast.error("Add a summary first.");
      return;
    }
    if (!otherKeyValid) {
      toast.error("That parent key doesn't look like a Jira key.");
      return;
    }
    if (parentLoading) {
      toast.error("Still checking the parent ticket.");
      return;
    }
    if (parentMissing) {
      toast.error("That parent ticket wasn't found in Jira.");
      return;
    }
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      toast.error("Add a description first.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/jira/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey,
          summary: trimmedSummary,
          description: trimmedDescription,
          parentKey: resolvedParentKey,
          issuetypeName: issueTypeName,
          assignToMe: true,
          sprintId: includeSprint ? meta?.sprint?.id ?? null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Create failed (${res.status})`);
      }
      const created = (await res.json()) as { key: string; url: string };
      toast.success(`Created ${created.key}`, {
        duration: 12000,
        action: {
          label: "Open in Jira",
          onClick: () => window.open(created.url, "_blank", "noopener,noreferrer"),
        },
      });
      onCreated(created.key, created.url);
      // Refresh the "My Tickets" widgets so the new ticket shows up.
      void globalMutate("/api/jira/tickets");
      void globalMutate("/api/sidebar/counts");
      onClose();
    } catch (e) {
      console.error("create jira issue:", e);
      toast.error(e instanceof Error ? e.message : "Couldn't create the ticket.");
    } finally {
      setCreating(false);
    }
  }, [
    creating,
    summary,
    otherKeyValid,
    parentLoading,
    parentMissing,
    projectKey,
    description,
    resolvedParentKey,
    issueTypeName,
    includeSprint,
    meta,
    onCreated,
    onClose,
    toast,
  ]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      dismissOnBackdrop={false}
      title="Add to Jira"
      description="Create a Task in Jira from this to-do."
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={create}
            disabled={
              creating ||
              !summary.trim() ||
              !descriptionValid ||
              !otherKeyValid ||
              parentLoading ||
              parentMissing
            }
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {creating ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> Creating…
              </span>
            ) : (
              "Create ticket"
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Summary */}
        <label className="block">
          <span className="text-xs font-medium" style={{ color: "var(--text-subtle)" }}>
            Summary
          </span>
          <input
            className="input mt-1 w-full"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ticket summary"
            autoFocus
          />
        </label>

        {/* Parent selection */}
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium" style={{ color: "var(--text-subtle)" }}>
            Create under
          </legend>

          {linkedKey && (
            <ParentRadio
              checked={parentMode === "linked"}
              onSelect={() => setParentMode("linked")}
              label={`Linked ticket (${linkedKey})`}
              hint="New Task’s parent is set to the ticket already on this to-do."
            />
          )}

          <ParentRadio
            checked={parentMode === "other"}
            onSelect={() => setParentMode("other")}
            label="Another ticket"
            hint="e.g. an epic like PTF-3896 - the new Task is parented to it."
          >
            {parentMode === "other" && (
              <input
                className="input mt-1.5 w-full font-mono"
                value={otherKey}
                onChange={(e) => setOtherKey(e.target.value)}
                placeholder="PTF-3896"
                style={
                  otherKey && !otherKeyValid ? { borderColor: "var(--danger, #e5484d)" } : undefined
                }
                autoFocus
              />
            )}
          </ParentRadio>

          <ParentRadio
            checked={parentMode === "none"}
            onSelect={() => setParentMode("none")}
            label="No parent"
            hint="Create a standalone Task."
          />
        </fieldset>

        {willRemoveLink && (
          <div
            className="flex items-start gap-2 rounded px-2.5 py-2 text-xs"
            style={{ background: "var(--bg)", border: "1px solid var(--border-muted)", color: "var(--text-muted)" }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "var(--warning, #d9a514)" }} />
            <span>
              <strong style={{ color: "var(--text)" }}>{linkedKey}</strong> will be removed from this
              to-do and replaced with the new ticket.
            </span>
          </div>
        )}

        {/* Description */}
        <div className="block">
          <span className="text-xs font-medium" style={{ color: "var(--text-subtle)" }}>
            Description
          </span>
          <div className="mt-1">
            <RichTextField onChangeMarkdown={setDescription} />
          </div>
        </div>

        {/* Detected context - confirm before creating */}
        <div className="rounded-lg p-3" style={{ background: "var(--bg)", border: "1px solid var(--border-muted)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--text-subtle)" }}>
              Will be created as
            </span>
            {metaLoading && <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-subtle)" }} />}
          </div>
          <dl className="space-y-1.5 text-xs">
            <MetaRow label="Project" value={projectKey} />
            <MetaRow label="Type" value={issueTypeName} />
            <MetaRow
              label="Parent"
              value={
                resolvedParentKey ? (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    <span className="font-mono">{resolvedParentKey}</span>
                    {parentLoading ? (
                      <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-subtle)" }} />
                    ) : parent?.summary ? (
                      <span style={{ color: "var(--text-subtle)" }}>· {parent.summary}</span>
                    ) : (
                      <span style={{ color: "var(--warning, #d9a514)" }}>· not found</span>
                    )}
                  </span>
                ) : (
                  "None (standalone)"
                )
              }
            />
            {parent?.grandparent && (
              <MetaRow
                label="Parent's parent"
                value={
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    <span className="font-mono">{parent.grandparent.key}</span>
                    {parent.grandparent.summary ? (
                      <span style={{ color: "var(--text-subtle)" }}>· {parent.grandparent.summary}</span>
                    ) : null}
                  </span>
                }
              />
            )}
            <MetaRow label="Assignee" value={meta?.me?.displayName ?? "Me"} />
            <MetaRow label="Board" value={meta?.board?.name ?? (meta?.configured === false ? "Jira not configured" : "-")} />
            <MetaRow
              label="Sprint"
              value={
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeSprint && !!meta?.sprint}
                    disabled={!meta?.sprint}
                    onChange={(e) => setIncludeSprint(e.target.checked)}
                  />
                  <span>{meta?.sprint ? meta.sprint.name : "No active sprint found"}</span>
                </label>
              }
            />
            <MetaRow label="Team" value={meta?.teamLabel ?? "-"} />
          </dl>
        </div>
      </div>
    </ModalShell>
  );
}

function ParentRadio({
  checked,
  onSelect,
  label,
  hint,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="cursor-pointer rounded-lg px-2.5 py-2"
      style={{
        border: `1px solid ${checked ? "var(--accent)" : "var(--border-muted)"}`,
        background: checked ? "var(--accent-dim)" : "transparent",
      }}
    >
      <div className="flex items-start gap-2">
        {checked ? (
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
        ) : (
          <Circle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--text-subtle)" }} />
        )}
        <div className="min-w-0">
          <div className="text-sm" style={{ color: "var(--text)" }}>
            {label}
          </div>
          <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {hint}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ color: "var(--text-subtle)" }}>{label}</dt>
      <dd className="truncate text-right" style={{ color: "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}
