import { DocsLandingPage } from "@/components/docs/DocsLandingPage";
import { getDocIndex, getRecentDocs } from "@/lib/docs/doc-index";

export const metadata = { title: "Docs" };


/**
 * Never prerender. The docs tree is user content read from disk at request
 * time, and `DOCS_DIR` is only known at runtime — in the desktop app it comes
 * from app-support config that does not exist on the build machine.
 *
 * Without this the build bakes in whatever the builder could see, which for the
 * desktop bundle was nothing: the shipped app served a static "No docs yet"
 * page no matter what was actually on disk.
 */
export const dynamic = "force-dynamic";

export default async function DocsIndexPage() {
  const index = getDocIndex();
  const published = index.docs.filter((doc) => !doc.draft);

  return (
    <DocsLandingPage
      sections={index.sections}
      recent={getRecentDocs(4)}
      totalDocs={published.length}
    />
  );
}
