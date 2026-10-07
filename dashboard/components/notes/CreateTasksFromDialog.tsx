"use client";

import { useEffect, useMemo, useState } from "react";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ModalShell } from "@/components/shell/ModalShell";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { Trash2 } from "lucide-react";
import { JIRA_KEY_RE } from "@/lib/utils";
import {
  buildCreateTasksFromPrompt,
  createTasksPlanUrl,
  type PlanWorkItem,
} from "@/lib/notes/create-tasks-from";
import { parseEntityLinksFromMarkdown } from "@/lib/entity-note";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;

function projectOf(key: string | undefined, fallback = "PTF"): string {
  if (!key) return fallback;
  const prefix = key.split("-")[0]?.toUpperCase();
  return prefix && PROJECT_KEY_RE.test(prefix) ? prefix : fallback;
}

interface PlanPreview {
  title: string;
  workItems: PlanWorkItem[];
  warning?: string;
}

interface Props {
  open: boolean;
  notePath: string;
  /** Latest markdown supplies entity links; the saved note is the preview source. */
  noteMarkdown?: string | null;
  onClose: () => void;
}

export function CreateTasksFromDialog({ open, ...props }: Props) {
  return open ? <CreateTasksFromForm key={props.notePath} {...props} /> : null;
}

function CreateTasksFromForm({ notePath, noteMarkdown, onClose }: Omit<Props, "open">) {
  const linkedFromEditor = useMemo(() => {
    if (!noteMarkdown) return { jira: [] as string[], repos: [] as string[] };
    const links = parseEntityLinksFromMarkdown(noteMarkdown);
    return {
      jira: links.filter((l) => l.kind === "jira").map((l) => l.id),
      repos: links.filter((l) => l.kind === "repo").map((l) => l.id),
    };
  }, [noteMarkdown]);

  const [parentKey, setParentKey] = useState(() => linkedFromEditor.jira[0]?.toUpperCase() ?? "");
  const [projectKey, setProjectKey] = useState(() => projectOf(linkedFromEditor.jira[0]));
  const [epicSummary, setEpicSummary] = useState<string | null>(null);
  const [reposText, setReposText] = useState(() => linkedFromEditor.repos.join(", "));
  const [instructions, setInstructions] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [workItems, setWorkItems] = useState<PlanWorkItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadPreview() {
      try {
        const response = await fetch("/api/notes/create-tasks/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notePath }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Couldn't load the note");
        }
        const result = await response.json() as PlanPreview;
        if (controller.signal.aborted) return;
        setPreview(result);
        setWorkItems(result.workItems);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewError(error instanceof Error ? error.message : "Couldn't load the note");
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }
    void loadPreview();
    return () => controller.abort();
  }, [notePath, attempt]);

  function retryPreview() {
    setPreviewError(null);
    setPreviewLoading(true);
    setAttempt((value) => value + 1);
  }

  const parentValid = !parentKey.trim() || JIRA_KEY_RE.test(parentKey.trim().toUpperCase());
  const projectValid = PROJECT_KEY_RE.test(projectKey.trim().toUpperCase());
  const titlesValid = workItems.every((item) => item.summary.trim().length > 0 && item.summary.trim().length <= 255);
  const parentTitle = epicSummary ?? preview?.title ?? "";

  const promptInput = () => ({
    origin: window.location.origin,
    notePath,
    parentKey: parentKey.trim() || undefined,
    projectKey: projectKey.trim() || undefined,
    epicSummary: parentTitle.trim() || undefined,
    repos: reposText.split(/[,\s]+/).map((repo) => repo.trim()).filter(Boolean),
    instructions: instructions.trim() || undefined,
    workItems: workItems.map((item) => ({ ...item, summary: item.summary.trim() })),
  });

  return (
    <>
      <ModalShell
        open={!agentOpen}
        onClose={onClose}
        title="Create tasks from plan"
        description="Review the ticket titles, then create Jira tickets and linked DevHub tasks."
        maxWidth="max-w-2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!parentValid || !projectValid || !titlesValid || previewLoading || !!previewError || !preview || workItems.length === 0}
              onClick={() => setAgentOpen(true)}
            >
              Launch agent…
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-text-subtle">Parent Jira key (optional)</span>
            <input
              className="input mt-1 w-full font-mono"
              value={parentKey}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setParentKey(v);
                if (v) setProjectKey(projectOf(v));
              }}
              placeholder="PTF-4484 — sub-tasks attach here"
              style={parentKey && !parentValid ? { borderColor: "var(--danger)" } : undefined}
            />
            <span className="mt-1 block text-xs text-text-subtle">
              Leave blank to create a new parent ticket, with a child ticket for each work item.
            </span>
          </label>

          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">Project</span>
              <input
                className="input mt-1 w-full font-mono"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">New parent ticket title</span>
              <input
                className="input mt-1 w-full"
                value={parentTitle}
                onChange={(e) => setEpicSummary(e.target.value)}
                placeholder={preview?.title ?? "Parent ticket title"}
                disabled={!!parentKey.trim()}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-text-subtle">Repos</span>
            <input
              className="input mt-1 w-full font-mono text-sm"
              value={reposText}
              onChange={(e) => setReposText(e.target.value)}
              placeholder="acme-api, acme-web, acme-worker"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text-subtle">Instructions (optional)</span>
            <textarea
              className="input mt-1 w-full text-sm"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Any extra context for the tickets. Only the work items you keep below will be created."
            />
          </label>

          <section aria-label="Work items" className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">
                {previewLoading ? "Preparing ticket titles…" : `Work items (${workItems.length})`}
              </h3>
              <p className="mt-1 text-xs text-text-subtle">
                Edit titles or remove items before launching. Original issue details stay attached.
              </p>
            </div>
            {previewError ? (
              <FetchError bare message={previewError} onRetry={retryPreview} />
            ) : previewLoading ? (
              <div role="status" aria-label="Preparing ticket titles">
                <SkeletonRows count={3} height={64} />
              </div>
            ) : (
              <>
                {preview?.warning ? (
                  <p role="status" className="tone-panel tone-panel--warning p-3 text-sm">{preview.warning}</p>
                ) : null}
                {workItems.length === 0 ? (
                  <p className="text-sm text-text-subtle">
                    {preview?.workItems.length
                      ? "All work items removed. No tickets will be created."
                      : "No work items found. Add bullets, a checklist, or PR sections to the note and reopen this dialog."}
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {workItems.map((item, index) => (
                      <li key={item.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start gap-2">
                          <label className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs text-text-subtle">Ticket {index + 1} title</span>
                            <input
                              className="input w-full text-sm"
                              value={item.summary}
                              maxLength={255}
                              aria-invalid={!item.summary.trim()}
                              onChange={(event) => {
                                const summary = event.target.value;
                                setWorkItems((items) => items.map((current) => current.id === item.id ? { ...current, summary } : current));
                              }}
                            />
                            {!item.summary.trim() ? <span className="mt-1 block text-xs text-danger">Enter a ticket title.</span> : null}
                          </label>
                          <button
                            type="button"
                            className="btn btn-ghost mt-5 shrink-0"
                            aria-label={`Remove ticket ${index + 1}`}
                            title="Remove this work item"
                            onClick={() => setWorkItems((items) => items.filter((current) => current.id !== item.id))}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                        <details className="mt-2 text-xs text-text-subtle">
                          <summary className="cursor-pointer">Original issue details</summary>
                          <p className="mt-2 whitespace-pre-wrap">{item.title}</p>
                          {item.description && item.description !== item.title ? (
                            <p className="mt-2 whitespace-pre-wrap">{item.description}</p>
                          ) : null}
                          {item.repoHint ? <p className="mt-2">Repo: {item.repoHint}</p> : null}
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      </ModalShell>

      <SkillAgentDialog
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        onLaunched={onClose}
        title="Create tasks from plan"
        description={`Create ${workItems.length} reviewed Jira tickets and linked DevHub tasks.`}
        getPrompt={() => buildCreateTasksFromPrompt(promptInput())}
        summary={`Create tasks from ${notePath}`}
        reason={`Create Jira + DevHub tasks from note ${notePath}`}
        resolveCwd={async () => {
          const res = await fetch(createTasksPlanUrl(promptInput()), { cache: "no-store" });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Couldn't load the plan preview");
          }
          return undefined;
        }}
      />
    </>
  );
}
