"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { GithubPrRow } from "@/lib/github/prs";
import {
  PR_REVIEW_NOTE_WATCH_EVENT,
  prReviewNoteHref,
  prReviewNotePath,
} from "@/lib/pr-review-notes";
import { notifyNotesTreeChanged } from "@/lib/notes/path";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { NOTE_INDEX_KEY } from "@/lib/create-vault-note";
import { mutate } from "swr";
import { openNoteInPanel, wantsFullPage } from "@/lib/notes/open-in-panel";

/**
 * Tiny doc glyph once a review note exists. Checks on mount, and after a
 * Review is kicked off (the watch event) polls until the skill writes it.
 * Renders nothing while there is no note — status, not a labeled button.
 */
export function PrReviewNoteLink({ row }: { row: GithubPrRow }) {
  const [watching, setWatching] = useState(false);
  const path = prReviewNotePath(row);
  const exists = useVaultNoteExists(path);

  useEffect(() => {
    function onWatch(event: Event): void {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path === path) setWatching(true);
    }

    window.addEventListener(PR_REVIEW_NOTE_WATCH_EVENT, onWatch);
    return () => {
      window.removeEventListener(PR_REVIEW_NOTE_WATCH_EVENT, onWatch);
    };
  }, [path]);

  useEffect(() => {
    if (!watching) return;
    if (exists) {
      notifyNotesTreeChanged();
      return;
    }
    const id = window.setInterval(() => { void mutate(NOTE_INDEX_KEY); }, 5000);
    return () => window.clearInterval(id);
  }, [watching, exists]);

  if (!exists) return null;

  return (
    <Link
      href={prReviewNoteHref(row)}
      title="PR note"
      aria-label="Open PR note"
      className="row-note-glyph"
      onClick={(event) => {
        event.stopPropagation();
        if (wantsFullPage(event)) return;
        event.preventDefault();
        openNoteInPanel(path);
      }}
    >
      <FileText size={12} aria-hidden />
    </Link>
  );
}
