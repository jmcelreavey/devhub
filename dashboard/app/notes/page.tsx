import { NotesLandingPage } from "@/components/notes/NotesLandingPage";
import { getNoteIndex, getRecentNotes } from "@/lib/notes/note-index";

export const metadata = { title: "Notes" };


/** Reads the notes vault from disk — see the note in `layout.tsx`. */
export const dynamic = "force-dynamic";

export default async function NotesIndexPage() {
  const index = getNoteIndex();
  return <NotesLandingPage areas={index.areas} recent={getRecentNotes(6)} total={index.total} />;
}
