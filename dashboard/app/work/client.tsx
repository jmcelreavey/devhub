"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ListTodo, Ticket, History } from "lucide-react";
import { TaskList } from "@/components/TaskList";
import { useLive } from "@/lib/use-fetch";
import type { SetupGateStatus } from "@/lib/nav";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";

// The Jira and History tabs reuse the existing pages wholesale — Work is a
// shell that puts "things I owe" in one place (2026-06 IA), not a rewrite.
const TicketsPage = dynamic(() => import("@/app/tickets/client"), { ssr: false });
const TaskHistoryPage = dynamic(() => import("@/app/tasks/client"), { ssr: false });

type WorkTab = "tasks" | "jira" | "history";

interface TaskCount {
  tasks?: { done?: boolean; abandonedAt?: string; movedAt?: string }[];
}

export default function WorkPage() {
  const [tab, setTab] = useState<WorkTab>("tasks");
  const { data: setup } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 0 });
  const { data: taskData } = useLive<TaskCount>("/api/tasks");

  const open = (taskData?.tasks ?? []).filter((t) => !t.done && !t.abandonedAt && !t.movedAt).length;
  const showJira = setup?.jira === true;
  const boot = useBootGate(setup !== undefined && taskData !== undefined);

  const tabs = (
    <div className="mb-4 flex gap-1" role="tablist" aria-label="Work" style={{ borderBottom: "1px solid var(--border-muted)" }}>
      <WorkTabButton active={tab === "tasks"} onClick={() => setTab("tasks")} icon={<ListTodo size={13} aria-hidden />} label="Tasks" count={open} />
      {showJira && (
        <WorkTabButton active={tab === "jira"} onClick={() => setTab("jira")} icon={<Ticket size={13} aria-hidden />} label="Jira" />
      )}
      <WorkTabButton active={tab === "history"} onClick={() => setTab("history")} icon={<History size={13} aria-hidden />} label="History" />
    </div>
  );

  if (tab !== "tasks") {
    return (
      <>
        <div className="page-wrapper" style={{ paddingBottom: 0 }}>
          {tabs}
        </div>
        <div key={tab} className="fade-rise">
          {tab === "jira" ? <TicketsPage /> : <TaskHistoryPage />}
        </div>
      </>
    );
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      {tabs}
      <section className="card card-body fade-rise" aria-label="Today's queue">
        <TaskList />
      </section>
    </div>
  );
}

function WorkTabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
      style={{
        color: active ? "var(--text)" : "var(--text-muted)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        background: "none",
        cursor: "pointer",
        marginBottom: "-1px",
      }}
    >
      {icon}
      {label}
      {count ? <span className="badge badge-muted ml-0.5" style={{ fontSize: 12 }}>{count}</span> : null}
    </button>
  );
}
