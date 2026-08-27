import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getNoteIndex } from "@/lib/notes/note-index";

export const dynamic = "force-dynamic";

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
export const GET = withErrorHandler(async () => {
  const slugs = getNoteIndex().notes.map((note) => note.slug);
  return NextResponse.json({ slugs });
}, "notes.index");
