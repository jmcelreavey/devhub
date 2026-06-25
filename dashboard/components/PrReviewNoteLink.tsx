"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { GithubPrRow } from "@/lib/github-prs";
import {
  PR_REVIEW_NOTE_WATCH_EVENT,
  prReviewNoteApiHref,
  prReviewNoteHref,
  prReviewNotePath,
} from "@/lib/pr-review-notes";
import { notifyNotesTreeChanged } from "@/lib/notes-path";
import { PR_ACTION_BASE, PR_ACTION_SIZE, type PrActionSize } from "@/components/pr-row-action-style";

/**
 * Shows a "Notes" link once a review note exists for this PR. Checks once on
 * mount, and — after a Review is kicked off (the watch event) — polls until the
 * note the skill is writing appears, then reveals the link. Renders nothing
 * while there is no note.
 */
export function PrReviewNoteLink({ row, size = "md" }: { row: GithubPrRow; size?: PrActionSize }) {
  const [exists, setExists] = useState(false);
  const [watching, setWatching] = useState(false);
  const path = prReviewNotePath(row);

  async function noteExists(): Promise<boolean> {
    const res = await fetch(prReviewNoteApiHref(row), { cache: "no-store" });
    return res.ok;
  }

  // Initial check + listen for this PR's review being kicked off.
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

  // While watching, poll until the note lands.
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

  const s = PR_ACTION_SIZE[size];
  return (
    <Link href={prReviewNoteHref(row)} title="Open PR review note" className={`${PR_ACTION_BASE} ${s.btn}`}>
      <FileText size={s.icon} aria-hidden />
      <span>Notes</span>
    </Link>
  );
}
