"use client";

import Link from "next/link";
import { GitPullRequest, Link2, ListTodo, StickyNote, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useLive } from "@/lib/use-fetch";
import { dailyNotePath, todayISO } from "@/lib/utils";

interface NoteLink {
  id: string;
  kind: "task" | "pr";
  label: string;
  href?: string;
}

interface NotePayload {
  content?: unknown[];
}

interface TaskRow {
  id: string;
  text: string;
  done?: boolean;
}

interface TasksPayload {
  tasks?: TaskRow[];
}

const DISMISS_KEY = "devhub.note-task-links.dismissed-day";
const PR_URL_RE = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/gi;

function readDismissedDay(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedDay(day: string | null) {
  try {
    if (day) localStorage.setItem(DISMISS_KEY, day);
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

function walkBlocks(blocks: unknown[], visit: (block: Record<string, unknown>) => void) {
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    visit(block);
    if (Array.isArray(block.children)) walkBlocks(block.children, visit);
  }
}

/** Pull taskRef blocks + GitHub PR URLs from today's note content. */
function extractNoteLinks(content: unknown[] | undefined): NoteLink[] {
  if (!Array.isArray(content)) return [];
  const links: NoteLink[] = [];
  const seen = new Set<string>();

  const add = (link: NoteLink) => {
    if (seen.has(link.id)) return;
    seen.add(link.id);
    links.push(link);
  };

  walkBlocks(content, (block) => {
    if (block.type === "taskRef") {
      const props = (block.props ?? {}) as Record<string, unknown>;
      const taskId = typeof props.taskId === "string" ? props.taskId : "";
      const date = typeof props.date === "string" ? props.date : "";
      const label = typeof props.label === "string" ? props.label.trim() : "";
      if (!taskId || !date) return;
      add({
        id: `task:${date}:${taskId}`,
        kind: "task",
        label: `${date} · ${label || taskId}`,
        href: "/work?tab=tasks",
      });
      return;
    }

    const contentArr = block.content;
    if (!Array.isArray(contentArr)) return;
    for (const inline of contentArr) {
      if (!inline || typeof inline !== "object") continue;
      const text = (inline as { text?: unknown }).text;
      if (typeof text !== "string") continue;
      PR_URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PR_URL_RE.exec(text)) !== null) {
        const repo = m[1];
        const num = m[2];
        add({
          id: `pr:${repo}#${num}`,
          kind: "pr",
          label: `${repo}#${num}`,
          href: `https://github.com/${repo}/pull/${num}`,
        });
      }
    }
  });

  return links;
}

/** Bidirectional note ↔ task links for Today (task-refs in today's note + open tasks). */
export function NoteTaskLinksPanel() {
  const today = todayISO();
  const notePath = dailyNotePath(today);
  const { data: note } = useLive<NotePayload>(`/api/notes/${notePath}`, { refreshInterval: 60_000 });
  const { data: tasks } = useLive<TasksPayload>("/api/tasks");
  const [dismissedDay, setDismissedDay] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readDismissedDay(),
  );

  const dismissed = dismissedDay === today;

  const dismiss = useCallback(() => {
    writeDismissedDay(today);
    setDismissedDay(today);
  }, [today]);

  const restore = useCallback(() => {
    writeDismissedDay(null);
    setDismissedDay(null);
  }, []);

  if (dismissed) {
    return (
      <div className="mb-3">
        <button
          type="button"
          className="text-[11px] text-text-muted underline-offset-2 hover:text-text-subtle hover:underline"
          onClick={restore}
        >
          Show note ↔ task
        </button>
      </div>
    );
  }

  const noteLinks = extractNoteLinks(note?.content);
  const taskLinks = noteLinks.filter((n) => n.kind === "task");
  const prLinks = noteLinks.filter((n) => n.kind === "pr");

  const openTasks = (tasks?.tasks ?? []).filter((t) => !t.done);
  const linkedTaskIds = new Set(
    taskLinks.map((n) => n.id.split(":").pop()).filter(Boolean) as string[],
  );

  return (
    <section
      className="mb-3 rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
      aria-label="Note and task links"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <Link2 size={13} aria-hidden />
          Note ↔ task
        </div>
        <button type="button" className="hub-icon-btn shrink-0" aria-label="Dismiss note task links" onClick={dismiss}>
          <X size={12} />
        </button>
      </div>

      <div className="grid gap-3 text-xs text-text-subtle sm:grid-cols-2">
        <div>
          <div className="mb-1 inline-flex items-center gap-1 font-medium text-text-muted">
            <StickyNote size={11} /> From today&apos;s note
          </div>
          {taskLinks.length === 0 && prLinks.length === 0 ? (
            <p>No task-refs or PR links in the daily note yet.</p>
          ) : (
            <ul className="space-y-1">
              {taskLinks.map((n) => (
                <li key={n.id} className="flex items-center gap-1">
                  <ListTodo size={11} aria-hidden />
                  <Link href={n.href ?? "/work"} className="text-accent hover:underline">
                    {n.label}
                  </Link>
                </li>
              ))}
              {prLinks.map((n) => (
                <li key={n.id} className="flex items-center gap-1">
                  <GitPullRequest size={11} aria-hidden />
                  <a href={n.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 inline-flex items-center gap-1 font-medium text-text-muted">
            <ListTodo size={11} /> Open tasks
          </div>
          {openTasks.length === 0 ? (
            <p>Queue empty.</p>
          ) : (
            <ul className="space-y-1">
              {openTasks.slice(0, 8).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className={linkedTaskIds.has(t.id) ? "text-text" : "text-text-subtle"}>{t.text}</span>
                  {linkedTaskIds.has(t.id) ? (
                    <span className="badge badge-muted">linked</span>
                  ) : (
                    <Link
                      href={`/notes/${notePath}`}
                      className="shrink-0 text-[11px] text-accent hover:underline"
                      title="Open daily note to insert a task-ref"
                    >
                      link in note
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
