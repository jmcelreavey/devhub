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
    <div className="hub-tabs" role="tablist" aria-label="Work">
      <WorkTabButton active={tab === "tasks"} onClick={() => setTab("tasks")} icon={<ListTodo size={13} aria-hidden />} label={open > 0 ? `Tasks · ${open}` : "Tasks"} />
      {showJira && (
        <WorkTabButton active={tab === "jira"} onClick={() => setTab("jira")} icon={<Ticket size={13} aria-hidden />} label="Jira" />
      )}
      <WorkTabButton active={tab === "history"} onClick={() => setTab("history")} icon={<History size={13} aria-hidden />} label="History" />
    </div>
  );

  // Jira / History embed full pages that bring their own `.page-wrapper`
  // padding, so the tab strip floats above them instead of inside `.hub`.
  if (tab !== "tasks") {
    return (
      <div>
        <div style={{ padding: "20px 24px 0" }}>{tabs}</div>
        <div key={tab} className="fade-rise">
          {tab === "jira" ? <TicketsPage /> : <TaskHistoryPage />}
        </div>
      </div>
    );
  }

  return (
    <div className="hub">
      <BootScreen state={boot} />
      <section className="hub-card" aria-label="Today's queue">
        <header className="hub-card-head">
          {tabs}
          {open > 0 && <span className="hub-card-count">{open} open</span>}
        </header>
        <div key="tasks" className="hub-card-body fade-rise">
          <TaskList />
        </div>
      </section>
    </div>
  );
}

function WorkTabButton({
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
    <button type="button" role="tab" aria-selected={active} data-active={active} className="hub-tab" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
