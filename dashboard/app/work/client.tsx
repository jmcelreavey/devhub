"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ListTodo, Ticket, History } from "lucide-react";
import { TaskList } from "@/components/tasks/TaskList";
import { PageHeader } from "@/components/shell/PageHeader";
import { InlineSearch } from "@/components/ui/InlineSearch";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import type { SetupGateStatus } from "@/lib/nav";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import { matchesTaskSearch } from "@/lib/tasks/task-text";
import styles from "./Work.module.css";

function WorkLoading() {
  return <div role="status" aria-label="Loading work"><SkeletonRows count={4} height={52} variant="list" /></div>;
}

const TicketsPage = dynamic(() => import("@/app/tickets/client"), { ssr: false, loading: WorkLoading });
const TaskHistoryPage = dynamic(() => import("@/app/tasks/client"), { ssr: false, loading: WorkLoading });

type WorkTab = "tasks" | "jira" | "history";

function parseWorkTab(raw: string | null): WorkTab {
  if (raw === "jira" || raw === "tickets") return "jira";
  return raw === "history" ? "history" : "tasks";
}

const WORK_TABS = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "jira", label: "Jira", icon: Ticket },
  { id: "history", label: "History", icon: History },
] as const;

export default function WorkPage() {
  const searchParams = useSearchParams();
  const tab = parseWorkTab(searchParams.get("tab"));
  const [taskQuery, setTaskQuery] = useState("");
  const tabsRef = useRef<HTMLDivElement>(null);
  const { data: setup, error: setupError, mutate: refreshSetup } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 0 });
  const { data: taskData, error: taskError, mutate: refreshTasks } = useLive<{ tasks?: Task[] }>("/api/tasks");
  const taskLoading = taskData === undefined && !taskError;
  const tasks = taskData?.tasks ?? [];
  const open = tasks.filter(isTaskOpen).length;
  const visibleTabs = WORK_TABS.filter((item) => item.id !== "jira" || setup?.jira || tab === "jira");
  const hasSearchMatches = tasks.some((task) =>
    (isTaskOpen(task) || task.done || task.abandonedAt) && matchesTaskSearch(task, taskQuery),
  );

  function changeTab(next: WorkTab) {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    // Native history integrates with useSearchParams without reloading task data.
    window.history.pushState(null, "", `?${params.toString()}`);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % visibleTabs.length
      : event.key === "ArrowLeft" ? (index + visibleTabs.length - 1) % visibleTabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? visibleTabs.length - 1
      : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    changeTab(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#work-tab-${next.id}`)?.focus();
  }

  return (
    <div className="page-wrapper">
      <PageHeader title="Work" subtitle="Your task queue, Jira tickets and work history." />
      <div ref={tabsRef} className={styles.tabs} role="tablist" aria-label="Work views">
        {visibleTabs.map(({ id, label, icon: Icon }, index) => (
          <button key={id} id={`work-tab-${id}`} type="button" role="tab"
            aria-selected={tab === id} aria-controls={`work-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} className={styles.tab}
            onClick={() => changeTab(id)} onKeyDown={(event) => onTabKeyDown(event, index)}>
            <Icon size={15} aria-hidden />
            {label}
            {id === "tasks" && taskData && !taskError && <span className={styles.count} aria-label={`${open} open tasks`}>{open}</span>}
          </button>
        ))}
      </div>
      {setupError && <FetchError message="Couldn't check the Jira connection." onRetry={() => void refreshSetup()} bare />}
      {visibleTabs.filter((item) => item.id !== tab).map((item) => (
        <div key={item.id} id={`work-panel-${item.id}`} role="tabpanel" aria-labelledby={`work-tab-${item.id}`} hidden />
      ))}
      <div id={`work-panel-${tab}`} role="tabpanel" aria-labelledby={`work-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {tab === "tasks" ? (
          <>
            <section className={styles.queue} aria-label="Today's queue" aria-busy={taskLoading}>
              <div className={styles.queueHeader}>
                <div>
                  <h2>Today’s tasks</h2>
                  <p>Capture what needs doing and keep the next step in view.</p>
                </div>
                <span className={styles.total} role="status">
                  {taskLoading ? "Loading tasks…" : taskError ? taskData ? "Last loaded list" : "Tasks unavailable" : `${open} open`}
                </span>
              </div>
              <InlineSearch id="work-task-search" label="Search tasks"
                placeholder="Search text, Jira key, due date or link…"
                value={taskQuery} onChange={setTaskQuery} />
              {taskError && <FetchError message={taskData ? "Couldn't refresh tasks. Showing the last loaded list." : "Couldn't load tasks."}
                onRetry={() => void refreshTasks()} bare />}
              {taskLoading ? <WorkLoading /> : taskData ? (
                <>
                  {taskQuery.trim() && !hasSearchMatches && (
                    <p className={styles.empty} role="status">No tasks match “{taskQuery}”. Clear the search or try another term.</p>
                  )}
                  <TaskList searchQuery={taskQuery} />
                </>
              ) : null}
            </section>
          </>
        ) : tab === "jira" ? (
          setup?.jira ? <div className={styles.embedded}><TicketsPage /></div>
            : setup === undefined && !setupError ? <WorkLoading />
            : !setupError ? <p className={styles.empty}>Connect Jira in <Link href="/setup" className="text-accent hover:underline">Setup</Link> to see your tickets.</p> : null
        ) : <div className={styles.embedded}><TaskHistoryPage /></div>}
      </div>
    </div>
  );
}
