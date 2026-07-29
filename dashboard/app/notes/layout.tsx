import { NotesShell } from "@/components/notes/NotesShell";
import type { LibraryNavGroup } from "@/components/library/LibraryNav";
import { ROOT_AREA_ID } from "@/lib/notes/note-areas";
import { getNoteIndex } from "@/lib/notes/note-index";

/**
 * Never prerender. `NOTES_DIR` is a runtime setting, so a build-time render
 * bakes in whatever the builder could see — which in the desktop bundle is an
 * empty vault. Same failure as `/docs`; see the note there.
 */
export const dynamic = "force-dynamic";

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const groups: LibraryNavGroup[] = getNoteIndex().areas.map((area) => ({
    id: area.meta.id,
    label: area.meta.label,
    secondary: area.meta.secondary,
    deletable: area.meta.id !== ROOT_AREA_ID,
    items: area.notes.map(({ slug, title, href, summary }) => ({
      slug,
      title,
      href,
      description: summary,
    })),
  }));

  return <NotesShell groups={groups}>{children}</NotesShell>;
}
