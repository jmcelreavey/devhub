"use client";

/**
 * "I've seen this" for a radar row.
 *
 * Deliberately labelled **Seen** rather than Dismiss or Hide. The item is not
 * being deleted: it is hidden only while it stays at the level you saw it, and
 * returns if it grows. A "Dismiss" label promises permanence the behaviour does
 * not have, and the first time a dismissed row reappears the control looks
 * broken instead of clever.
 */
import { useState } from "react";
import { Check, Undo2 } from "lucide-react";
import type { AckKind } from "@/lib/radar/acknowledgements";

export interface AcknowledgeProps {
  kind: AckKind;
  id: string;
  /** The magnitude currently on screen — see the API route for why the client sends it. */
  watermark: number;
  /** Set when rendering an already-acknowledged row, to offer undo instead. */
  acknowledged?: boolean;
  onDone: () => void;
}

export function AcknowledgeButton({
  kind,
  id,
  watermark,
  acknowledged = false,
  onDone,
}: AcknowledgeProps) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch("/api/radar/acknowledge", {
        method: acknowledged ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          acknowledged ? { kind, id } : { kind, id, watermark },
        ),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs flex items-center gap-1 shrink-0"
      disabled={busy}
      onClick={() => void run()}
      title={
        acknowledged
          ? "Show this again"
          : `Hide until it grows beyond ${watermark} repo${watermark === 1 ? "" : "s"}`
      }
    >
      {acknowledged ? <Undo2 size={13} /> : <Check size={13} />}
      {acknowledged ? "Undo" : "Seen"}
    </button>
  );
}
