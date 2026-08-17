"use client";

/**
 * Task-row trigger for EntityLinkDialog.
 * Writes Task.links via PATCH — same EntityRef shape as notes ## Links.
 */

import { useState } from "react";
import { Link2 } from "lucide-react";
import type { EntityRef } from "@/lib/entity-note";
import { useToast } from "@/lib/hooks/use-toast";
import { HoverTip } from "@/components/ui/HoverTip";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";

export function TaskLinkButton({
  taskId,
  date,
  existing,
  onChanged,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  taskId: string;
  date: string;
  existing?: EntityRef[];
  onChanged?: (links: EntityRef[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const toast = useToast();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = (onOpenChange ?? setUncontrolled) as (open: boolean) => void;

  return (
    <>
      {showTrigger ? (
        <HoverTip label="Link calendar, PR, note, or diagram" pos="top-end" className="task-action-tip">
          <button
            type="button"
            className="task-icon-action"
            aria-label="Link entity"
            aria-haspopup="dialog"
            aria-expanded={open}
            onPointerDown={() => {
              window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            <Link2 size={12} aria-hidden />
          </button>
        </HoverTip>
      ) : null}
      <EntityLinkDialog
        open={open}
        onClose={() => setOpen(false)}
        defaultKind="calendar"
        excludeTaskId={taskId}
        description="Link a calendar event, PR, note, diagram, Jira issue, or another task."
        onSave={async (ref) => {
          const next = [
            ...(existing ?? []).filter((r) => !(r.kind === ref.kind && r.id === ref.id)),
            ref,
          ];
          const res = await fetch("/api/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: taskId, date, links: next }),
          });
          if (!res.ok) throw new Error(await res.text());
          onChanged?.(next);
          toast.success("Link added");
        }}
      />
    </>
  );
}
