"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { GithubPrRow } from "@/lib/github/prs";
import {
  PR_REVIEW_NOTE_WATCH_EVENT,
  prReviewNoteApiHref,
  prReviewNoteHref,
  prReviewNotePath,
} from "@/lib/pr-review-notes";
import { notifyNotesTreeChanged } from "@/lib/notes/path";

/**
 * Tiny doc glyph once a review note exists. Checks on mount, and after a
 * Review is kicked off (the watch event) polls until the skill writes it.
 * Renders nothing while there is no note — status, not a labeled button.
 */
export function PrReviewNoteLink({ row }: { row: GithubPrRow }) {
  const [exists, setExists] = useState(false);
  const [watching, setWatching] = useState(false);
  const path = prReviewNotePath(row);

  async function noteExists(): Promise<boolean> {
    const res = await fetch(prReviewNoteApiHref(row), { cache: "no-store" });
    return res.ok;
  }

  useEffect(() => {
    let cancelled = false;
    void noteExists().then((ok) => {
      if (!cancelled && ok) setExists(true);
    });

    function onWatch(event: Event): void {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path === path) setWatching(true);
    }

    window.addEventListener(PR_REVIEW_NOTE_WATCH_EVENT, onWatch);
    return () => {
      cancelled = true;
      window.removeEventListener(PR_REVIEW_NOTE_WATCH_EVENT, onWatch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!watching || exists) return;
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      window.clearInterval(id);
    };
    const id = window.setInterval(() => {
      void noteExists().then((ok) => {
        if (cancelled || !ok) return;
        setExists(true);
        setWatching(false);
        notifyNotesTreeChanged();
        stop();
      });
    }, 5000);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, exists]);

  if (!exists) return null;

  return (
    <Link
      href={prReviewNoteHref(row)}
      title="Review note"
      aria-label="Open review note"
      className="row-note-glyph"
      onClick={(event) => event.stopPropagation()}
    >
      <FileText size={12} aria-hidden />
    </Link>
  );
}
