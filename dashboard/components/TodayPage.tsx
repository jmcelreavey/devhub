"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import { CalendarWidget } from "@/components/CalendarWidget";
import { JiraWidget } from "@/components/JiraWidget";
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
import { TodayDashboardGrid } from "@/components/TodayDashboardGrid";
import { MorningBriefingWidget } from "@/components/MorningBriefingWidget";
import { useTabSaveStatus } from "@/components/TabTitle";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLive } from "@/lib/use-fetch";
import { useMarkTicketsSeen, useMarkPrsSeen } from "@/lib/use-sidebar-counts";
import { todayISO, yesterdayISO, dailyNotePath, formatDayLabel } from "@/lib/utils";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";
import type { TodayGridSlotId } from "@/lib/today-grid-layout";
import { EMPTY_NOTE_BLOCKS, isNoteEffectivelyEmpty } from "@/components/today/note-helpers";
import { TodayBannersHost } from "@/components/today/TodayBannersHost";
import { TodayHero } from "@/components/today/TodayHero";
import { TodayMainCard, type TodayTab } from "@/components/today/TodayMainCard";

const emptySubscribe = () => () => {};

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

interface JiraProbe {
  tickets?: { key: string }[];
  configured?: boolean;
}

export function TodayPage() {
  const [tab, setTab] = useState<TodayTab>("tasks");
  const [todayDate, setTodayDate] = useState(() => todayISO());
  const [blocks, setBlocks] = useState<DevHubPartialBlock[] | null>(null);
  const [noteEditorKey, setNoteEditorKey] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // 30s cadence: date rollover + the "in Xm" signal labels.
  const [, setNowTick] = useState(0);
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<DevHubPartialBlock[] | null>(null);
  const prevTodayDateRef = useRef(todayDate);
  const tabSave = useTabSaveStatus();
  const toast = useToast();
  const confirm = useConfirm();
  const todayPath = dailyNotePath(todayDate);
  const dayLabel = useMemo(() => formatDayLabel(todayDate), [todayDate]);

  useEffect(() => {
    const id = setInterval(() => {
      setNowTick((t) => t + 1);
      const iso = todayISO();
      setTodayDate((prev) => (prev === iso ? prev : iso));
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const { data: taskData } = useLive<TaskCount>("/api/tasks");
  const { tasksTotal, tasksDone } = useMemo(() => {
    const tasks = (taskData?.tasks ?? []).filter((t) => !t.abandonedAt && !t.movedAt);
    return {
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t.done).length,
    };
  }, [taskData]);

  const { data: cal } = useLive<CalendarProbe>("/api/calendar");
  const { data: jira } = useLive<JiraProbe>("/api/jira/tickets");
  const { data: prsProbe } = useLive<Record<string, unknown>>("/api/github/prs");
  const { data: briefingProbe } = useLive<{ ok?: boolean; code?: string }>("/api/dashboard/morning-briefing", {
    refreshInterval: 0,
  });
  const showBriefing =
    briefingProbe !== undefined && !(briefingProbe.ok === false && briefingProbe.code === "not_configured");
  useMarkTicketsSeen();
  useMarkPrsSeen();
  const hasCalendar = !cal?.error;
  const hasJira = jira?.configured === true && (jira?.tickets?.length ?? 0) > 0;
  const hasGithub = prsProbe?.configured === true;
  const datadogTodayVisible = useDatadogTodayPanelVisible();
  const welcomeVisible = useWelcomeCardVisible(tasksTotal);
  const gridReady = welcomeVisible !== null && cal !== undefined && jira !== undefined;
  const bootReady = gridReady && taskData !== undefined && prsProbe !== undefined;
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
    return "Notes";
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
      // Keep React state in sync with the editor. Notes unmount when switching
      // to Tasks (and when the card collapses); without this, remount feeds
      // stale initialContent until a full page reload re-fetches from disk.
      blocksRef.current = newBlocks;
      setBlocks(newBlocks);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setStatus("saving");
      saveTimer.current = setTimeout(() => save(newBlocks), 1200);
    },
    [save],
  );

  const flushPendingNoteSave = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = blocksRef.current;
    if (pending) void save(pending);
  }, [save]);

  const handleTabChange = useCallback(
    (next: TodayTab) => {
      if (tab === "notes" && next !== "notes") flushPendingNoteSave();
      setTab(next);
    },
    [tab, flushPendingNoteSave],
  );

  const handleToggleMainCollapsed = useCallback(() => {
    setMainCollapsed((collapsed) => {
      // Collapsing unmounts the editor the same way tab-switching does.
      if (!collapsed && tab === "notes") flushPendingNoteSave();
      return !collapsed;
    });
  }, [tab, flushPendingNoteSave, setMainCollapsed]);

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
      <TodayBannersHost />
      <TodayHero
        mounted={mounted}
        dayLabel={dayLabel}
        yesterdayLink={yesterdayLink}
        tasksTotal={tasksTotal}
        tasksDone={tasksDone}
        calendarEvents={cal?.events}
        tasks={taskData?.tasks}
        onFocusTasks={() => {
          handleTabChange("tasks");
          setMainCollapsed(false);
        }}
      />

      <TodayDashboardGrid
        ready={gridReady}
        showWelcome={welcomeVisible === true}
        showBriefing={showBriefing}
        hasCalendar={hasCalendar}
        hasJira={hasJira}
        hasGithub={hasGithub}
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
            <TodayMainCard
              tab={tab}
              onTabChange={handleTabChange}
              mainCollapsed={mainCollapsed}
              onToggleCollapsed={handleToggleMainCollapsed}
              mainCollapsedSummary={mainCollapsedSummary}
              status={status}
              tasksTotal={tasksTotal}
              tasksDone={tasksDone}
              onClearNote={() => void handleClear()}
              blocks={blocks}
              noteEditorKey={noteEditorKey}
              todayPath={todayPath}
              onNoteChange={handleChange}
            />
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
