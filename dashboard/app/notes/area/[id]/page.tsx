import { notFound } from "next/navigation";
import { NotesAreaPage } from "@/components/notes/NotesAreaPage";
import { getNoteAreaDetail } from "@/lib/notes/note-index";

/** Reads the notes vault from disk — see the note in `../../layout.tsx`. */
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

export default async function NoteAreaPage({ params }: PageProps) {
  const { id } = await params;
  const area = getNoteAreaDetail(decodeURIComponent(id));
  if (!area) notFound();

  return (
    <NotesAreaPage meta={area.meta} notes={area.notes} prev={area.prev} next={area.next} />
  );
}
