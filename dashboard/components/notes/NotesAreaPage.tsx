import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, NotebookPen, PenTool } from "lucide-react";
import { DocIcon } from "@/components/docs/doc-icons";
import { NoteListRow } from "@/components/notes/NoteListRow";
import { SectionMenuHint } from "@/components/shell/ContextMenu";
import type { NoteAreaMeta } from "@/lib/notes/note-areas";
import type { NoteSection } from "@/lib/notes/note-index";

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const FULL_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "24 Sept" this year, "24 Sept 2025" otherwise — the year is noise on most rows. */
function formatNoteDate(ms: number, thisYear: number): string {
  const date = new Date(ms);
  return (date.getFullYear() === thisYear ? DAY_FORMAT : FULL_DATE_FORMAT).format(date);
}

function sectionTitle(section: NoteSection): string {
  return section.label ?? "Other";
}

function sectionAnchor(section: NoteSection): string {
  const slug = sectionTitle(section)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `section-${slug || "other"}`;
}

/**
 * One note area, split into sections, newest first inside each.
 *
 * Notes are a journal rather than a manual, so these are dated rather than
 * numbered — the docs section page counts you through a sequence, this one
 * tells you when something happened. Big generated areas (a PR review per pull
 * request) are sectioned by repo, ticket or week so the page reads as a table
 * of contents instead of one list of 160 rows; the jump bar is that contents.
 */
export function NotesAreaPage({
  meta,
  sections,
  prev,
  next,
}: {
  meta: NoteAreaMeta;
  sections: NoteSection[];
  prev: NoteAreaMeta | null;
  next: NoteAreaMeta | null;
}) {
  const labelled = sections.some((section) => section.label !== null);
  const thisYear = new Date().getFullYear();

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
            <SectionMenuHint className="ml-auto mt-1 shrink-0" />
          </div>
        </header>

        {labelled && sections.length > 2 ? (
          <nav className="lib-jump" aria-label={`${meta.label} sections`}>
            {sections.map((section) => (
              <a key={sectionAnchor(section)} href={`#${sectionAnchor(section)}`} className="lib-jump-link">
                {sectionTitle(section)}
                <span className="lib-jump-count">{section.notes.length}</span>
              </a>
            ))}
          </nav>
        ) : null}

        {sections.map((section) => (
          <section key={sectionAnchor(section)} id={sectionAnchor(section)} className="lib-note-section">
            {labelled ? (
              <h2 className="lib-note-section-title">
                {sectionTitle(section)}
                <span className="lib-jump-count">{section.notes.length}</span>
              </h2>
            ) : null}
            <ul className="lib-section-list">
              {section.notes.map((note) => (
                <li key={note.slug}>
                  <NoteListRow note={note} className="lib-section-row">
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
                    <span className="lib-section-row-meta">{formatNoteDate(note.date, thisYear)}</span>
                    <ChevronRight size={14} className="text-text-subtle shrink-0" aria-hidden />
                  </NoteListRow>
                </li>
              ))}
            </ul>
          </section>
        ))}

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
