import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, NotebookPen, PenTool } from "lucide-react";
import { DocIcon } from "@/components/docs/doc-icons";
import type { NoteAreaMeta } from "@/lib/notes/note-areas";
import type { NoteSummary } from "@/lib/notes/note-index";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * One note area, newest first.
 *
 * Notes are a journal rather than a manual, so these are dated rather than
 * numbered — the docs section page counts you through a sequence, this one
 * tells you when something happened.
 */
export function NotesAreaPage({
  meta,
  notes,
  prev,
  next,
}: {
  meta: NoteAreaMeta;
  notes: NoteSummary[];
  prev: NoteAreaMeta | null;
  next: NoteAreaMeta | null;
}) {
  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <nav className="lib-breadcrumbs" aria-label="Breadcrumb">
          <span className="flex items-center gap-1">
            <Link href="/notes">Notes</Link>
            <ChevronRight size={10} aria-hidden />
          </span>
          <span className="text-text-muted">{meta.label}</span>
        </nav>

        <header className="lib-hero">
          <div className="flex items-start gap-3">
            <span className="lib-section-icon lib-section-icon-lg">
              <DocIcon name={meta.icon} size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="lib-hero-title">{meta.label}</h1>
              {meta.description ? <p className="lib-hero-sub">{meta.description}</p> : null}
            </div>
          </div>
        </header>

        <ul className="lib-section-list">
          {notes.map((note) => (
            <li key={note.slug}>
              <Link href={note.href} className="lib-section-row">
                {note.isDiagram ? (
                  <PenTool size={14} className="lib-card-icon" aria-hidden />
                ) : (
                  <NotebookPen size={14} className="lib-card-icon" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="lib-section-row-title">{note.title}</span>
                  {note.summary ? (
                    <span className="lib-section-row-desc">{note.summary}</span>
                  ) : null}
                </span>
                <span className="lib-section-row-meta">
                  {DATE_FORMAT.format(new Date(note.modified))}
                </span>
                <ChevronRight size={14} className="text-text-subtle shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>

        {prev || next ? (
          <nav className="lib-pager lib-footer" aria-label="Areas">
            {prev ? (
              <Link href={`/notes/area/${prev.id}`} className="lib-pager-link" data-dir="prev">
                <span className="lib-pager-eyebrow">
                  <ArrowLeft size={11} aria-hidden />
                  Previous area
                </span>
                <span className="lib-pager-title">{prev.label}</span>
              </Link>
            ) : null}
            {next ? (
              <Link href={`/notes/area/${next.id}`} className="lib-pager-link" data-dir="next">
                <span className="lib-pager-eyebrow">
                  Next area
                  <ArrowRight size={11} aria-hidden />
                </span>
                <span className="lib-pager-title">{next.label}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
