"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate as globalMutate } from "swr";
import { Loader2, CheckCircle2, Circle, AlertTriangle, Sparkles } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { RichTextField } from "@/components/ui/RichTextField";
import { FetchError } from "@/components/ui/FetchError";
import { JiraKeyChip } from "@/components/jira/JiraKeyChip";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { JIRA_KEY_RE, todayISO } from "@/lib/utils";
import { creationParentForLinkedIssue, issueTypeForParent } from "@/lib/jira/issue-type";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { JiraMeta } from "@/lib/jira/client";
import type { JiraTicketDraftResult } from "@/lib/jira/draft-ticket";
import { DRAFT_NDJSON_TYPE, DRAFT_STEPS, parseNdjsonChunk, type DraftEvent, type DraftStepId } from "@/lib/jira/draft-events";
import type { Task } from "@/components/tasks/TaskList";

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
  date?: string;
  generateOnOpen?: boolean;
  onClose: () => void;
  /** Called after a ticket is created so the caller can rewrite the task text. */
  onCreated: (newKey: string, newUrl: string) => void;
}

export function AddToJiraModal({ open, task, date, generateOnOpen = false, onClose, onCreated }: AddToJiraModalProps) {
  const toast = useToast();
  const linkedKey = task.jiraKey;

  // Modal mounts fresh per open, so initial state derives straight from the task.
  const [summary, setSummary] = useState(() => summaryFromTask(task.text, linkedKey));
  const [description, setDescription] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const [generating, setGenerating] = useState(generateOnOpen);
  const [draftAttempt, setDraftAttempt] = useState(generateOnOpen ? 1 : 0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<DraftStepId, DraftStepView> | null>(() => (generateOnOpen ? freshDraftSteps() : null));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [streamedDescription, setStreamedDescription] = useState("");
  const sawSteps = useRef(false);
  const taskDate = date ?? todayISO();
  const [parentMode, setParentMode] = useState<ParentMode>(linkedKey ? "linked" : "none");
  const [otherKey, setOtherKey] = useState("");
  const [includeSprint, setIncludeSprint] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!generating) return;
    // Zero is set in the click handler. The interval only publishes the clock.
    const origin = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - origin), 200);
    return () => clearInterval(timer);
  }, [generating, draftAttempt]);

  useEffect(() => {
    if (!open || draftAttempt === 0) return;
    const controller = new AbortController();
    async function loadDraft() {
      let streamed = "";
      let finished = false;
      const apply = (event: DraftEvent) => {
        if (event.type === "step") {
          sawSteps.current = true;
          setProgress((current) => {
            const prev = current ?? freshDraftSteps();
            const step = prev[event.step];
            return {
              ...prev,
              [event.step]: {
                status: event.status,
                startedAt: event.status === "running" ? event.at : step.startedAt ?? event.at,
                endedAt: event.status === "done" || event.status === "error" ? event.at : undefined,
                detail: event.detail,
              },
            };
          });
          return;
        }
        if (event.type === "partial") {
          if (event.summary) setSummary(event.summary);
          if (event.description) {
            streamed = event.description;
            setStreamedDescription(event.description);
          }
          return;
        }
        if (event.type === "result") {
          finished = true;
          setSummary(event.draft.summary);
          setDescription(event.draft.description);
          setInitialDescription(event.draft.description);
          setDraftWarnings(event.draft.warnings ?? []);
          setStreamedDescription("");
          setProgress(null);
          return;
        }
        finished = true;
        setDraftError(event.message);
        const failedStep = event.step;
        if (failedStep) {
          setProgress((current) => {
            if (!current) return current;
            const next = { ...current };
            for (const id of Object.keys(next) as DraftStepId[]) {
              if (id !== failedStep && next[id].status === "running") next[id] = { ...next[id], status: "pending" };
            }
            next[failedStep] = { ...next[failedStep], status: "error", endedAt: event.totalMs, detail: event.message };
            return next;
          });
        }
        if (streamed) {
          setDescription(streamed);
          setInitialDescription(streamed);
        }
      };
      try {
        const response = await fetch("/api/jira/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: `${DRAFT_NDJSON_TYPE}, application/json` },
          body: JSON.stringify({ taskId: task.id, date: taskDate }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        await readDraftResponse(response, controller.signal, apply);
        if (!finished && !controller.signal.aborted) throw new Error("The draft ended before it finished.");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!sawSteps.current) setProgress(null);
        setDraftError(error instanceof Error ? error.message : "Couldn't generate the Jira draft.");
      } finally {
        if (!controller.signal.aborted) setGenerating(false);
      }
    }
    void loadDraft();
    return () => controller.abort();
  }, [open, draftAttempt, task.id, taskDate]);

  const generateDraft = () => {
    setInitialDescription(description);
    setDraftError(null);
    setDraftWarnings([]);
    setStreamedDescription("");
    setElapsedMs(0);
    sawSteps.current = false;
    setProgress(freshDraftSteps());
    setGenerating(true);
    setDraftAttempt((attempt) => attempt + 1);
  };

  const resolvedParentKey =
    parentMode === "linked" ? linkedKey ?? null : parentMode === "other" ? otherKey.trim().toUpperCase() || null : null;

  const projectKey = projectOf(
    parentMode === "linked" ? linkedKey : parentMode === "other" ? resolvedParentKey ?? undefined : linkedKey,
  );

  const otherKeyValid = parentMode !== "other" || JIRA_KEY_RE.test(otherKey.trim().toUpperCase());

  const parentLookupKey = resolvedParentKey?.trim().toUpperCase() ?? null;
  const parentKeyValid = !parentLookupKey || JIRA_KEY_RE.test(parentLookupKey);

  // Look up the chosen parent's title (and its parent) before creating.
  const { data: parent, isLoading: parentLoading, error: parentError, mutate: retryParent } = useLive<{
    key: string;
    summary?: string;
    issuetype?: string;
    parent?: { key: string; summary?: string; issuetype?: string } | null;
    grandparent?: { key: string; summary?: string } | null;
  }>(open && parentLookupKey && parentKeyValid ? `/api/jira/ticket/${parentLookupKey}` : null, {
    refreshInterval: 0,
  });

  const creationParent = parent ? (parentMode === "linked" ? creationParentForLinkedIssue(parent) : parent) : null;
  const creationParentKey = resolvedParentKey ? creationParent?.key ?? resolvedParentKey : null;
  const metaParams = new URLSearchParams({ project: projectKey });
  if (creationParentKey) metaParams.set("reference", creationParentKey);
  const { data: meta, isLoading: metaLoading, error: metaError, mutate: retryMeta } = useLive<JiraMeta>(open ? `/api/jira/meta?${metaParams.toString()}` : null, { refreshInterval: 0 });

  const willRemoveLink = !!linkedKey && parentMode !== "linked";
  const issueTypeName = creationParentKey ? issueTypeForParent(creationParent?.issuetype) : "Task";
  const parentMissing = !!resolvedParentKey && !parentLoading && !parent?.key;
  const summaryValid = summary.trim().length > 0 && summary.trim().length <= 255;
  const descriptionValid = description.trim().length > 0 && description.trim().length <= 5_000;
  const contextReady = meta?.configured === true && !metaLoading && !metaError;
  const canCreate =
    !creating &&
    !generating &&
    contextReady &&
    summaryValid &&
    descriptionValid &&
    otherKeyValid &&
    !parentLoading &&
    !parentMissing;

  const create = useCallback(async () => {
    if (creating || generating) return;
    if (!contextReady) {
      toast.error("Wait for Jira settings to load before creating the ticket.");
      return;
    }
    const trimmedSummary = summary.trim();
    if (!summaryValid) {
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
    if (!descriptionValid) {
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
          parentKey: creationParentKey,
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
          onClick: () => void openInBrowser(created.url),
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
    generating,
    contextReady,
    summaryValid,
    descriptionValid,
    summary,
    otherKeyValid,
    parentLoading,
    parentMissing,
    projectKey,
    description,
    creationParentKey,
    includeSprint,
    meta,
    onCreated,
    onClose,
    toast,
  ]);

  return (
    <ModalShell
      open={open}
      onClose={() => { if (!creating) onClose(); }}
      dismissOnBackdrop={false}
      title="Create Jira ticket"
      description="Review and edit the title and description, then create the ticket."
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={create}
            disabled={!canCreate}
            style={canCreate ? { background: "var(--accent)", color: "var(--accent-fg)" } : undefined}
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
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-subtle">Use the task and linked references to draft this ticket.</span>
          <button type="button" className="btn btn-ghost shrink-0" onClick={generateDraft} disabled={generating || creating}>
            <Sparkles size={13} aria-hidden />
            {generating ? "Generating…" : "Generate draft"}
          </button>
        </div>
        {draftError && <FetchError bare message={draftError} onRetry={generateDraft} />}
        {draftWarnings.length > 0 && (
          <div className="tone-panel tone-panel--warning text-xs" role="status">
            {draftWarnings.join(" ")} Check the draft against the missing references.
          </div>
        )}
        {/* Summary */}
        <label className="block">
          <span className="text-xs font-medium text-text-subtle">
            Title
          </span>
          <input
            className="input mt-1 w-full"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ticket title"
            maxLength={255}
            disabled={generating || creating}
            autoFocus
          />
          {summary.trim().length > 255 && (
            <p className="mt-1 text-xs text-danger" role="alert">Keep the title within 255 characters.</p>
          )}
        </label>

        {/* Parent selection */}
        <fieldset className="space-y-1.5" disabled={creating} inert={creating}>
          <legend className="text-xs font-medium text-text-subtle">
            Create under
          </legend>

          {linkedKey && (
            <ParentRadio
              checked={parentMode === "linked"}
              onSelect={() => setParentMode("linked")}
              label={`Linked ticket (${linkedKey})`}
              hint="Uses this ticket’s parent when it has one, so the new ticket sits alongside it."
            />
          )}

          <ParentRadio
            checked={parentMode === "other"}
            onSelect={() => setParentMode("other")}
            label="Another ticket"
            hint="Enter the key of the epic or ticket this work belongs under."
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
              <strong className="text-text">{linkedKey}</strong> will be removed from this
              to-do and replaced with the new ticket.
            </span>
          </div>
        )}

        {/* Description */}
        <div className="block" role="group" aria-label="Description">
          <span className="text-xs font-medium text-text-subtle">
            Description
          </span>
          <div className="mt-1">
            {progress && (
              <div className="mb-3">
                <DraftProgressList steps={progress} elapsedMs={generating ? elapsedMs : null} />
              </div>
            )}
            {generating && streamedDescription ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs text-text">{streamedDescription}</pre>
            ) : generating ? null : (
              <RichTextField initialMarkdown={initialDescription} disabled={creating} onChangeMarkdown={setDescription} />
            )}
            {description.trim().length > 5_000 && (
              <p className="mt-1 text-xs text-danger" role="alert">Keep the description within 5,000 characters.</p>
            )}
          </div>
        </div>

        {parentError && <FetchError bare message="Couldn't check the parent ticket." onRetry={() => void retryParent()} />}
        {metaError && <FetchError bare message="Couldn't load Jira settings." onRetry={() => void retryMeta()} />}

        {/* Detected context - confirm before creating */}
        <div className="rounded-lg p-3" style={{ background: "var(--bg)", border: "1px solid var(--border-muted)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-subtle">
              Will be created as
            </span>
            {metaLoading && <span className="skeleton inline-block h-3 w-16" aria-label="Loading Jira settings" />}
          </div>
          <dl className="space-y-1.5 text-xs">
            <MetaRow label="Project" value={projectKey} />
            <MetaRow label="Type" value={issueTypeName} />
            <MetaRow
              label="Parent"
              value={
                creationParentKey ? (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    <JiraKeyChip jiraKey={creationParentKey} label={`Copy parent ticket key ${creationParentKey}`} />
                    {parentLoading ? (
                      <span className="skeleton inline-block h-3 w-16" aria-label="Checking parent" />
                    ) : creationParent?.summary ? (
                      <span className="text-text-subtle">· {creationParent.summary}</span>
                    ) : (
                      <span style={{ color: "var(--warning, #d9a514)" }}>· not found</span>
                    )}
                  </span>
                ) : (
                  "None (standalone)"
                )
              }
            />
            {parentMode !== "linked" && parent?.grandparent && (
              <MetaRow
                label="Parent's parent"
                value={
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    <span className="font-mono">{parent.grandparent.key}</span>
                    {parent.grandparent.summary ? (
                      <span className="text-text-subtle">· {parent.grandparent.summary}</span>
                    ) : null}
                  </span>
                }
              />
            )}
            <MetaRow label="Assignee" value={meta?.me?.displayName ?? "Me"} />
            <MetaRow label="Board" value={meta?.board?.name ?? (meta?.configured === false ? "Jira not configured" : "-")} />
            <MetaRow
              label="Sprint"
              value={issueTypeName === "Sub-task" ? "Inherited from parent" : (
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeSprint && !!meta?.sprint}
                    disabled={creating || !meta?.sprint}
                    onChange={(e) => setIncludeSprint(e.target.checked)}
                  />
                  <span>{meta?.sprint ? meta.sprint.name : "No active sprint found"}</span>
                </label>
              )}
            />
            <MetaRow label="Team" value={meta?.teamLabel ?? "-"} />
          </dl>
        </div>
      </div>
    </ModalShell>
  );
}

interface DraftStepView {
  status: "pending" | "running" | "done" | "error";
  startedAt?: number;
  endedAt?: number;
  detail?: string;
}

function freshDraftSteps(): Record<DraftStepId, DraftStepView> {
  return {
    context: { status: "running", startedAt: 0 },
    jira: { status: "pending" },
    draft: { status: "pending" },
    format: { status: "pending" },
  };
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${(whole % 60).toString().padStart(2, "0")}s`;
}

function stepElapsed(step: DraftStepView, elapsedMs: number | null): string | null {
  if (step.startedAt === undefined) return null;
  if (step.status === "done" || step.status === "error") {
    return formatElapsed((step.endedAt ?? step.startedAt) - step.startedAt);
  }
  if (step.status === "running" && elapsedMs !== null) return formatElapsed(Math.max(0, elapsedMs - step.startedAt));
  return null;
}

function DraftProgressList({ steps, elapsedMs }: { steps: Record<DraftStepId, DraftStepView>; elapsedMs: number | null }) {
  const current = DRAFT_STEPS.find((step) => steps[step.id].status === "running");
  return (
    <div>
      {current && <p className="sr-only" aria-live="polite">{current.label}</p>}
      <ol aria-label="Draft progress" className="space-y-1">
        {DRAFT_STEPS.map((step) => {
          const state = steps[step.id];
          const elapsed = stepElapsed(state, elapsedMs);
          return (
            <li
              key={step.id}
              data-status={state.status}
              aria-current={state.status === "running" ? "step" : undefined}
              className={`flex items-center gap-2 text-xs ${state.status === "error" ? "text-danger" : state.status === "running" ? "font-medium text-text" : "text-text-subtle"}`}
            >
              {state.status === "done" ? (
                <CheckCircle2 size={13} className="shrink-0" aria-hidden />
              ) : state.status === "error" ? (
                <AlertTriangle size={13} className="shrink-0" aria-hidden />
              ) : state.status === "running" ? (
                <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
              ) : (
                <Circle size={13} className="shrink-0" aria-hidden />
              )}
              <span className="min-w-0">{step.label}</span>
              {elapsed && <span className="ml-auto tabular-nums">{elapsed}</span>}
            </li>
          );
        })}
      </ol>
      {elapsedMs !== null && <p className="mt-2 text-xs tabular-nums text-text-subtle">Total {formatElapsed(elapsedMs)}</p>}
    </div>
  );
}

interface DraftFetchResponse {
  ok: boolean;
  status?: number;
  headers?: { get?: (name: string) => string | null };
  json: () => Promise<JiraTicketDraftResult & { error?: string }>;
  body?: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      releaseLock?: () => void;
    };
  } | null;
}

async function readDraftResponse(response: DraftFetchResponse, signal: AbortSignal, onEvent: (event: DraftEvent) => void): Promise<void> {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!contentType.includes(DRAFT_NDJSON_TYPE) || !response.body) {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn't generate the Jira draft.");
    if (signal.aborted) return;
    onEvent({ type: "result", draft: result, totalMs: 0 });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseNdjsonChunk(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) onEvent(event);
    }
  } finally {
    reader.releaseLock?.();
  }
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
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" />
        ) : (
          <Circle size={15} className="mt-0.5 shrink-0 text-text-subtle" />
        )}
        <div className="min-w-0">
          <div className="text-sm text-text">
            {label}
          </div>
          <div className="text-xs text-text-subtle">
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
      <dt className="text-text-subtle">{label}</dt>
      <dd className="truncate text-right text-text">
        {value}
      </dd>
    </div>
  );
}
