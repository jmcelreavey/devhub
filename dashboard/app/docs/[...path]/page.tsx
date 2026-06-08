import { VaultEditorPage } from "@/components/VaultEditorPage";

type PageProps = { params: Promise<{ path: string[] }> };

export default async function DocPage({ params }: PageProps) {
  const { path } = await params;
  const decoded = path.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  return <VaultEditorPage vault="docs" path={decoded} />;
}
