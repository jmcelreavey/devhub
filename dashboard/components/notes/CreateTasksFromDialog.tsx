"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { JIRA_KEY_RE } from "@/lib/utils";
import {
  buildCreateTasksFromPrompt,
  createTasksPlanUrl,
  type PlanWorkItem,
} from "@/lib/notes/create-tasks-from";
import { parseEntityLinksFromMarkdown } from "@/lib/entity-note";
import type { EntityRef } from "@/lib/entity-note";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;

function projectOf(key: string | undefined, fallback = "PTF"): string {
  if (!key) return fallback;
  const prefix = key.split("-")[0]?.toUpperCase();
  return prefix && PROJECT_KEY_RE.test(prefix) ? prefix : fallback;
}

type PlanPreview = {
  title: string;
  workItems: PlanWorkItem[];
  repos: string[];
  noteLinks: EntityRef[];
};

export function CreateTasksFromDialog({
  open,
  notePath,
  noteMarkdown,
  onClose,
}: {
  open: boolean;
  notePath: string;
  /** Latest markdown from the editor when available; plan API still canonical. */
  noteMarkdown?: string | null;
  onClose: () => void;
}) {
  const linkedFromEditor = useMemo(() => {
    if (!noteMarkdown) return { jira: [] as string[], repos: [] as string[] };
    const links = parseEntityLinksFromMarkdown(noteMarkdown);
    return {
      jira: links.filter((l) => l.kind === "jira").map((l) => l.id),
      repos: links.filter((l) => l.kind === "repo").map((l) => l.id),
    };
  }, [noteMarkdown]);

  const [parentKey, setParentKey] = useState("");
  const [projectKey, setProjectKey] = useState("PTF");
  const [epicSummary, setEpicSummary] = useState("");
  const [reposText, setReposText] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParentKey(linkedFromEditor.jira[0]?.toUpperCase() ?? ""); // eslint-disable-line react-hooks/set-state-in-effect -- reset form when dialog opens
    setProjectKey(projectOf(linkedFromEditor.jira[0]));
    setReposText(linkedFromEditor.repos.join(", "));
    setEpicSummary("");
    setAgentOpen(false);
  }, [open, linkedFromEditor.jira, linkedFromEditor.repos]);

  const previewParams = useMemo(() => {
    const params = new URLSearchParams({ notePath });
    const pk = parentKey.trim().toUpperCase();
    if (pk) params.set("parentKey", pk);
    if (projectKey.trim()) params.set("projectKey", projectKey.trim().toUpperCase());
    if (epicSummary.trim()) params.set("epicSummary", epicSummary.trim());
    for (const repo of reposText.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean)) {
      params.append("repo", repo);
    }
    return params.toString();
  }, [notePath, parentKey, projectKey, epicSummary, reposText]);

  const { data: preview, isLoading: previewLoading } = useLive<PlanPreview>(
    open ? `/api/notes/create-tasks/plan?${previewParams}` : null,
    { refreshInterval: 0 },
  );

  useEffect(() => {
    if (!open || epicSummary.trim() || !preview?.title) return;
    setEpicSummary(preview.title); // eslint-disable-line react-hooks/set-state-in-effect -- seed parent summary from plan title once
  }, [open, epicSummary, preview?.title]);

  const parentValid = !parentKey.trim() || JIRA_KEY_RE.test(parentKey.trim().toUpperCase());
  const workCount = preview?.workItems.length ?? 0;

  const promptInput = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const repos = reposText
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    return {
      origin,
      notePath,
      parentKey: parentKey.trim() || undefined,
      projectKey: projectKey.trim() || undefined,
      epicSummary: epicSummary.trim() || undefined,
      repos,
    };
  };

  return (
    <>
      <ModalShell
        open={open && !agentOpen}
        onClose={onClose}
        title="Create tasks from plan"
        description="Publish the gist, create Jira sub-tasks and DevHub tasks, and link everything back to this note."
        maxWidth="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!parentValid || previewLoading || workCount === 0}
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
              Leave blank to create a new parent Story/Task, then sub-tasks per PR section.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">Project</span>
              <input
                className="input mt-1 w-full font-mono"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">Parent summary</span>
              <input
                className="input mt-1 w-full"
                value={epicSummary}
                onChange={(e) => setEpicSummary(e.target.value)}
                placeholder={preview?.title ?? "Epic title"}
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

          <div
            className="rounded-lg p-3 text-xs"
            style={{ background: "var(--bg)", border: "1px solid var(--border-muted)" }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-text-subtle">Detected work items</span>
              {previewLoading ? <Loader2 size={12} className="animate-spin text-text-subtle" /> : null}
            </div>
            {workCount === 0 && !previewLoading ? (
              <p className="text-text-subtle">
                No <code className="font-mono">PR N —</code> headings found. Add PR sections to the note or
                the agent will ask how to slice it.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {(preview?.workItems ?? []).map((item) => (
                  <li key={item.id} className="text-text">
                    <span className="font-mono text-text-subtle">{item.id}</span> {item.summary}
                    {item.repoHint ? (
                      <span className="text-text-subtle"> · {item.repoHint}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ModalShell>

      <SkillAgentDialog
        open={agentOpen}
        onClose={() => {
          setAgentOpen(false);
          onClose();
        }}
        title="Create tasks from plan"
        description="Agent will publish the gist, create Jira tickets and DevHub tasks, and wire entity links."
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
