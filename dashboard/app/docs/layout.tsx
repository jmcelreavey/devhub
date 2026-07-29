import { DocsShell } from "@/components/docs/DocsShell";
import { getDocIndex } from "@/lib/docs/doc-index";
import type { DocNavGroup } from "@/lib/docs/doc-nav-types";

/** Reads the docs tree from disk — see the note in `page.tsx`. Never prerender. */
export const dynamic = "force-dynamic";

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const groups: DocNavGroup[] = getDocIndex()
    .sections.map((section) => ({
      id: section.meta.id,
      label: section.meta.label,
      secondary: section.meta.secondary,
      docs: section.docs
        .filter((doc) => !doc.draft)
        .map(({ slug, title, href, description }) => ({ slug, title, href, description })),
    }))
    .filter((group) => group.docs.length > 0);

  return <DocsShell groups={groups}>{children}</DocsShell>;
}
