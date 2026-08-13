import { DiagramsShell } from "@/components/diagrams/DiagramsShell";
import type { LibraryNavGroup } from "@/components/library/LibraryNav";
import { DIAGRAM_ROOT_AREA_ID, getDiagramIndex } from "@/lib/diagrams/diagram-index";
import { toDiagramRoutePath } from "@/lib/diagram-utils";

/** Reads diagrams from the notes vault — never prerender. */
export const dynamic = "force-dynamic";

export default async function DiagramsLayout({ children }: { children: React.ReactNode }) {
  const index = getDiagramIndex();
  const groups: LibraryNavGroup[] = index.areas
    .filter((area) => area.id !== DIAGRAM_ROOT_AREA_ID)
    .map((area) => ({
      id: area.id,
      label: area.label,
      items: area.diagrams.map((d) => ({
        slug: d.path,
        title: d.name,
        href: toDiagramRoutePath(d.path),
      })),
    }))
    .filter((g) => g.items.length > 0);

  return <DiagramsShell groups={groups}>{children}</DiagramsShell>;
}
