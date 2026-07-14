"use client";

import Link from "next/link";
import { ArrowLeft, ListTodo, Plus } from "lucide-react";
import { LayoutPresetsButton } from "@/components/LayoutPresets";
import { LiveClock } from "./LiveClock";
import { greetingForHour, nowNextEvent, type HeroEvent } from "./hero-helpers";

interface TaskProbe {
  done?: boolean;
  abandonedAt?: string;
  movedAt?: string;
  text?: string;
}

export function TodayHero({
  mounted,
  dayLabel,
  yesterdayLink,
  tasksTotal,
  tasksDone,
  calendarEvents,
  tasks,
  onFocusTasks,
}: {
  mounted: boolean;
  dayLabel: string;
  yesterdayLink: string;
  tasksTotal: number;
  tasksDone: number;
  calendarEvents: HeroEvent[] | undefined;
  tasks: TaskProbe[] | undefined;
  onFocusTasks: () => void;
}) {
  const signal = nowNextEvent(calendarEvents);
  const topTask = (tasks ?? []).find((t) => !t.done && !t.abandonedAt && !t.movedAt && t.text);

  return (
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
                <span key={tasksDone} className="count-tick">
                  {tasksDone}
                </span>
                /{tasksTotal} tasks done
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
        {(signal || topTask) && (
          <div className="hub-hero-signals">
            {signal && (
              <Link
                href="/calendar"
                className="hero-signal"
                aria-label={`${signal.kind === "now" ? "Happening now" : "Up next"}: ${signal.event.title}, ${signal.whenLabel}`}
              >
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
                onClick={onFocusTasks}
                aria-label={`Top task: ${topTask.text}`}
              >
                <ListTodo size={11} aria-hidden className="text-accent" />
                <span className="hero-signal-kind">Task</span>
                <span className="hero-signal-text">{topTask.text}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => window.dispatchEvent(new CustomEvent("devhub:capture-open"))}
          data-tooltip="Quick capture (⌘⇧C)"
          data-tooltip-pos="bottom-end"
        >
          <Plus size={13} aria-hidden /> Capture
        </button>
        <LayoutPresetsButton />
      </div>
    </div>
  );
}
