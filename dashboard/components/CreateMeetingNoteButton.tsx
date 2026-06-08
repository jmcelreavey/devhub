"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import type { CalendarEvent } from "@/lib/google-calendar";
import { buildMeetingNoteMarkdown, meetingNotePath } from "@/lib/meeting-note";
import { textToBlocks } from "@/lib/markdown-convert";
import { getVaultClient } from "@/lib/vault/vault-client";
import { useToast } from "@/lib/use-toast";

interface CreateMeetingNoteButtonProps {
  event: CalendarEvent;
  /** Icon-only compact variant for dense lists. */
  compact?: boolean;
}

export function CreateMeetingNoteButton({ event, compact = false }: CreateMeetingNoteButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const notes = getVaultClient("notes");

  const create = async () => {
    setBusy(true);
    try {
      const path = meetingNotePath(event);
      const content = textToBlocks(buildMeetingNoteMarkdown(event));
      const res = await fetch(`${notes.apiPrefix}/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(await res.text());
      notes.paths.notifyTreeChanged();
      router.push(notes.paths.pageHref(path));
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
