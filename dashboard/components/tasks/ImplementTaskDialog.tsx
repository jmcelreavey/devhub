"use client";

import { openNoteHrefInPanel, openNoteInPanel } from "@/lib/notes/open-in-panel";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";
import { ImplementReadyPanel,type ImplementReadyApiResponse } from "@/components/tasks/ImplementReadyPanel";
import { PlanTaskDialog } from "@/components/tasks/PlanTaskDialog";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import type { EntityRef } from "@/lib/entity-note";
import { mergeEntityRefs } from "@/lib/entity-note";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { buildTaskNoteMarkdown } from "@/lib/task-note";
import {
buildTaskImplementPrompt,
taskImplementPlanUrl,
type TaskImplementPromptInput,
} from "@/lib/tasks/implement-prompt";
import type { Task } from "@/lib/tasks/types";
import { jiraBrowseUrl } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { mutate } from "swr";

const PLAN_POLL_MS = 5000;

export function ImplementTaskDialog({
  open,
  task,
  date,
  onClose,
  cwd,
  repoName: hubRepoName,
  autoByDefault = false,
}: {
  open: boolean;
  task: Task;
  date: string;
  onClose: () => void;
  /** Hub checkout — wins over the plan URL when set. */
  cwd?: string;
  repoName?: string;
  /** Opened from "Start on auto": Run on auto is checked, with the model, instructions and worktree still editable. */
  autoByDefault?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  // Links edited from the checklist show immediately, before /api/tasks refetches.
  const [linksOverride, setLinksOverride] = useState<EntityRef[] | null>(null);
  const links = linksOverride ?? task.links ?? [];
  const repoIds = links.filter((link) => link.kind === "repo").map((l) => l.id);

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(
    repoIds.length === 1 ? repoIds[0]! : null,
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRunning, setPlanRunning] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);

  const effectiveRepoId = hubRepoName ?? selectedRepoId ?? (repoIds.length === 1 ? repoIds[0] : null);
  const repoName = effectiveRepoId ?? undefined;

  const readyKey = useMemo(() => {
    if (!open) return null;
    const params = new URLSearchParams({ taskId: task.id, date, hardBlock: "0" });
    if (selectedRepoId) params.set("selectedRepoId", selectedRepoId);
    if (hubRepoName) params.set("hubRepoId", hubRepoName);
    return `/api/tasks/implement/ready?${params.toString()}`;
  }, [open, task.id, date, selectedRepoId, hubRepoName]);

  const {
    data: ready,
    isLoading: readyLoading,
    mutate: refreshReady,
  } = useLive<ImplementReadyApiResponse>(readyKey, {
    // A launched plan agent writes the note out of band; poll until it lands.
    refreshInterval: (latest) => (planRunning && !latest?.noteExists ? PLAN_POLL_MS : 0),
    revalidateOnFocus: false,
  });

  const noteSource = {
    notePath: task.notePath,
    id: task.id,
    text: task.text,
    date,
    jiraKey: task.jiraKey,
    jiraUrl: task.jiraKey ? jiraBrowseUrl(task.jiraKey) : undefined,
    related: links,
  };

  const promptInput = (): TaskImplementPromptInput => ({
    origin: typeof window === "undefined" ? "" : window.location.origin,
    taskId: task.id,
    date,
    repoName,
    cwd,
    jiraKey: task.jiraKey,
  });

  const planRequest = useRef<{ key: string; promise: Promise<string | undefined> } | null>(null);
  const planKey = `${task.id}:${date}:${repoName ?? ""}:${task.jiraKey ?? ""}`;
  // The plan endpoint talks to Jira. Start it while the sheet is open so Start chat does not wait on it.
  const loadPlanPath = useCallback(() => {
    const current = planRequest.current;
    if (current?.key === planKey) return current.promise;
    const promise = fetch(taskImplementPlanUrl({
      origin: typeof window === "undefined" ? "" : window.location.origin,
      taskId: task.id, date, repoName, cwd, jiraKey: task.jiraKey,
    }), { cache: "no-store" }).then(async (response) => {
      const plan = (await response.json().catch(() => ({}))) as { error?: string; repoPath?: string | null };
      if (!response.ok) throw new Error(plan.error || "Couldn't load the task implementation plan");
      return plan.repoPath ?? undefined;
    }).catch((err: unknown) => {
      if (planRequest.current?.promise === promise) planRequest.current = null;
      throw err;
    });
    planRequest.current = { key: planKey, promise };
    return promise;
  }, [planKey, task.id, date, repoName, cwd, task.jiraKey]);
  useEffect(() => {
    if (!open || cwd) return;
    void loadPlanPath().catch(() => undefined);
  }, [open, cwd, loadPlanPath]);

  const close = () => {
    setLinksOverride(null);
    setPlanRunning(false);
    onClose();
  };

  const navigate = (href: string) => {
    close();
    router.push(href);
  };

  const ensureNote = async () => {
    if (!ready) throw new Error("Checklist not loaded");
    const result = await createOrOpenVaultNote({
      path: ready.notePath,
      markdown: buildTaskNoteMarkdown(noteSource),
    });
    await refreshReady();
    return result;
  };

  const saveLinks = async (picked: EntityRef[]) => {
    const next = mergeEntityRefs(links, picked);
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, date, links: next }),
    });
    if (!res.ok) throw new Error(await res.text());
    setLinksOverride(next);
    const nextRepos = next.filter((l) => l.kind === "repo").map((l) => l.id);
    // Keep an existing pick; a newly added repo only becomes the start when none was chosen.
    setSelectedRepoId((current) =>
      current && nextRepos.some((id) => id.toLowerCase() === current.toLowerCase())
        ? current
        : nextRepos.length === 1
          ? nextRepos[0]!
          : null,
    );
    void mutate("/api/tasks");
    await refreshReady();
    toast.success("Link added");
  };

  return (
    <>
      <SkillAgentDialog
        open={open}
        onClose={close}
        title="Implement with agent"
        allowAuto={!task.done && !task.abandonedAt}
        autoByDefault={autoByDefault}
        description="Starts on your saved Implement tier. Pick another tier, agent or model to override it for this run."
        getPrompt={() => buildTaskImplementPrompt(promptInput())}
        cwd={cwd}
        repoName={repoName}
        summary={`Implement ${task.text}`}
        reason={`Implement DevHub task ${task.id}`}
        taskId={task.id}
        taskDate={date}
        banner={
          <ImplementReadyPanel
            loading={readyLoading}
            ready={ready ?? null}
            repoIds={repoIds}
            selectedRepoId={selectedRepoId}
            onSelectRepo={setSelectedRepoId}
            actions={{
              onNavigate: (href) => { if (!openNoteHrefInPanel(href)) navigate(href); },
              onOpenNote: () => {
                ensureNote()
                  .then((result) => openNoteInPanel(result.path))
                  .catch(() => toast.error("Couldn't open task note."));
              },
              onGeneratePlan: () => setPlanOpen(true),
              onCreateNote: () => {
                setCreatingNote(true);
                ensureNote()
                  .then(() => toast.success("Task note created"))
                  .catch(() => toast.error("Couldn't create task note."))
                  .finally(() => setCreatingNote(false));
              },
              onLinkRepo: () => setLinkOpen(true),
              creatingNote,
              planRunning: planRunning && !ready?.noteExists,
            }}
          />
        }
        resolveCwd={cwd ? undefined : () => loadPlanPath()}
      />
      <PlanTaskDialog
        open={open && planOpen}
        task={{ ...task, links }}
        date={date}
        cwd={cwd}
        repoName={repoName}
        onClose={() => setPlanOpen(false)}
        onLaunched={() => setPlanRunning(true)}
      />
      <EntityLinkDialog
        open={open && linkOpen}
        onClose={() => setLinkOpen(false)}
        defaultKind="repo"
        excludeTaskId={task.id}
        existing={links}
        title="Link repo"
        description="Link a repo (or anything else) to this task. Existing links stay."
        onSave={saveLinks}
      />
    </>
  );
}
