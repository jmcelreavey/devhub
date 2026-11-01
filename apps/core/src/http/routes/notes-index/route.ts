import { notesIndex } from "../../../../../../packages/shared/actions/notes";
import { withErrorHandler } from "../../../lib/api-utils";
import { getNoteIndex } from "../../../lib/notes/note-index";
import path from "node:path";
import { getNotesDir } from "../../../lib/content/dirs";
import { getDiagramIndex } from "../../../lib/diagrams/diagram-index";
import { getDocIndex } from "../../../lib/docs/doc-index";
import { listLearningEntries } from "../../../lib/learnings/index";


/**
 * Every note slug that exists, for row-level "has a note?" badges.
 *
 * Rows used to answer that question each with their own GET of the note body,
 * treating a 404 as `false` — one request per task, ticket and calendar row, so
 * a normal day fired a dozen concurrent 404s on first paint and buried the
 * console. The whole index is a few hundred short strings; one shared,
 * SWR-cached request replaces all of them.
 *
 * Deliberately *not* under `/api/notes/…` — that path is a catch-all note
 * resource, and a note genuinely named "index" would shadow this.
 */
export const GET = withErrorHandler(async (request: Request) => {
  if (new URL(request.url).searchParams.get("view") === "library") {
    const index = getNoteIndex();
    const sourceErrors: string[] = [];
    function loadSource<T>(name: string, load: () => T[]): T[] {
      try { return load(); } catch (error) {
        console.error(`Could not load ${name} for Library`, error);
        sourceErrors.push(name);
        return [];
      }
    }
    return Response.json({
      index,
      docs: loadSource("docs", () => getDocIndex().ordered),
      learnings: loadSource("learnings", () => listLearningEntries(path.join(getNotesDir(), "learnings"))),
      diagrams: loadSource("diagrams", () => getDiagramIndex().diagrams),
      sourceErrors,
    });
  }
  const input = notesIndex.input.parse({ recent: new URL(request.url).searchParams.get("recent") === "1" });
  return await notesIndex.handler(input, { execute: ({ recent }) => {
    const index = getNoteIndex();
    if (recent) {
      const notes = [...index.notes].sort((a, b) => b.modified - a.modified).slice(0, 6);
      return Response.json({ notes });
    }
    const slugs = index.notes.map((note) => note.slug);
    return Response.json({ slugs });
  } }) as Response;
}, "notes.index");
