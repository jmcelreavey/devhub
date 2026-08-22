"use client";

import { BookOpen, ExternalLink, Hash } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/hooks/use-fetch";
import { defaultHrefForRef, type EntityRef } from "@/lib/entity-note";
import { jiraBrowseUrl } from "@/lib/utils";
import type { ReviewNoteMatch } from "@/lib/notes/review-index";
import { repoApi } from "./shared";

interface CommitContextPayload {
  tickets: string[];
  prNumbers: number[];
  prRepo: string | null;
  notes: ReviewNoteMatch[];
  related: EntityRef[];
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
  const notePaths = new Set(notes.map((n) => n.path.replace(/\.json$/, "")));
  const related = (data?.related ?? []).filter((ref) => {
    // Already rendered above by their dedicated chip shapes.
    if (ref.kind === "jira" && tickets.some((t) => t.toUpperCase() === ref.id.toUpperCase())) {
      return false;
    }
    if (ref.kind === "note" && notePaths.has(ref.id)) return false;
    return true;
  });
  if (tickets.length === 0 && notes.length === 0 && (data?.prNumbers ?? []).length === 0 && related.length === 0) {
    return null;
  }

  return (
    <div className="repo-git-commit-context">
      {(data?.prNumbers ?? []).map((n) => (
        <a
          key={`pr-${n}`}
          className="repo-git-context-chip"
          data-kind="pr"
          href={data?.prRepo ? `https://github.com/${data.prRepo}/pull/${n}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={data?.prRepo ? `Open ${data.prRepo}#${n} on GitHub` : `PR #${n}`}
          style={data?.prRepo ? undefined : { pointerEvents: "none" }}
        >
          #{n}
        </a>
      ))}
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
      {related.map((ref) => (
        <Link
          key={`${ref.kind}:${ref.id}`}
          className="repo-git-context-chip"
          data-kind={ref.kind}
          href={defaultHrefForRef(ref) ?? "#"}
          title={`Related via commit history — ${ref.kind}`}
        >
          {ref.kind === "tag" ? <Hash size={9} aria-hidden /> : ref.kind === "note" ? <BookOpen size={9} aria-hidden /> : null}
          {ref.label}
        </Link>
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
