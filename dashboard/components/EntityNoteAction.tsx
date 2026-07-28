"use client";

/**
 * Shared FileText affordance for entity→note links on cards
 * (calendar events, tasks, later PRs). Same open-or-create contract
 * everywhere; probes existence so the label reads Open vs Create.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import {
  createOrOpenVaultNote,
  vaultNoteExists,
} from "@/lib/create-vault-note";
import { useToast } from "@/lib/hooks/use-toast";
import { HoverTip } from "@/components/ui/HoverTip";

export type EntityNoteActionVariant = "icon" | "button" | "task-icon";

interface EntityNoteActionProps {
  path: string;
  markdown: string;
  /** Accessible name of the source entity (event title, task text, …). */
  entityLabel: string;
  /** When true, regenerates scaffold even if the note exists. */
  overwrite?: boolean;
  variant?: EntityNoteActionVariant;
  /** Optional tip position wrapper class for dense rows. */
  tipClassName?: string;
  errorMessage?: string;
}

export function EntityNoteAction({
  path,
  markdown,
  entityLabel,
  overwrite = false,
  variant = "icon",
  tipClassName,
  errorMessage = "Couldn't open note.",
}: EntityNoteActionProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void vaultNoteExists(path).then((ok) => {
      if (!cancelled) setExists(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const label = exists ? "Open note" : "Create note";
  const aria = exists
    ? `Open note for ${entityLabel}`
    : `Create note for ${entityLabel}`;

  const run = async () => {
    setBusy(true);
    try {
      const result = await createOrOpenVaultNote({ path, markdown, overwrite });
      if (result.wrote) setExists(true);
      router.push(result.href);
    } catch (e) {
      console.error("entity note action:", e);
      toast.error(errorMessage);
      setBusy(false);
    }
  };

  let control: ReactNode;
  if (variant === "button") {
    control = (
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="btn btn-ghost text-xs"
        style={{ padding: "2px 8px" }}
        title={label}
        aria-label={aria}
      >
        <FileText size={12} aria-hidden /> {busy ? "Opening…" : exists ? "Note" : "Note"}
      </button>
    );
  } else if (variant === "task-icon") {
    control = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void run();
        }}
        disabled={busy}
        aria-label={aria}
        className="task-icon-action"
        data-linked={exists ? "true" : undefined}
      >
        <FileText size={12} aria-hidden />
      </button>
    );
  } else {
    control = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void run();
        }}
        disabled={busy}
        className="hub-icon-btn"
        title={label}
        aria-label={aria}
        data-linked={exists ? "true" : undefined}
      >
        <FileText size={11} aria-hidden />
      </button>
    );
  }

  if (variant === "button") return control;

  return (
    <HoverTip label={label} pos="top-end" className={tipClassName}>
      {control}
    </HoverTip>
  );
}
