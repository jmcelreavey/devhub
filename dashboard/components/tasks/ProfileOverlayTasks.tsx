"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { TaskTextContent } from "@/components/tasks/TaskText";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";

/**
 * Open tasks from the OTHER task profiles (e.g. home while you're on work),
 * read-only. Edits would land in a file this machine doesn't own and turn a
 * clean `git pull` into a merge, so there are deliberately no controls here.
 */
export function ProfileOverlayTasks() {
  const { data } = useLive<TaskProfileOverview>("/api/tasks/profiles");
  if (!data || data.overlay.length === 0) return null;
  return (
    <div className="space-y-2">
      {data.overlay.map((group) => (
        <OverlayGroup key={group.profileId} group={group} />
      ))}
    </div>
  );
}

function OverlayGroup({ group }: { group: TaskProfileOverview["overlay"][number] }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={`Tasks from ${group.profileId}`}>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium pt-2 w-full cursor-pointer"
        style={{ color: "var(--text-subtle)", borderTop: "1px solid var(--border-muted)" }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`Read-only. Last updated ${group.date}. Switch to ${group.profileId} to edit.`}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        From {group.profileId} ({group.tasks.length})
        <Lock size={10} aria-hidden className="ml-1 opacity-60" />
        <span className="ml-auto font-mono text-[10px] tabular-nums">{group.date}</span>
      </button>
      {open && (
        <ul className="space-y-1 pt-1">
          {group.tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2 text-sm text-text-muted">
              {/* A dot, not a checkbox circle: nothing here is clickable. */}
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-subtle" style={{ marginInline: 5 }} />
              <span className="min-w-0 break-words">
                <TaskTextContent text={task.text} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
