"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import type { CalendarEvent } from "@/lib/google-calendar";
import { buildMeetingNoteMarkdown, meetingNotePath } from "@/lib/meeting-note";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { useToast } from "@/lib/hooks/use-toast";

interface CreateMeetingNoteButtonProps {
  event: CalendarEvent;
  /** Icon-only compact variant for dense lists. */
  compact?: boolean;
}

export function CreateMeetingNoteButton({ event, compact = false }: CreateMeetingNoteButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const path = meetingNotePath(event);
      const { href } = await createOrOpenVaultNote({
        path,
        markdown: buildMeetingNoteMarkdown(event),
        // Match prior behaviour: regenerating from the calendar strip refreshes the scaffold.
        overwrite: true,
      });
      router.push(href);
    } catch (e) {
      console.error("create meeting note:", e);
      toast.error("Couldn't create meeting note.");
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void create();
        }}
        disabled={busy}
        className="hub-icon-btn"
        title="Create meeting note"
        aria-label={`Create meeting note for ${event.title}`}
      >
        <FileText size={11} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void create()}
      disabled={busy}
      className="btn btn-ghost text-xs"
      style={{ padding: "2px 8px" }}
      title="Create meeting note"
    >
      <FileText size={12} aria-hidden /> {busy ? "Creating…" : "Note"}
    </button>
  );
}
