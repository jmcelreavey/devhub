import { lazy, Suspense, useEffect } from "react";
import { Outlet, useOutletContext, useParams, type RouteObject } from "react-router-dom";
import NotFound from "../../app/not-found";
import { NotesAreaPage } from "../../components/notes/NotesAreaPage";
import { NotesLandingPage } from "../../components/notes/NotesLandingPage";
import { NotesShell } from "../../components/notes/NotesShell";
import { FetchError } from "../../components/ui/FetchError";
import { RouteLoading } from "../../components/ui/RouteLoading";
import type { DiagramSummary } from "../../lib/diagrams/diagram-browse";
import type { DocSummary } from "../../../core/src/lib/docs/doc-types";
import { useLive } from "../../lib/hooks/use-fetch";
import type { LearningEntry } from "../../../core/src/lib/learnings/types";
import { ROOT_AREA_ID } from "../../../../packages/shared/ui-lib/notes/note-areas";
import type { NoteIndex, NoteSummary } from "../../../core/src/lib/notes/note-index";
const NoteEditorRoute = lazy(() => import("../views/notes/NoteEditorRoute").then(module => ({ default: module.NoteEditorRoute })));

interface LibraryData {
  index: NoteIndex;
  docs: DocSummary[];
  learnings: LearningEntry[];
  diagrams: DiagramSummary[];
  sourceErrors: string[];
}

function NotesLayout() {
  const { data, error, mutate } = useLive<LibraryData>("/api/notes-index?view=library");
  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener("devhub:notes-tree-changed", refresh);
    return () => window.removeEventListener("devhub:notes-tree-changed", refresh);
  }, [mutate]);
  if (!data && error) return <FetchError message="Could not load Library." onRetry={() => { void mutate(); }} />;
  if (!data) return <RouteLoading />;
  const groups = data.index.areas.map((area) => ({
    id: area.meta.id,
    label: area.meta.label,
    secondary: area.meta.secondary,
    deletable: area.meta.id !== ROOT_AREA_ID,
    items: area.sections.flatMap((section) => section.notes.map(({ slug, title, href, summary }) => ({
      slug, title, href, description: summary, section: section.label ?? undefined,
    }))),
  }));
  return <NotesShell groups={groups}><Outlet context={data} /></NotesShell>;
}

function NotesIndex() {
  const { index, docs, learnings, diagrams, sourceErrors } = useOutletContext<LibraryData>();
  const isNote = (note: NoteSummary) => !note.isDiagram && !note.slug.startsWith("learnings/");
  const notes = index.notes.filter(isNote);
  const areas = index.areas.map((area) => ({ ...area, notes: area.notes.filter(isNote) })).filter((area) => area.notes.length > 0);
  const recent = [...notes].sort((left, right) => right.modified - left.modified).slice(0, 6);
  return <NotesLandingPage areas={areas} recent={recent} total={notes.length} notes={index.notes} docs={docs} learnings={learnings} diagrams={diagrams} sourceErrors={sourceErrors} />;
}

function NotesArea() {
  const { index } = useOutletContext<LibraryData>();
  const { id } = useParams();
  const position = index.areas.findIndex((area) => area.meta.id === id);
  if (position < 0) return <NotFound />;
  const area = index.areas[position];
  return <NotesAreaPage meta={area.meta} sections={area.sections} prev={index.areas[position - 1]?.meta ?? null} next={index.areas[position + 1]?.meta ?? null} />;
}

export const routes: RouteObject[] = [{
  path: "/notes",
  caseSensitive: true,
  element: <NotesLayout />,
  children: [
    { index: true, element: <NotesIndex /> },
    { path: "area/:id", element: <NotesArea /> },
    { path: "*", element: <Suspense fallback={<RouteLoading />}><NoteEditorRoute /></Suspense> },
  ],
}];
