"use client";

import { useMemo, useState } from "react";
import type { WorkflowEvent } from "@/lib/workflows/types";
import { latestUpdates, updateTimeline, type UpdateTone } from "@/lib/workflows/timeline";
import { formatRelative } from "@/lib/utils";
import styles from "./WorkflowUpdates.module.css";

const LATEST = 4;

function full(at: string): string {
  return new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function clock(at: string): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(day: string, now = new Date()): string {
  const date = new Date(`${day}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function Dot({ tone }: { tone: UpdateTone }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden />;
}

function When({ at }: { at: string }) {
  return <time dateTime={at} title={full(at)}>{formatRelative(Date.parse(at))}</time>;
}

/**
 * A workflow's Updates: the latest few in plain words, and "Show all" for the
 * full timeline grouped by run or verification pass, then by day.
 */
export function WorkflowUpdates({ events }: { events: WorkflowEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  const latest = useMemo(() => latestUpdates(events, LATEST), [events]);
  const days = useMemo(() => updateTimeline(events), [events]);
  // Count runs and checks, not raw events: 86 lines read as 86 things to look at.
  const steps = useMemo(() => days.reduce((total, day) => total + day.groups.length, 0), [days]);
  if (events.length === 0) return <p className={styles.empty}>Checks and decisions will appear here.</p>;
  return (
    <div className={styles.updates}>
      {showAll ? (
        <div className={styles.timeline} aria-label="All updates">
          {days.map((day, dayIndex) => {
            const list = (
              <ol>
                {day.groups.map((group) => {
                  const range = group.start === group.end || clock(group.start) === clock(group.end) ? clock(group.end) : `${clock(group.start)} to ${clock(group.end)}`;
                  const head = (
                    <>
                      <Dot tone={group.tone} />
                      <span className={styles.label}>{group.label}</span>
                      <span className={styles.meta} title={`${full(group.start)}${group.start !== group.end ? ` – ${full(group.end)}` : ""}`}>{range}{group.outcome ? ` · ${group.outcome}` : ""}</span>
                    </>
                  );
                  return (
                    <li key={group.id}>
                      {group.events.length > 1 ? (
                        <details className={styles.group}>
                          <summary>{head}</summary>
                          <ol className={styles.children}>
                            {group.events.map((event) => (
                              <li key={event.id}><Dot tone={event.tone} /><span>{event.text}</span><When at={event.at} /></li>
                            ))}
                          </ol>
                        </details>
                      ) : (
                        <div className={styles.group}><div className={styles.single}>{head}</div></div>
                      )}
                    </li>
                  );
                })}
              </ol>
            );
            // Only the newest day is open; older days are one click away.
            return dayIndex === 0
              ? <section key={day.day} className={styles.day}><h3>{dayLabel(day.day)}</h3>{list}</section>
              : <details key={day.day} className={styles.day}><summary><h3>{dayLabel(day.day)} · {day.groups.length}</h3></summary>{list}</details>;
          })}
        </div>
      ) : (
        <ol className={styles.latest}>
          {latest.map((event) => (
            <li key={event.id}><Dot tone={event.tone} /><span>{event.text}</span><When at={event.at} /></li>
          ))}
        </ol>
      )}
      {events.length > latest.length || showAll ? (
        <button type="button" className={`btn btn-ghost ${styles.toggle}`} aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show latest" : `Show history (${steps})`}
        </button>
      ) : null}
    </div>
  );
}
