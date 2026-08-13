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
import { useLive } from "@/lib/hooks/use-fetch";
import { paletteCommandScore } from "@/lib/command-palette-score";
import { useToast } from "@/lib/hooks/use-toast";
import { copyContextPackToClipboard } from "@/lib/context-pack-client";
import { buildSearchUrl } from "@/lib/search-ui";
import type { DocSearchHit } from "@/lib/docs/doc-search-types";
import { copyStandupMarkdownToClipboard } from "@/lib/standup/clipboard";
import { saveStandupAsDailyNote } from "@/lib/standup/daily-note";
import { isDiagramStoragePath, toDiagramRoutePath } from "@/lib/diagram-utils";
import { flattenTreeFiles } from "@/lib/tree-utils";
import { clearFocusSession, readFocusSession, writeFocusSession } from "@/lib/focus-session-storage";
import { clearRouteUsage, summariseRouteUsage } from "@/lib/route-usage";
import { copyTextToClipboard } from "@/lib/clipboard";
import { openTerminalTranscript } from "@/lib/terminal-launch";
import { openInBrowser } from "@/lib/desktop/bridge";

type CommandKind =
  | "nav"
  | "note"
  | "task"
  | "ticket"
  | "action"
  | "diagram"
  | "content"
  | "repo";

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

/** Just enough of a repo to offer it as a destination. */
interface RepoEntry {
  name: string;
  branch: string | null;
  dirtyCount: number;
  unpushedCount: number;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [diagrams, setDiagrams] = useState<NoteFile[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [repos, setRepos] = useState<RepoEntry[]>([]);
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
      // Repos were the one thing the palette could not reach, which on a
      // machine with 52 checkouts made it the slowest way to open the most
      // common destination.
      fetch("/api/repos")
        .then((r) => (r.ok ? r.json() : { repos: [] }))
        .catch(() => ({ repos: [] })),
    ]).then(([tree, tasksData, ticketsData, reposData]) => {
      const allFiles = flattenTreeFiles(tree as unknown[]);
      setNotes(allFiles.filter((f) => !isDiagramStoragePath(f.path)));
      setDiagrams(allFiles.filter((f) => isDiagramStoragePath(f.path)));
      setTasks((tasksData.tasks ?? []) as TaskItem[]);
      setTickets((ticketsData.tickets ?? []) as TicketItem[]);
      setRepos((reposData.repos ?? []) as RepoEntry[]);
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
        // Docs use their own index rather than the generic vault grep: it knows
        // titles and headings, so a hit can name the page and jump to the
        // section instead of dropping you at the top of a 300-line reference.
        fetch(`/api/docs/search?q=${encodeURIComponent(query)}&limit=8`)
          .then((r) => r.json())
          .catch(() => ({ results: [] })),
        // Terminal transcripts (R6). Every line is redacted server-side before
        // it gets here — see lib/terminal-search.ts. Failure is non-fatal: a
        // missing log dir shouldn't take notes and docs results down with it.
        fetch(`/api/terminal/search?q=${encodeURIComponent(query)}&limit=8`)
          .then((r) => r.json())
          .catch(() => ({ matches: [] })),
      ])
        .then(([notesData, docsData, terminalData]) => {
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
          const docCmds: Command[] = (docsData.results ?? []).map((hit: DocSearchHit) => {
            const best = hit.matches[0];
            return {
              id: `content:docs:${hit.slug}`,
              kind: "content" as CommandKind,
              label: hit.title,
              // Prefer the matched section over the doc description — the
              // question the palette is answering is "where is this mentioned".
              detail: best ? `${best.heading} — ${best.snippet}` : (hit.description ?? hit.slug),
              hint: "doc",
              perform: () => router.push(best?.href ?? hit.href),
            };
          });
          /*
            "What was that command I ran on Tuesday" — open the historical
            transcript at the matched line. Sessions are usually closed, so this
            is a read-only viewer (copy lives in the modal footer).
          */
          const terminalCmds: Command[] = (terminalData.matches ?? [])
            .slice(0, 8)
            .map((m: { sessionId: string; line: number; text: string; modifiedAt?: number }) => ({
              id: `content:terminal:${m.sessionId}:${m.line}`,
              kind: "content" as CommandKind,
              label: m.text.trim().slice(0, 120) || "(blank line)",
              detail: `session ${m.sessionId.slice(0, 8)} · line ${m.line}`,
              hint: "Open",
              perform: () => {
                openTerminalTranscript({
                  sessionId: m.sessionId,
                  line: m.line,
                  modifiedAt: m.modifiedAt,
                });
              },
            }));

          const byId = new Map<string, Command>();
          for (const cmd of [...noteCmds, ...docCmds, ...terminalCmds]) {
            if (!byId.has(cmd.id)) byId.set(cmd.id, cmd);
          }
          setContentResults([...byId.values()]);
        })
        .catch(() => setContentResults([]));
    }, 200);
    return () => {
      if (contentSearchTimer.current) clearTimeout(contentSearchTimer.current);
    };
  }, [open, query, router, toast]);

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

    /**
     * Repos as destinations. The detail line carries branch and dirty state so
     * the palette answers "which of these is the one I was working in" without
     * a round trip to /repos.
     */
    const repoCmds: Command[] = repos.map((r) => {
      const state = [
        r.branch,
        r.dirtyCount > 0 ? `${r.dirtyCount} changed` : null,
        r.unpushedCount > 0 ? `${r.unpushedCount} unpushed` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: `repo:${r.name}`,
        kind: "repo",
        label: r.name,
        detail: state || undefined,
        hint: "repo",
        // /repos filters to the named repo, which is the existing way in — the
        // Git workspace opens from the card rather than having its own route.
        perform: () => router.push(`/repos?repo=${encodeURIComponent(r.name)}`),
      };
    });

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
        void openInBrowser(t.url);
      },
    }));

    const actionCmds: Command[] = [
      /*
        Focus sessions had persistence, a chime, a top-bar readout and presets —
        but the only way to start one was to find and click that readout. The
        store is trivial to drive, so the palette can do it: ⌘K, "45", enter.
      */
      ...[25, 45, 90].map((mins) => ({
        id: `action:focus-${mins}`,
        kind: "action" as CommandKind,
        label: `Start ${mins}m focus session`,
        hint: mins === 25 ? "Pomodoro" : mins === 45 ? "Deep work" : "Long block",
        perform: () => {
          if (readFocusSession()) {
            toast.error("A focus session is already running.");
            return;
          }
          const totalMs = mins * 60_000;
          writeFocusSession({ endsAt: Date.now() + totalMs, totalMs });
          toast.success(`${mins}m focus started.`);
        },
      })),
      {
        id: "action:focus-stop",
        kind: "action",
        label: "Stop focus session",
        hint: "Focus",
        perform: () => {
          if (!readFocusSession()) {
            toast.error("No focus session running.");
            return;
          }
          clearFocusSession();
          toast.success("Focus stopped.");
        },
      },
      {
        id: "action:route-usage",
        kind: "action",
        label: "Show route usage (which pages do I actually open?)",
        hint: "Copied",
        perform: async () => {
          // Answers the "merge, delete or promote?" question about the twelve
          // routes that only exist behind this palette. Copied rather than
          // rendered — it's a one-off decision aid, not a screen worth building.
          const summary = summariseRouteUsage(ALL_NAV_DESTINATIONS.map((d) => d.href));
          try {
            await copyTextToClipboard(summary);
            toast.success("Route usage copied.");
          } catch {
            toast.error("Couldn't copy route usage.");
          }
        },
      },
      {
        id: "action:route-usage-reset",
        kind: "action",
        label: "Reset route usage counters",
        hint: "Local",
        perform: () => {
          clearRouteUsage();
          toast.success("Route usage cleared — counting again from now.");
        },
      },
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

    return [
      ...navCmds,
      ...actionCmds,
      ...repoCmds,
      ...taskCmds,
      ...ticketCmds,
      ...noteCmds,
      ...diagramCmds,
    ];
  }, [notes, diagrams, tasks, tickets, repos, router, toggleTaskDone, toast, setup]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Default view: actions + recent content — nav is hidden (sidebar carries live counts)
      const action = commands.filter((c) => c.kind === "action");
      const task = commands.filter((c) => c.kind === "task").slice(0, 5);
      const ticket = commands.filter((c) => c.kind === "ticket").slice(0, 5);
      const note = commands.filter((c) => c.kind === "note").slice(0, 8);
      const diagram = commands.filter((c) => c.kind === "diagram").slice(0, 5);
      // Repos with uncommitted or unpushed work only, on the empty query — the
      // full list is 52 entries and belongs behind a search, but the handful
      // you left work in is exactly what the default view is for.
      const repo = commands
        .filter((c) => c.kind === "repo" && Boolean(c.detail?.includes("changed") || c.detail?.includes("unpushed")))
        .slice(0, 5);
      return [...action, ...repo, ...task, ...ticket, ...note, ...diagram];
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
        zIndex: "var(--z-modal)",
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
          <Search size={14} className="text-text-muted" aria-hidden />
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
            <div className="px-4 py-6 text-sm text-center text-text-subtle">
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
              {commandNavigates(cmd) && (
                <ChevronRight size={12} className="text-text-subtle" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Nav-style chevron only when selecting opens somewhere (in-app or browser). */
function commandNavigates(cmd: Command): boolean {
  if (cmd.kind === "action" || cmd.kind === "task") return false;
  return true;
}

function CommandIcon({ kind }: { kind: CommandKind }) {
  const props = { size: 14, "aria-hidden": true as const };
  switch (kind) {
    case "nav":
      return <Compass {...props} className="text-accent" />;
    case "note":
      return <FileText {...props} className="text-text-muted" />;
    case "task":
      return <ListTodo {...props} className="text-success" />;
    case "ticket":
      return <TicketIcon {...props} className="text-warning" />;
    case "diagram":
      return <PenTool {...props} className="text-accent" />;
    case "content":
      return <BookOpen {...props} className="text-text-muted" />;
    case "action":
      return <Circle {...props} className="text-text-subtle" />;
  }
  return <CheckCircle2 {...props} />;
}
