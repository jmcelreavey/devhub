import Link from "next/link";
import { Clock, Folder, ListChecks, NotebookPen, PenTool, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocIcon } from "@/components/docs/doc-icons";
import { NewNoteButton } from "@/components/notes/NewNoteButton";
import { ROOT_AREA_ID } from "@/lib/notes/note-areas";
import type { NoteAreaGroup, NoteSummary } from "@/lib/notes/note-index";

/**
 * The notes home.
 *
 * Same shape as the docs landing and for the same reason: the sidebar already
 * lists everything, so repeating it here would be two copies of one list. This
 * page answers "what's here, what's new, where do I put things".
 *
 * Unlike docs, notes have no frontmatter — titles and summaries are derived
 * from the first heading and paragraph. A note that opens with prose instead of
 * a heading falls back to a prettified filename, which is why dated files get
 * special treatment rather than showing as `2026-07-27`.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const PREVIEW_LINKS = 3;

function AreaCard({ area }: { area: NoteAreaGroup }) {
  const preview = area.notes.slice(0, PREVIEW_LINKS);
  const remaining = area.notes.length - preview.length;

  return (
    <Link href={`/notes/area/${area.meta.id}`} className="lib-area">
      <span className="lib-area-head">
        <span className="lib-section-icon">
          <DocIcon name={area.meta.icon} fallback={Folder} size={15} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="lib-area-title">{area.meta.label}</span>
          <span className="lib-area-count">
            {area.notes.length} {area.notes.length === 1 ? "note" : "notes"}
          </span>
        </span>
      </span>
      {area.meta.description ? (
        <span className="lib-area-desc">{area.meta.description}</span>
      ) : null}
      <span className="lib-area-links">
        {preview.map((note) => (
          <span key={note.slug} className="lib-area-link">
            {note.title}
          </span>
        ))}
        {remaining > 0 ? <span className="lib-area-more">+{remaining} more</span> : null}
      </span>
    </Link>
  );
}

export function NotesLandingPage({
  areas,
  recent,
  total,
}: {
  areas: NoteAreaGroup[];
  recent: NoteSummary[];
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="lib-shell" data-layout="wide">
        <div className="lib-main">
          <header className="lib-hero">
            <h1 className="lib-hero-title">Notes</h1>
            <p className="lib-hero-sub">Nothing here yet.</p>
          </header>
          <EmptyState
            icon={<NotebookPen size={32} />}
            title="No notes yet"
            subtitle={
              <NewNoteButton className="btn btn-ghost text-xs mt-2" label="Create your first note" />
            }
          />
        </div>
      </div>
    );
  }

  const browsable = areas.filter((area) => area.meta.id !== ROOT_AREA_ID || area.notes.length > 0);

  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <header className="lib-hero">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="lib-hero-title">Notes</h1>
              <p className="lib-hero-sub">
                Your working memory — {total} notes across {browsable.length} areas. Search
                the full text from <kbd className="lib-kbd">Search…</kbd> in the sidebar, or{" "}
                <kbd className="lib-kbd">⌘K</kbd> anywhere.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/notes?panel=checklists"
                className="btn btn-ghost text-xs flex items-center gap-1 no-underline"
              >
                <ListChecks size={13} aria-hidden />
                Checklists
              </Link>
              <NewNoteButton
                className="btn btn-primary text-xs flex items-center gap-1"
                label="New note"
                icon={<Plus size={14} aria-hidden />}
              />
            </div>
          </div>
        </header>

        {recent.length > 0 ? (
          <section className="lib-section">
            <h2 className="lib-areas-title">
              <Clock size={12} aria-hidden />
              Picking up where you left off
            </h2>
            <ul className="lib-recent">
              {recent.map((note) => (
                <li key={note.slug}>
                  <Link href={note.href} className="lib-recent-row">
                    {note.isDiagram ? (
                      <PenTool size={13} className="lib-card-icon" aria-hidden />
                    ) : (
                      <NotebookPen size={13} className="lib-card-icon" aria-hidden />
                    )}
                    <span className="lib-recent-title">{note.title}</span>
                    <span className="lib-recent-meta">
                      {DATE_FORMAT.format(new Date(note.modified))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="lib-section">
          <h2 className="lib-areas-title">Browse by area</h2>
          <div className="lib-area-grid">
            {browsable.map((area) => (
              <AreaCard key={area.meta.id} area={area} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
