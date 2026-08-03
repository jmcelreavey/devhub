"use client";

import { BookOpen, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { jiraBrowseUrl } from "@/lib/utils";
import type { ReviewNoteMatch } from "@/lib/notes/review-index";
import { repoApi } from "./shared";

interface CommitContextPayload {
  tickets: string[];
  prNumbers: number[];
  notes: ReviewNoteMatch[];
}

const CONFIDENCE_LABEL: Record<ReviewNoteMatch["confidence"], string> = {
  pr: "Review note for this PR",
  ticket: "Review note for this ticket",
  related: "Related review — same ticket, different repo",
};

/**
 * Ticket links and any review note that explains a commit.
 *
 * The commit says *what* changed; the review note says why it was accepted.
 * Joining them locally is something no hosted git tool can do, because the
 * notes never leave this machine.
 */
export function CommitContextChips({
  repoName,
  commit,
}: {
  repoName: string;
  /** Full or short hash. Omit to render nothing. */
  commit: string | null | undefined;
}) {
  const { data } = useLive<CommitContextPayload>(
    commit ? repoApi(repoName, `/git/commit-context?commit=${encodeURIComponent(commit)}`) : null,
    { revalidateOnFocus: false, refreshInterval: 0, shouldRetryOnError: false },
  );

  const tickets = data?.tickets ?? [];
  const notes = data?.notes ?? [];
  if (tickets.length === 0 && notes.length === 0) return null;

  return (
    <div className="repo-git-commit-context">
      {tickets.map((key) => (
        <a
          key={key}
          className="repo-git-context-chip"
          data-kind="ticket"
          href={jiraBrowseUrl(key)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${key} in Jira`}
        >
          {key}
          <ExternalLink size={9} aria-hidden />
        </a>
      ))}
      {notes.map((note) => (
        <Link
          key={note.path}
          className="repo-git-context-chip"
          data-kind="note"
          data-confidence={note.confidence}
          href={`/notes/${note.path.replace(/\.json$/, "")}`}
          title={`${CONFIDENCE_LABEL[note.confidence]} — matched on ${note.via}`}
        >
          <BookOpen size={9} aria-hidden />
          {note.confidence === "related" ? "Related review" : "Review note"}
          <span className="repo-git-context-chip-via">{note.via}</span>
        </Link>
      ))}
    </div>
  );
}
