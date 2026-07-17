"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  FileText,
  ListTodo,
  Ticket as TicketIcon,
  Compass,
  CheckCircle2,
  Circle,
  Search,
  PenTool,
  BookOpen,
} from "lucide-react";
import { ALL_NAV_DESTINATIONS, filterNavBySetup, type SetupGateStatus } from "@/lib/nav";
import { toggleDensity, toggleMotion } from "@/lib/ui-prefs";
import { useLive } from "@/lib/use-fetch";
import { paletteCommandScore } from "@/lib/command-palette-score";
import { useToast } from "@/lib/use-toast";
import { copyContextPackToClipboard } from "@/lib/context-pack-client";
import { buildSearchUrl } from "@/lib/search-ui";
import { copyStandupMarkdownToClipboard } from "@/lib/standup-clipboard";
import { saveStandupAsDailyNote } from "@/lib/standup-daily-note";
import { isDiagramStoragePath, toDiagramRoutePath } from "@/lib/diagram-utils";
import { flattenTreeFiles } from "@/lib/tree-utils";

type CommandKind = "nav" | "note" | "task" | "ticket" | "action" | "diagram" | "content";

interface Command {
  id: string;
  kind: CommandKind;
  label: string;
  detail?: string;
  hint?: string;
  perform: () => void | Promise<void>;
}

interface NoteFile {
  path: string;
  name: string;
}

interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  jiraKey?: string;
  abandonedAt?: string;
  movedAt?: string;
}

interface TicketItem {
  key: string;
  summary: string;
  status: string;
  url: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [diagrams, setDiagrams] = useState<NoteFile[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [contentResults, setContentResults] = useState<Command[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const contentSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 0 });

  // Load index data when opened. The `open` change drives a remount via `key`,
  // so we don't need to clear state here — but we do need to load fresh data.
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setTimeout(() => inputRef.current?.focus(), 0);

    Promise.all([
      fetch("/api/tree")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/tasks")
        .then((r) => (r.ok ? r.json() : { tasks: [] }))
        .catch(() => ({ tasks: [] })),
      fetch("/api/jira/tickets")
        .then((r) => (r.ok ? r.json() : { tickets: [] }))
        .catch(() => ({ tickets: [] })),
    ]).then(([tree, tasksData, ticketsData]) => {
      const allFiles = flattenTreeFiles(tree as unknown[]);
      setNotes(allFiles.filter((f) => !isDiagramStoragePath(f.path)));
      setDiagrams(allFiles.filter((f) => isDiagramStoragePath(f.path)));
      setTasks((tasksData.tasks ?? []) as TaskItem[]);
      setTickets((ticketsData.tickets ?? []) as TicketItem[]);
    });
    return () => {
      previousFocus.current?.focus?.();
    };
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced content search — fires when query >= 2 chars
  useEffect(() => {
    if (contentSearchTimer.current) clearTimeout(contentSearchTimer.current);
    if (!open || query.trim().length < 2) {
      setContentResults([]); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    contentSearchTimer.current = setTimeout(() => {
      Promise.all([
        fetch(buildSearchUrl(query, { mode: "auto" })).then((r) => r.json()),
        fetch(buildSearchUrl(query, { vault: "docs" })).then((r) => r.json()),
      ])
        .then(([notesData, docsData]) => {
          const noteCmds: Command[] = (notesData.files ?? []).map(
            (f: { path: string; matches: { text: string }[] }) => {
              const cleanPath = f.path.replace(/\.json$/, "");
              const href = isDiagramStoragePath(f.path)
                ? toDiagramRoutePath(f.path)
                : `/notes/${cleanPath}`;
              return {
                id: `content:notes:${f.path}`,
                kind: "content" as CommandKind,
                label: cleanPath,
                detail: f.matches[0]?.text ?? "",
                hint: "note",
                perform: () => router.push(href),
              };
            },
          );
          const docCmds: Command[] = (docsData.files ?? []).map(
            (f: { path: string; matches: { text: string }[] }) => {
              const cleanPath = f.path.replace(/\.md$/, "");
              return {
                id: `content:docs:${f.path}`,
                kind: "content" as CommandKind,
                label: cleanPath,
                detail: f.matches[0]?.text ?? "",
                hint: "doc",
                perform: () => router.push(`/docs/${cleanPath}`),
              };
            },
          );
          const byId = new Map<string, Command>();
          for (const cmd of [...noteCmds, ...docCmds]) {
            if (!byId.has(cmd.id)) byId.set(cmd.id, cmd);
          }
          setContentResults([...byId.values()]);
        })
        .catch(() => setContentResults([]));
    }, 200);
    return () => {
      if (contentSearchTimer.current) clearTimeout(contentSearchTimer.current);
    };
  }, [open, query, router]);

  const toggleTaskDone = useCallback(
    async (id: string) => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, done: true }),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Task toggled.");
      } catch (e) {
        console.error("toggle task from palette:", e);
        toast.error("Couldn't update task.");
      }
    },
    [toast],
  );

  const commands = useMemo<Command[]>(() => {
    const navCmds: Command[] = filterNavBySetup(ALL_NAV_DESTINATIONS, setup ?? null).map((item) => ({
      id: `nav:${item.href}`,
      kind: "nav",
      label: `Go to ${item.label}`,
      hint: item.href,
      perform: () => router.push(item.href),
    }));

    const noteCmds: Command[] = notes.map((n) => ({
      id: `note:${n.path}`,
      kind: "note",
      label: n.name,
      detail: n.path.replace(/\.json$/, ""),
      perform: () => router.push(`/notes/${n.path.replace(/\.json$/, "")}`),
    }));

    const diagramCmds: Command[] = diagrams.map((d) => ({
      id: `diagram:${d.path}`,
      kind: "diagram",
      label: d.name,
      detail: d.path.replace(/\.json$/, ""),
      perform: () => router.push(toDiagramRoutePath(d.path)),
    }));

    const taskCmds: Command[] = tasks
      .filter((t) => !t.done && !t.abandonedAt && !t.movedAt)
      .map((t) => ({
        id: `task:${t.id}`,
        kind: "task",
        label: t.text,
        detail: t.jiraKey,
        hint: "Toggle done",
        perform: () => toggleTaskDone(t.id),
      }));

    const ticketCmds: Command[] = tickets.map((t) => ({
      id: `ticket:${t.key}`,
      kind: "ticket",
      label: t.summary,
      detail: t.key,
      hint: t.status,
      perform: () => {
        window.open(t.url, "_blank", "noopener,noreferrer");
      },
    }));

    const actionCmds: Command[] = [
      {
        id: "action:shortcuts",
        kind: "action",
        label: "Show keyboard shortcuts",
        hint: "?",
        perform: () => {
          window.dispatchEvent(new CustomEvent("shortcuts:toggle"));
        },
      },
      {
        id: "action:sidebar",
        kind: "action",
        label: "Toggle sidebar",
        hint: "⌘\\",
        perform: () => {
          window.dispatchEvent(new CustomEvent("sidebar:toggle"));
        },
      },
      {
        id: "action:standup",
        kind: "action",
        label: "Copy standup markdown (git + Jira + merged PRs + tasks due today)",
        hint: "Slack",
        perform: async () => {
          const r = await copyStandupMarkdownToClipboard();
          if (r.ok) {
            toast.success("Standup copied.");
          } else {
            toast.error(r.message);
          }
        },
      },
      {
        id: "action:standup-note",
        kind: "action",
        label: "Save standup as daily note",
        hint: "Note",
        perform: async () => {
          const r = await saveStandupAsDailyNote();
          if (r.ok) {
            toast.success("Standup saved - opening note.");
            router.push(`/notes/${r.notePath}`);
          } else {
            toast.error(r.message);
          }
        },
      },
      {
        id: "action:density",
        kind: "action",
        label: "Toggle density (comfortable / compact)",
        hint: "UI",
        perform: () => {
          const next = toggleDensity();
          toast.success(`Density: ${next}.`);
        },
      },
      {
        id: "action:motion",
        kind: "action",
        label: "Toggle animations",
        hint: "UI",
        perform: () => {
          const on = toggleMotion();
          toast.success(on ? "Animations on." : "Animations off.");
        },
      },
      {
        id: "action:capture",
        kind: "action",
        label: "Quick capture (task, note, or learning)",
        hint: "⌘⇧C",
        perform: () => window.dispatchEvent(new CustomEvent("devhub:capture-open")),
      },
      {
        id: "action:context-pack",
        kind: "action",
        label: "Copy context pack for AI session",
        hint: "Tasks + learnings + standup",
        perform: () => {
          void copyContextPackToClipboard(toast);
        },
      },
    ];

    return [...navCmds, ...actionCmds, ...taskCmds, ...ticketCmds, ...noteCmds, ...diagramCmds];
  }, [notes, diagrams, tasks, tickets, router, toggleTaskDone, toast, setup]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Default view: actions + recent content — nav is hidden (sidebar carries live counts)
      const action = commands.filter((c) => c.kind === "action");
      const task = commands.filter((c) => c.kind === "task").slice(0, 5);
      const ticket = commands.filter((c) => c.kind === "ticket").slice(0, 5);
      const note = commands.filter((c) => c.kind === "note").slice(0, 8);
      const diagram = commands.filter((c) => c.kind === "diagram").slice(0, 5);
      return [...action, ...task, ...ticket, ...note, ...diagram];
    }

    const scored = commands
      .map((c) => {
        const parts = [c.label, c.detail, c.hint].filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0,
        );
        const score = paletteCommandScore(query, parts);
        return { cmd: c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.cmd);

    // Paths already matched by filename — skip duplicate content results
    const matchedPaths = new Set(
      scored
        .filter((c) => c.kind === "note" || c.kind === "diagram")
        .map((c) => c.detail ?? ""),
    );
    const deduped = contentResults.filter((c) => !matchedPaths.has(c.label));

    return [...scored, ...deduped].slice(0, 40);
  }, [query, commands, contentResults]);

  // Reset highlight when query (and therefore filtered list) changes.
  // React's recommended pattern for "adjust state during render based on prior props/state".
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setHighlightIdx(0);
  }

  const select = useCallback(
    async (cmd: Command) => {
      onClose();
      await Promise.resolve(cmd.perform());
    },
    [onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[highlightIdx];
      if (cmd) select(cmd);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="palette-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 250,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        background: "var(--scrim)",
      }}
      onClick={onClose}
    >
      <div
        className="card palette-panel"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
          <label htmlFor="cmd-palette-input" className="sr-only">
            Search commands
          </label>
          <input
            id="cmd-palette-input"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes, tasks, tickets, actions… (Esc to close)"
            className="palette-input"
            aria-controls="cmd-palette-list"
            aria-activedescendant={
              filtered[highlightIdx] ? `cmd-${filtered[highlightIdx].id}` : undefined
            }
          />
        </div>

        <div
          id="cmd-palette-list"
          role="listbox"
          style={{ overflowY: "auto", padding: "4px 0", flex: 1 }}
        >
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--text-subtle)" }}>
              {query ? `No matches for "${query}"` : "Loading…"}
            </div>
          )}
          {filtered.map((cmd, idx) => (
            <button
              key={cmd.id}
              id={`cmd-${cmd.id}`}
              type="button"
              role="option"
              aria-selected={idx === highlightIdx}
              onMouseEnter={() => setHighlightIdx(idx)}
              onClick={() => select(cmd)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: idx === highlightIdx ? "var(--bg-elevated)" : "transparent",
                border: "none",
                color: "var(--text)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <CommandIcon kind={cmd.kind} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cmd.label}
                </div>
                {cmd.detail && (
                  <div
                    style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 2 }}
                  >
                    {cmd.detail}
                  </div>
                )}
              </div>
              {cmd.hint && (
                <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{cmd.hint}</span>
              )}
              <ChevronRight size={12} style={{ color: "var(--text-subtle)" }} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandIcon({ kind }: { kind: CommandKind }) {
  const props = { size: 14, "aria-hidden": true as const };
  switch (kind) {
    case "nav":
      return <Compass {...props} style={{ color: "var(--accent)" }} />;
    case "note":
      return <FileText {...props} style={{ color: "var(--text-muted)" }} />;
    case "task":
      return <ListTodo {...props} style={{ color: "var(--success)" }} />;
    case "ticket":
      return <TicketIcon {...props} style={{ color: "var(--warning)" }} />;
    case "diagram":
      return <PenTool {...props} style={{ color: "var(--accent)" }} />;
    case "content":
      return <BookOpen {...props} style={{ color: "var(--text-muted)" }} />;
    case "action":
      return <Circle {...props} style={{ color: "var(--text-subtle)" }} />;
  }
  return <CheckCircle2 {...props} />;
}
