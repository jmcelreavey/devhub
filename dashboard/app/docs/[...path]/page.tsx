import { DocArticleView } from "@/components/docs/DocArticleView";
import { DocsSectionPage } from "@/components/docs/DocsSectionPage";
import { VaultEditorPage } from "@/components/vault/VaultEditorPage";
import { getDocDetail, getSectionDetail } from "@/lib/docs/doc-index";

/** Reads the docs tree from disk — see the note in `../page.tsx`. */
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<PageProps, "params">) {
  const { path } = await params;
  const last = path[path.length - 1];
  let label = "Docs";
  if (last) {
    try {
      label = decodeURIComponent(last);
    } catch {
      label = last;
    }
  }
  return { title: label };
}

export default async function DocPage({ params, searchParams }: PageProps) {
  const [{ path }, query] = await Promise.all([params, searchParams]);
  const decoded = path.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  const slug = decoded.join("/");
  const detail = getDocDetail(slug);

  // A single segment that names a section renders that section's index — but
  // only when it is not also a real doc slug, so a file can never be shadowed
  // by a folder that happens to share its name.
  if (!detail && decoded.length === 1) {
    const section = getSectionDetail(decoded[0]);
    if (section) {
      return (
        <DocsSectionPage
          meta={section.meta}
          docs={section.docs}
          prev={section.prev}
          next={section.next}
        />
      );
    }
  }

  // A missing detail means the file does not exist yet — fall through to the
  // editor so navigating to a new path still creates a doc, exactly as before.
  if (!detail || query.edit === "1") {
    return (
      <VaultEditorPage vault="docs" path={decoded} readHref={detail ? detail.href : undefined} />
    );
  }

  return <DocArticleView detail={detail} />;
}
