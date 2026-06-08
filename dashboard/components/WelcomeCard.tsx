"use client";

import Link from "next/link";
import { ArrowRight, Calendar, Sparkles, Plus, GitBranch, Activity } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";

interface SetupStatus {
  github?: boolean;
  datadog?: boolean;
  calendar?: boolean;
  jira?: boolean;
  core?: boolean;
}

/** `null` while loading; `true` only when the welcome onboarding card should render. */
export function useWelcomeCardVisible(taskCount: number): boolean | null {
  const { data: setup } = useLive<SetupStatus>("/api/setup/status", {
    refreshInterval: 0,
  });
  if (!setup) return null;
  if (taskCount > 0) return false;
  if (setup.github || setup.calendar || setup.jira || setup.datadog) return false;
  return true;
}

interface WelcomeCardProps {
  visible: boolean | null;
  collapsed: boolean;
  onToggle: () => void;
}

export function WelcomeCard({ visible, collapsed, onToggle }: WelcomeCardProps) {
  if (visible !== true) return null;

  const focusTaskInput = () => {
    const el = document.getElementById("task-add-text");
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div
      className="welcome-card today-grid-drag-handle"
      data-collapsed={collapsed ? "true" : undefined}
      aria-label="Welcome"
    >
      <div className="welcome-icon">
        <Sparkles size={18} aria-hidden />
      </div>
      <div className="welcome-body">
        <div className="welcome-head">
          <div className="min-w-0">
            <h2 className="welcome-title">Welcome to DevHub</h2>
            {collapsed ? <p className="today-collapsed-summary">Get started · connect integrations</p> : null}
          </div>
          <TodayCollapseButton collapsed={collapsed} label="Welcome" onToggle={onToggle} />
        </div>
        {!collapsed ? (
          <>
            <p className="welcome-sub">
              Your personal hub for tasks, notes, calendar and tickets — all in one place. Start by capturing what&apos;s on
              your plate today.
            </p>
            <div className="welcome-actions">
              <button type="button" className="welcome-action primary" onClick={focusTaskInput}>
                <Plus size={13} aria-hidden /> Add your first task
              </button>
              <Link href="/setup" className="welcome-action" aria-label="Connect GitHub">
                <GitBranch size={13} aria-hidden /> Connect GitHub
                <ArrowRight size={11} aria-hidden style={{ opacity: 0.6 }} />
              </Link>
              <Link href="/setup" className="welcome-action" aria-label="Connect Datadog">
                <Activity size={13} aria-hidden /> Connect Datadog
                <ArrowRight size={11} aria-hidden style={{ opacity: 0.6 }} />
              </Link>
              <Link href="/setup" className="welcome-action" aria-label="Connect Google Calendar or Jira">
                <Calendar size={13} aria-hidden /> Calendar or Jira
                <ArrowRight size={11} aria-hidden style={{ opacity: 0.6 }} />
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
