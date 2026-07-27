import { DocArticleView } from "@/components/docs/DocArticleView";
import { VaultEditorPage } from "@/components/vault/VaultEditorPage";
import { getDocDetail } from "@/lib/docs/doc-index";

type PageProps = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

  // A missing detail means the file does not exist yet — fall through to the
  // editor so navigating to a new path still creates a doc, exactly as before.
  if (!detail || query.edit === "1") {
    return (
      <VaultEditorPage vault="docs" path={decoded} readHref={detail ? detail.href : undefined} />
    );
  }

  return <DocArticleView detail={detail} />;
}
