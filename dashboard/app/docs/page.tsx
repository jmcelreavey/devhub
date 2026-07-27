import { DocsLandingPage } from "@/components/docs/DocsLandingPage";
import { getDocIndex, getRecentDocs } from "@/lib/docs/doc-index";

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
