"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
import dynamic from "next/dynamic";
import { TaskList } from "@/components/TaskList";

// BlockNote pulls in mantine + prosemirror — lazy-load it so the Tasks tab
// (the default) doesn't pay for it.
const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((m) => m.BlockNoteEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <div className="skeleton" style={{ height: 28, width: "30%" }} />
        <div className="skeleton" style={{ height: 16, width: "90%" }} />
        <div className="skeleton" style={{ height: 16, width: "70%" }} />
      </div>
    ),
  },
);
import {
  Trash2,
  ArrowLeft,
  ListTodo,
  FileText,
  Clock,
  Plus,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useTabSaveStatus } from "@/components/TabTitle";
import { CalendarWidget } from "@/components/CalendarWidget";
import { JiraWidget } from "@/components/JiraWidget";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { ContextPackButton } from "@/components/ContextPackButton";
import { StandupCopyButton } from "@/components/StandupCopyButton";
import { GithubPrsCollapsedSummary, GithubPrsPanel } from "@/components/GithubPrsPanel";
import { DatadogCollapsedSummary, DatadogTodayStrip, useDatadogTodayPanelVisible } from "@/components/DatadogTodayStrip";
import {
  TODAY_SECTION_CALENDAR_COLLAPSED,
  TODAY_SECTION_DATADOG_COLLAPSED,
  TODAY_SECTION_GITHUB_PRS_COLLAPSED,
  TODAY_SECTION_JIRA_COLLAPSED,
  TODAY_SECTION_MAIN_COLLAPSED,
  TODAY_SECTION_WELCOME_COLLAPSED,
  TODAY_SECTION_BRIEFING_COLLAPSED,
  usePersistedSectionCollapsed,
} from "@/lib/today-workspace-storage";
import { WelcomeCard, useWelcomeCardVisible } from "@/components/WelcomeCard";
import { TodayBootScreen, useTodayBoot } from "@/components/TodayBootScreen";
import { HubTimeline } from "@/components/HubTimeline";
import { TodayDashboardGrid } from "@/components/TodayDashboardGrid";
import { MorningBriefingWidget } from "@/components/MorningBriefingWidget";
import { LayoutPresetsButton } from "@/components/LayoutPresets";
import type { TodayGridSlotId } from "@/lib/today-grid-layout";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLive } from "@/lib/use-fetch";
import { useMarkTicketsSeen, useMarkPrsSeen } from "@/lib/use-sidebar-counts";
import { todayISO, yesterdayISO, dailyNotePath, formatDayLabel } from "@/lib/utils";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

/** Single empty paragraph — daily notes start blank until you write something. */
const EMPTY_NOTE_BLOCKS: DevHubPartialBlock[] = [
  {
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text: "", styles: {} }],
    children: [],
  },
];

function blocksPlainText(blocks: DevHubPartialBlock[]): string {
  const parts: string[] = [];
  function walk(block: DevHubPartialBlock) {
    const inlines = block.content;
    if (Array.isArray(inlines)) {
      for (const item of inlines) {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          (item as { type: string }).type === "text" &&
          "text" in item
        ) {
          parts.push(String((item as { text: unknown }).text ?? ""));
        }
      }
    }
    const kids = block.children;
    if (Array.isArray(kids)) {
      for (const kid of kids) walk(kid as DevHubPartialBlock);
    }
  }
  for (const b of blocks) walk(b);
  return parts.join("");
}

/** No persisted file for whitespace-only notes. */
function isNoteEffectivelyEmpty(blocks: DevHubPartialBlock[]): boolean {
  function hasNonParagraphBlock(b: DevHubPartialBlock): boolean {
    if (b.type !== "paragraph") return true;
    const kids = b.children;
    if (Array.isArray(kids)) {
      return (kids as DevHubPartialBlock[]).some(hasNonParagraphBlock);
    }
    return false;
  }
  if (blocks.some(hasNonParagraphBlock)) return false;
  return blocksPlainText(blocks).trim().length === 0;
}

type Tab = "tasks" | "notes" | "timeline";

interface TaskCount {
  tasks?: { done?: boolean; abandonedAt?: string; movedAt?: string; text?: string }[];
}

interface CalendarProbe {
  events?: {
    id: string;
    title?: string;
    start?: string;
    end?: string;
    isAllDay?: boolean;
  }[];
  error?: string;
}

type HeroEvent = NonNullable<CalendarProbe["events"]>[number];

/**
 * Hero signal: the meeting happening right now, or the next one coming up.
 * Cheap enough to run per render — the clock already re-renders every second.
 */
function nowNextEvent(
  events: HeroEvent[] | undefined,
): { kind: "now" | "next"; event: HeroEvent; whenLabel: string } | null {
  const now = Date.now();
  const timed = (events ?? []).filter((e) => !e.isAllDay && e.start && e.end && e.title);
  const current = timed.find(
    (e) => Date.parse(e.start as string) <= now && now < Date.parse(e.end as string),
  );
  if (current) {
    const ends = new Date(current.end as string).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { kind: "now", event: current, whenLabel: `ends ${ends}` };
  }
  const upcoming = timed
    .filter((e) => Date.parse(e.start as string) > now)
    .sort((a, b) => Date.parse(a.start as string) - Date.parse(b.start as string))[0];
  if (!upcoming) return null;
  const mins = Math.ceil((Date.parse(upcoming.start as string) - now) / 60000);
  const whenLabel =
    mins <= 120
      ? `in ${mins}m`
      : `at ${new Date(upcoming.start as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return { kind: "next", event: upcoming, whenLabel };
}

interface JiraProbe {
  tickets?: { key: string }[];
  configured?: boolean;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Time-of-day greeting. Mounted-gated by the caller (server time ≠ client time). */
function greetingForHour(hour: number): { label: string; Icon: typeof Sun } {
  if (hour >= 5 && hour < 12) return { label: "Good morning", Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { label: "Good afternoon", Icon: Sun };
  if (hour >= 17 && hour < 22) return { label: "Good evening", Icon: Sunset };
  return { label: "Up late", Icon: Moon };
}

export function TodayPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [todayDate, setTodayDate] = useState(() => todayISO());
  const [blocks, setBlocks] = useState<DevHubPartialBlock[] | null>(null);
  const [noteEditorKey, setNoteEditorKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // 30s cadence: date rollover + the "in Xm" signal labels. The visible
  // seconds clock lives in <LiveClock /> so the rest of the page doesn't
  // re-render every second.
  const [, setNowTick] = useState(0);
  // Greeting renders only after mount — server time and client time can
  // disagree across a time-of-day boundary, which would mismatch hydration.
  // useSyncExternalStore: false during SSR/hydration, true on the client.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<DevHubPartialBlock[] | null>(null);
  // Overflow menu for secondary card actions. The panel stays mounted and
  // toggles via CSS `display` — StandupCopyButton portals its modal to
  // <body>, so closing the menu must not unmount it mid-flow.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  const prevTodayDateRef = useRef(todayDate);
  const tabSave = useTabSaveStatus();
  const toast = useToast();
  const confirm = useConfirm();
  const todayPath = dailyNotePath(todayDate);
  const dayLabel = useMemo(() => formatDayLabel(todayDate), [todayDate]);

  // 30-second housekeeping tick — date rollover + signal label freshness.
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick((t) => t + 1);
      const iso = todayISO();
      setTodayDate((prev) => (prev === iso ? prev : iso));
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Lightweight task counts for the hero/card-head badges. Shares SWR cache
  // with any other consumer of /api/tasks so this is essentially free.
  const { data: taskData } = useLive<TaskCount>("/api/tasks");
  const { tasksTotal, tasksDone } = useMemo(() => {
    const tasks = (taskData?.tasks ?? []).filter((t) => !t.abandonedAt && !t.movedAt);
    return {
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t.done).length,
    };
  }, [taskData]);

  // One-pass confetti when the final task of the day lands. The prev-count
  // ref means it only fires on the transition — never on page load with an
  // already-complete list.
  const [celebrate, setCelebrate] = useState(false);
  const prevDoneRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevDoneRef.current;
    prevDoneRef.current = tasksDone;
    if (prev === null) return;
    if (tasksTotal > 0 && tasksDone === tasksTotal && prev < tasksTotal) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 1800);
      return () => clearTimeout(t);
    }
  }, [tasksDone, tasksTotal]);

  // Decide whether the right column has anything worth showing. Shares SWR
  // cache with CalendarWidget / JiraWidget so this is essentially free.
  const { data: cal } = useLive<CalendarProbe>("/api/calendar");
  const { data: jira } = useLive<JiraProbe>("/api/jira/tickets");
  // Probe the PRs cache too — the boot screen holds until the primary
  // widgets have data, so the dashboard reveals as one settled unit.
  const { data: prsProbe } = useLive<Record<string, unknown>>("/api/github/prs");
  // Probe the morning briefing so the grid slot only appears when AI is configured.
  const { data: briefingProbe } = useLive<{ ok?: boolean; code?: string }>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const showBriefing = briefingProbe !== undefined && !(briefingProbe.ok === false && briefingProbe.code === "not_configured");
  useMarkTicketsSeen();
  useMarkPrsSeen();
  const hasCalendar = !cal?.error;
  const hasJira = jira?.configured === true && (jira?.tickets?.length ?? 0) > 0;
  const datadogTodayVisible = useDatadogTodayPanelVisible();
  const welcomeVisible = useWelcomeCardVisible(tasksTotal);
  const gridReady = welcomeVisible !== null && cal !== undefined && jira !== undefined;
  const bootReady =
    gridReady && taskData !== undefined && prsProbe !== undefined;
  const boot = useTodayBoot(bootReady);
  const [welcomeCollapsed, setWelcomeCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_WELCOME_COLLAPSED, {
    defaultCollapsed: true,
  });
  const [mainCollapsed, setMainCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_MAIN_COLLAPSED);
  const [calendarCollapsed, setCalendarCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_CALENDAR_COLLAPSED);
  const [jiraCollapsed, setJiraCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_JIRA_COLLAPSED);
  const [githubCollapsed, setGithubCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_GITHUB_PRS_COLLAPSED);
  const [datadogCollapsed, setDatadogCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_DATADOG_COLLAPSED);
  const [briefingCollapsed, setBriefingCollapsed] = usePersistedSectionCollapsed(TODAY_SECTION_BRIEFING_COLLAPSED);

  const collapsedSlots = useMemo(() => {
    const slots = new Set<TodayGridSlotId>();
    if (welcomeCollapsed) slots.add("welcome");
    if (briefingCollapsed) slots.add("briefing");
    if (mainCollapsed) slots.add("main");
    if (calendarCollapsed) slots.add("calendar");
    if (jiraCollapsed) slots.add("jira");
    if (githubCollapsed) slots.add("github");
    if (datadogCollapsed) slots.add("datadog");
    return slots;
  }, [
    welcomeCollapsed,
    briefingCollapsed,
    mainCollapsed,
    calendarCollapsed,
    jiraCollapsed,
    githubCollapsed,
    datadogCollapsed,
  ]);

  const mainCollapsedSummary = useMemo(() => {
    if (tab === "tasks") {
      if (tasksTotal > 0) return `${tasksDone}/${tasksTotal} tasks done`;
      return "Tasks";
    }
    if (tab === "notes") return "Notes";
    return "Timeline";
  }, [tab, tasksTotal, tasksDone]);

  const calendarCollapsedSummary = useMemo(() => {
    const n = cal?.events?.length ?? 0;
    return `${n} event${n !== 1 ? "s" : ""}`;
  }, [cal?.events?.length]);

  const jiraCollapsedSummary = useMemo(() => {
    const n = jira?.tickets?.length ?? 0;
    return `${n} ticket${n !== 1 ? "s" : ""}`;
  }, [jira?.tickets?.length]);

  const persistNoteAtPath = useCallback(async (path: string, newBlocks: DevHubPartialBlock[]) => {
    if (isNoteEffectivelyEmpty(newBlocks)) {
      broadcastNoteAutosaveInvalidation(path);
      const del = await fetch(`/api/notes/${path}`, { method: "DELETE" });
      if (!del.ok && del.status !== 404) throw new Error(await del.text());
      return;
    }
    const r = await fetch(`/api/notes/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newBlocks }),
    });
    if (!r.ok) throw new Error(await r.text());
  }, []);

  useEffect(() => {
    if (prevTodayDateRef.current !== todayDate) {
      const oldPath = dailyNotePath(prevTodayDateRef.current);
      const pending = blocksRef.current;
      prevTodayDateRef.current = todayDate;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void (async () => {
        if (pending) {
          try {
            await persistNoteAtPath(oldPath, pending);
          } catch (e) {
            console.error("Failed to flush daily note before date rollover:", e);
          }
        }
        broadcastNoteAutosaveInvalidation(oldPath);
      })();
      setNoteEditorKey((k) => k + 1);
      setStatus("idle");
    }
  }, [todayDate, persistNoteAtPath]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBlocks(null);
      try {
        const res = await fetch(`/api/notes/${todayPath}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setBlocks(data.content);
          return;
        }

        // No saved note for today — in-memory blank only (no file until you write).
        setBlocks(EMPTY_NOTE_BLOCKS);
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to load today note:", e);
        setBlocks(EMPTY_NOTE_BLOCKS);
        toast.error("Couldn't load today's note. Showing a blank page.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [todayPath, toast]);

  const saveRef = useRef<((blocks: DevHubPartialBlock[]) => Promise<void>) | null>(null);
  const save = useCallback(
    async (newBlocks: DevHubPartialBlock[]) => {
      blocksRef.current = newBlocks;
      setStatus("saving");
      tabSave.setSaving();
      try {
        await persistNoteAtPath(todayPath, newBlocks);
        setStatus("saved");
        tabSave.setSaved();
        setTimeout(() => setStatus("idle"), 2000);
      } catch (e) {
        setStatus("error");
        tabSave.clear();
        toast.error("Couldn't save today's note.", {
          action: { label: "Retry", onClick: () => saveRef.current?.(newBlocks) },
        });
        console.error("save today note:", e);
      }
    },
    [tabSave, toast, todayPath, persistNoteAtPath],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const handleChange = useCallback(
    (newBlocks: DevHubPartialBlock[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setStatus("saving");
      saveTimer.current = setTimeout(() => save(newBlocks), 1200);
    },
    [save],
  );

  const handleClear = useCallback(async () => {
    const ok = await confirm({
      title: "Clear today's note?",
      message:
        "This clears the editor and removes today's saved note file if it exists. It can't be undone.",
      confirmLabel: "Clear",
      variant: "danger",
    });
    if (!ok) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setBlocks(EMPTY_NOTE_BLOCKS);
    setNoteEditorKey((k) => k + 1);
    await save(EMPTY_NOTE_BLOCKS);
  }, [save, confirm]);

  const yesterdayLink = `/notes/${dailyNotePath(yesterdayISO())}`;

  return (
    <div className="hub today-home">
      <TodayBootScreen state={boot} />
      {celebrate && <ConfettiRain />}
      {/* Hero */}
      <div className="hub-hero">
        <div>
          <div className="hub-hero-greeting" aria-hidden>
            {mounted &&
              (() => {
                const { label, Icon } = greetingForHour(new Date().getHours());
                return (
                  <span className="fade-rise inline-flex items-center gap-1.5">
                    <Icon size={12} aria-hidden />
                    {label}
                  </span>
                );
              })()}
          </div>
          <h1 className="hub-hero-date">{dayLabel}</h1>
          <div className="hub-hero-sub">
            <LiveClock />
            {tasksTotal > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  <span key={tasksDone} className="count-tick">{tasksDone}</span>/{tasksTotal} tasks done
                </span>
                <span
                  className="hub-hero-progress"
                  data-complete={tasksDone === tasksTotal || undefined}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={tasksTotal}
                  aria-valuenow={tasksDone}
                  aria-label="Tasks done today"
                >
                  <i style={{ width: `${Math.round((tasksDone / tasksTotal) * 100)}%` }} />
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <Link href={yesterdayLink} className="hub-hero-link">
              <ArrowLeft size={11} aria-hidden /> Yesterday
            </Link>
          </div>
          {/* Now/Next strip — current/upcoming meeting + the top open task.
              Data is client-fetched, so this never renders during SSR. */}
          {(() => {
            const signal = nowNextEvent(cal?.events);
            const topTask = (taskData?.tasks ?? []).find(
              (t) => !t.done && !t.abandonedAt && !t.movedAt && t.text,
            );
            if (!signal && !topTask) return null;
            return (
              <div className="hub-hero-signals">
                {signal && (
                  <Link href="/calendar" className="hero-signal" aria-label={`${signal.kind === "now" ? "Happening now" : "Up next"}: ${signal.event.title}, ${signal.whenLabel}`}>
                    <span
                      className={`hero-signal-dot${signal.kind === "now" ? " live-dot" : ""}`}
                      data-kind={signal.kind}
                      aria-hidden
                    />
                    <span className="hero-signal-kind">{signal.kind === "now" ? "Now" : "Next"}</span>
                    <span className="hero-signal-text">{signal.event.title}</span>
                    <span className="hero-signal-meta">{signal.whenLabel}</span>
                  </Link>
                )}
                {topTask && (
                  <button
                    type="button"
                    className="hero-signal"
                    onClick={() => {
                      setTab("tasks");
                      setMainCollapsed(false);
                    }}
                    aria-label={`Top task: ${topTask.text}`}
                  >
                    <ListTodo size={11} aria-hidden style={{ color: "var(--accent)" }} />
                    <span className="hero-signal-kind">Task</span>
                    <span className="hero-signal-text">{topTask.text}</span>
                  </button>
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => window.dispatchEvent(new CustomEvent("devhub:capture-open"))}
            data-tooltip="Quick capture (⌘⇧C)"
            data-tooltip-pos="bottom-end"
          >
            <Plus size={13} aria-hidden /> Capture
          </button>
          <LayoutPresetsButton />
        </div>
      </div>

      <TodayDashboardGrid
        ready={gridReady}
        showWelcome={welcomeVisible === true}
        showBriefing={showBriefing}
        hasCalendar={hasCalendar}
        hasJira={hasJira}
        showDatadog={datadogTodayVisible}
        collapsedSlots={collapsedSlots}
        slots={{
          welcome: (
            <WelcomeCard
              visible={welcomeVisible}
              collapsed={welcomeCollapsed}
              onToggle={() => setWelcomeCollapsed((c) => !c)}
            />
          ),
          briefing: (
            <MorningBriefingWidget
              collapsed={briefingCollapsed}
              onToggle={() => setBriefingCollapsed((c) => !c)}
            />
          ),
          main: (
            <section
              className="hub-card"
              data-collapsed={mainCollapsed ? "true" : undefined}
              aria-label={tab === "tasks" ? "Today's tasks" : tab === "notes" ? "Today's notes" : "Timeline"}
            >
              <header className="hub-card-head today-grid-drag-handle">
                <div className="hub-tabs" role="tablist" aria-label="Today view">
                  <TabButton
                    active={tab === "tasks"}
                    onClick={() => setTab("tasks")}
                    icon={<ListTodo size={13} aria-hidden />}
                    label="Tasks"
                  />
                  <TabButton
                    active={tab === "notes"}
                    onClick={() => setTab("notes")}
                    icon={<FileText size={13} aria-hidden />}
                    label="Notes"
                  />
                  <TabButton
                    active={tab === "timeline"}
                    onClick={() => setTab("timeline")}
                    icon={<Clock size={13} aria-hidden />}
                    label="Timeline"
                  />
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  {mainCollapsed ? <span className="today-collapsed-summary">{mainCollapsedSummary}</span> : null}
                  <SaveStatusPill status={status} />
                  {tab === "tasks" && tasksTotal > 0 && (
                    <span className="hub-card-count">
                      <span key={tasksDone} className="count-tick">{tasksDone}</span>/{tasksTotal} done
                    </span>
                  )}
                  {/* Overflow menu — standup, context pack, clear note */}
                  <div className="relative today-grid-drag-cancel" ref={menuRef}>
                    <button
                      type="button"
                      className="today-collapse-toggle"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-label="More actions"
                      onClick={() => setMenuOpen((o) => !o)}
                    >
                      <MoreHorizontal size={13} aria-hidden />
                    </button>
                    <div
                      role="menu"
                      aria-label="Card actions"
                      className="today-actions-menu pop-soft"
                      style={{ display: menuOpen ? undefined : "none" }}
                      onClick={() => setMenuOpen(false)}
                    >
                      <StandupCopyButton variant="compact" />
                      <ContextPackButton />
                      {tab === "notes" && !mainCollapsed && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: "4px 10px", justifyContent: "flex-start" }}
                          onClick={handleClear}
                          title="Clear today's note"
                        >
                          <Trash2 size={12} aria-hidden /> Clear note
                        </button>
                      )}
                    </div>
                  </div>
                  <TodayCollapseButton
                    collapsed={mainCollapsed}
                    label="Tasks, notes and timeline"
                    onToggle={() => setMainCollapsed((c) => !c)}
                  />
                </div>
              </header>

              {!mainCollapsed ? (
                <div key={tab} className="hub-card-body fade-rise">
                  {tab === "tasks" && <TaskList />}
                  {tab === "timeline" && <HubTimeline />}
                  {tab === "notes" &&
                    (blocks ? (
                      <BlockNoteEditor
                        key={noteEditorKey}
                        initialContent={blocks}
                        onChange={handleChange}
                        vaultId="notes"
                        contentSlug={todayPath}
                        style={{ minHeight: "50vh" }}
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="skeleton" style={{ height: 28, width: "30%" }} />
                        <div className="skeleton" style={{ height: 16, width: "90%" }} />
                        <div className="skeleton" style={{ height: 16, width: "70%" }} />
                        <div className="skeleton" style={{ height: 28, width: "25%" }} />
                        <div className="skeleton" style={{ height: 16, width: "80%" }} />
                      </div>
                    ))}
                </div>
              ) : null}
            </section>
          ),
          calendar: (
            <CalendarWidget
              collapsed={calendarCollapsed}
              collapsedSummary={calendarCollapsedSummary}
              onToggle={() => setCalendarCollapsed((c) => !c)}
            />
          ),
          jira: (
            <JiraWidget
              collapsed={jiraCollapsed}
              collapsedSummary={jiraCollapsedSummary}
              onToggle={() => setJiraCollapsed((c) => !c)}
            />
          ),
          github: (
            <GithubPrsPanel
              className=""
              collapsed={githubCollapsed}
              collapsedSummary={<GithubPrsCollapsedSummary />}
              onToggle={() => setGithubCollapsed((c) => !c)}
            />
          ),
          datadog: (
            <DatadogTodayStrip
              className=""
              collapsed={datadogCollapsed}
              collapsedSummary={<DatadogCollapsedSummary />}
              onToggle={() => setDatadogCollapsed((c) => !c)}
            />
          ),
        }}
      />
    </div>
  );
}

/**
 * Self-ticking seconds clock. Isolated so its 1s interval re-renders only
 * this span — previously the whole Today page re-rendered every second.
 * Pauses while the tab is hidden.
 */
function LiveClock() {
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => setClock(formatClock(new Date()));
    const start = () => {
      if (id) return;
      tick();
      id = setInterval(tick, 1000);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return (
    <span
      className="font-mono"
      style={{ fontSize: 13 }}
      aria-label={`Current time ${clock}`}
      suppressHydrationWarning
    >
      {clock}
    </span>
  );
}

const CONFETTI_COLORS = [
  "var(--accent)",
  "var(--success)",
  "var(--warning)",
  "var(--info)",
  "var(--violet)",
];

/**
 * One-pass confetti rain for the all-tasks-done moment. Deterministic
 * pseudo-random spread (no Math.random — repeat celebrations look alike,
 * and there's nothing to disagree with the server about). Client-only by
 * construction: only rendered from a post-mount state transition.
 */
function ConfettiRain() {
  const pieces = Array.from({ length: 28 }, (_, i) => ({
    left: `${(i * 37 + 13) % 100}%`,
    delay: `${((i * 53) % 40) / 100}s`,
    duration: `${1 + ((i * 29) % 60) / 100}s`,
    drift: `${(((i * 17) % 90) - 45)}px`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 3 === 0,
  }));
  return (
    <div className="confetti-rain" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: p.left,
            background: p.color,
            borderRadius: p.round ? "50%" : 2,
            ["--delay" as string]: p.delay,
            ["--dur" as string]: p.duration,
            ["--drift" as string]: p.drift,
          }}
        />
      ))}
    </div>
  );
}

const SAVE_STATUS_CONFIG = {
  saving: { label: "Saving…", color: "var(--warning)" },
  saved:  { label: "Saved",   color: "var(--success)" },
  error:  { label: "Error saving", color: "var(--danger)" },
} as const;

function SaveStatusPill({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const { label, color } = SAVE_STATUS_CONFIG[status];
  return (
    <span
      className="flex items-center gap-1 text-xs overflow-hidden rounded"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
        paddingInline: "6px",
        paddingBlock: "2px",
        borderLeft: `2px solid ${color}`,
      }}
    >
      {label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="hub-tab"
      data-active={active}
    >
      {icon}
      {label}
    </button>
  );
}
