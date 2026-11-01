"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";
import { ArrowRight, BookOpen, Clock, FileText, Folder, ListChecks, NotebookPen, PenTool, Plus } from "lucide-react";
import { LearningCard } from "@/app/learnings/client";
import { DiagramRecentRow } from "@/components/diagrams/DiagramCards";
import { DocIcon } from "@/components/docs/doc-icons";
import { DocRow, DocRowLink } from "@/components/docs/DocRow";
import { NewNoteButton } from "@/components/notes/NewNoteButton";
import { NoteListRow } from "@/components/notes/NoteListRow";
import { SectionMenuHint } from "@/components/shell/ContextMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { SearchInput } from "@/components/ui/SearchInput";
import { ToggleGroup, type ToggleOption } from "@/components/ui/ToggleGroup";
import type { DiagramSummary } from "@/lib/diagrams/diagram-browse";
import type { DocSummary } from "../../../core/src/lib/docs/doc-types";
import { useLive } from "@/lib/hooks/use-fetch";
import type { LearningDetail, LearningEntry } from "../../../core/src/lib/learnings/types";
import type { NoteAreaGroup, NoteSummary } from "../../../core/src/lib/notes/note-index";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const PREVIEW_LINKS = 3;

function AreaCard({ area }: { area: NoteAreaGroup }) {
  const preview = area.notes.slice(0, PREVIEW_LINKS);
  const remaining = area.notes.length - preview.length;

  return (
    <Link href={`/notes/area/${encodeURIComponent(area.meta.id)}`} className="lib-area">
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

type LibraryKind = "notes" | "docs" | "learnings" | "diagrams";
type LibraryFilter = "all" | LibraryKind;

interface LibraryItemBase {
  key: string;
  kind: LibraryKind;
  title: string;
  path: string;
  searchText: string;
  modified: number;
}

type LibraryItem = LibraryItemBase & (
  | { source: "note"; note: NoteSummary }
  | { source: "doc"; doc: DocSummary }
  | { source: "learning"; learning: LearningEntry }
  | { source: "diagram"; diagram: DiagramSummary }
);

const LIBRARY_PAGE_SIZE = 20;

const COLLECTION_LINKS: Partial<Record<LibraryFilter, { href: string; label: string }>> = {
  docs: { href: "/docs", label: "Open docs" },
  learnings: { href: "/learnings", label: "Open learnings" },
  diagrams: { href: "/diagrams", label: "Open diagrams" },
};

function LibraryRowContent({
  icon,
  title,
  path,
  kind,
  modified,
}: {
  icon: ReactNode;
  title: string;
  path: string;
  kind: string;
  modified: number;
}) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="lib-recent-title block">{title}</span>
        <span className="block truncate text-[11px] text-text-subtle" title={path}>{path}</span>
      </span>
      <span className="lib-recent-meta">{kind} · {DATE_FORMAT.format(new Date(modified))}</span>
    </>
  );
}

function buildLibraryItems({
  notes,
  docs,
  learnings,
  diagrams,
}: {
  notes: NoteSummary[];
  docs: DocSummary[];
  learnings: LearningEntry[];
  diagrams: DiagramSummary[];
}): LibraryItem[] {
  const diagramPaths = new Set(diagrams.map((entry) => entry.path));
  const noteItems = notes
    .filter((note) => !note.slug.startsWith("learnings/") && !diagramPaths.has(note.slug))
    .map<LibraryItem>((note) => ({
      key: `note:${note.slug}:${note.isDiagram}`,
      kind: note.isDiagram ? "diagrams" : "notes",
      source: "note",
      note,
      title: note.title,
      path: note.slug,
      searchText: `${note.title} ${note.slug} ${note.summary ?? ""}`.toLowerCase(),
      modified: note.modified,
    }));
  const docItems = docs.map<LibraryItem>((doc) => ({
    key: `doc:${doc.slug}`,
    kind: "docs",
    source: "doc",
    doc,
    title: doc.title,
    path: doc.slug,
    searchText: `${doc.title} ${doc.slug} ${doc.description ?? ""} ${doc.tags.join(" ")}`.toLowerCase(),
    modified: doc.modified,
  }));
  const learningItems = learnings.map<LibraryItem>((learning) => ({
    key: `learning:${learning.category}`,
    kind: "learnings",
    source: "learning",
    learning,
    title: learning.title,
    path: `learnings/${learning.category}`,
    searchText: `${learning.title} ${learning.category} ${learning.preview}`.toLowerCase(),
    modified: learning.modified,
  }));
  const diagramItems = diagrams.map<LibraryItem>((diagram) => ({
    key: `diagram:${diagram.path}`,
    kind: "diagrams",
    source: "diagram",
    diagram,
    title: diagram.name,
    path: diagram.path,
    searchText: `${diagram.name} ${diagram.path}`.toLowerCase(),
    modified: diagram.modified,
  }));
  return [...noteItems, ...docItems, ...learningItems, ...diagramItems].sort(
    (left, right) => right.modified - left.modified || left.title.localeCompare(right.title),
  );
}

function LibraryBrowser({
  notes,
  docs,
  learnings,
  diagrams,
  sourceErrors,
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: {
  notes: NoteSummary[];
  docs: DocSummary[];
  learnings: LearningEntry[];
  diagrams: DiagramSummary[];
  sourceErrors: string[];
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) {
  const router = useRouter();
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const detailKey = expanded ? `/api/learnings?category=${encodeURIComponent(expanded)}` : null;
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    mutate: mutateDetail,
  } = useLive<LearningDetail>(detailKey);

  const items = useMemo(
    () => buildLibraryItems({ notes, docs, learnings, diagrams }),
    [notes, docs, learnings, diagrams],
  );

  const counts: Record<LibraryFilter, number> = {
    all: items.length,
    notes: 0,
    docs: 0,
    learnings: 0,
    diagrams: 0,
  };
  for (const item of items) counts[item.kind] += 1;

  const options: ToggleOption<LibraryFilter>[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "notes", label: "Notes", count: counts.notes },
    { value: "docs", label: "Docs", count: counts.docs },
    { value: "learnings", label: "Learnings", count: counts.learnings },
    { value: "diagrams", label: "Diagrams", count: counts.diagrams },
  ];
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) =>
    (filter === "all" || item.kind === filter) && (!query || item.searchText.includes(query)),
  );
  const collection = COLLECTION_LINKS[filter];

  function changeFilter(next: LibraryFilter) {
    onFilterChange(next);
    setVisibleCount(LIBRARY_PAGE_SIZE);
    setExpanded(null);
  }

  function changeSearch(next: string) {
    onSearchChange(next);
    setVisibleCount(LIBRARY_PAGE_SIZE);
    setExpanded(null);
  }

  return (
    <section className="lib-section" aria-label="Browse library">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 overflow-x-auto pb-1 max-sm:w-full max-sm:[&>div]:flex-wrap max-sm:[&_button]:min-h-11">
          <ToggleGroup options={options} value={filter} onChange={changeFilter} aria-label="Library type" />
        </div>
        {collection ? (
          <Link href={collection.href} className="btn btn-ghost text-xs no-underline">
            {collection.label} <ArrowRight size={13} aria-hidden />
          </Link>
        ) : null}
      </div>
      <SearchInput
        value={search}
        onChange={changeSearch}
        placeholder="Filter titles, paths, previews"
        wrapperClassName="mt-3 mb-3"
      />
      {sourceErrors.length > 0 ? (
        <FetchError
          message={`Could not load ${sourceErrors.join(", ")}. Other library items are still available.`}
          onRetry={() => router.refresh()}
        />
      ) : null}
      <p className="mb-2 text-xs text-text-subtle" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "item" : "items"}
      </p>
      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} />}
          title={sourceErrors.length > 0 ? "Some library items could not load" : query ? "No matching items" : filter === "all" ? "Nothing in the library yet" : `No ${filter} yet`}
          subtitle={sourceErrors.length > 0 ? "Retry to load the missing items." : query ? "Try another filter or search." : undefined}
          action={sourceErrors.length === 0 && !query && (filter === "all" || filter === "notes") ? (
            <NewNoteButton className="btn btn-ghost text-xs" label="Create your first note" />
          ) : undefined}
        />
      ) : (
        <ul className="lib-recent [&>li]:relative" style={{ overflow: "visible" }}>
          {filtered.slice(0, visibleCount).map((item) => {
            if (item.source === "learning") {
              const isOpen = expanded === item.learning.category;
              return (
                <li key={item.key} className="p-1">
                  <LearningCard
                    entry={item.learning}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : item.learning.category)}
                    detail={isOpen ? detail : undefined}
                    detailLoading={isOpen && detailLoading}
                    detailError={isOpen ? detailError : undefined}
                    onRetryDetail={() => void mutateDetail()}
                    showType
                  />
                </li>
              );
            }
            if (item.source === "diagram") {
              return (
                <DiagramRecentRow
                  key={item.key}
                  file={{ path: item.diagram.path, name: item.diagram.name, modified: item.diagram.modified }}
                  onChanged={() => router.refresh()}
                >
                  <Link href={item.diagram.href} className="lib-recent-row" onContextMenu={(event) => event.preventDefault()}>
                    <LibraryRowContent icon={<PenTool size={13} className="lib-card-icon" aria-hidden />} title={item.title} path={item.path} kind="Diagram" modified={item.modified} />
                  </Link>
                </DiagramRecentRow>
              );
            }
            if (item.source === "doc") {
              return (
                <li key={item.key}>
                  <DocRow doc={item.doc} className="lib-recent-item">
                    <DocRowLink href={item.doc.href} className="lib-recent-row">
                      <LibraryRowContent icon={<FileText size={13} className="lib-card-icon" aria-hidden />} title={item.title} path={item.path} kind="Doc" modified={item.modified} />
                    </DocRowLink>
                  </DocRow>
                </li>
              );
            }
            return (
              <li key={item.key}>
                <NoteListRow note={item.note} className="lib-recent-row">
                  <LibraryRowContent
                    icon={item.note.isDiagram ? <PenTool size={13} className="lib-card-icon" aria-hidden /> : <NotebookPen size={13} className="lib-card-icon" aria-hidden />}
                    title={item.title}
                    path={item.path}
                    kind={item.note.isDiagram ? "Diagram" : "Note"}
                    modified={item.modified}
                  />
                </NoteListRow>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > visibleCount ? (
        <button type="button" className="btn btn-ghost text-xs mt-3" onClick={() => setVisibleCount((count) => count + LIBRARY_PAGE_SIZE)}>
          Show more
        </button>
      ) : null}
    </section>
  );
}

export function NotesLandingPage({
  areas,
  recent,
  total,
  notes,
  docs,
  learnings,
  diagrams,
  sourceErrors,
}: {
  areas: NoteAreaGroup[];
  recent: NoteSummary[];
  total: number;
  notes: NoteSummary[];
  docs: DocSummary[];
  learnings: LearningEntry[];
  diagrams: DiagramSummary[];
  sourceErrors: string[];
}) {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const showNotesOverview = filter === "notes" && !search.trim();

  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <header className="lib-hero">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
            <div className="min-w-0">
              <h1 className="lib-hero-title">Library</h1>
              <p className="lib-hero-sub">Notes, docs, learnings and diagrams in one place.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
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

        <LibraryBrowser
          notes={notes}
          docs={docs}
          learnings={learnings}
          diagrams={diagrams}
          sourceErrors={sourceErrors}
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
        />

        {showNotesOverview && recent.length > 0 ? (
          <section className="lib-section">
            <h2 className="lib-areas-title">
              <Clock size={12} aria-hidden />
              Picking up where you left off
              <SectionMenuHint className="ml-auto font-normal normal-case tracking-normal" />
            </h2>
            <ul className="lib-recent">
              {recent.map((note) => (
                <li key={note.slug}>
                  <NoteListRow note={note} className="lib-recent-row">
                    {note.isDiagram ? (
                      <PenTool size={13} className="lib-card-icon" aria-hidden />
                    ) : (
                      <NotebookPen size={13} className="lib-card-icon" aria-hidden />
                    )}
                    <span className="lib-recent-title">{note.title}</span>
                    <span className="lib-recent-meta">
                      {DATE_FORMAT.format(new Date(note.modified))}
                    </span>
                  </NoteListRow>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showNotesOverview && total > 0 ? (
          <section className="lib-section">
            <h2 className="lib-areas-title">Browse notes by area</h2>
            <div className="lib-area-grid">
              {areas.map((area) => (
                <AreaCard key={area.meta.id} area={area} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
