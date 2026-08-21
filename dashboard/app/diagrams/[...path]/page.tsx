import DiagramEditorPage from "./client";

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const last = path[path.length - 1];
  let label = "Diagram";
  if (last) {
    try {
      label = decodeURIComponent(last);
    } catch {
      label = last;
    }
  }
  return { title: label };
}

export default function Page() {
  return <DiagramEditorPage />;
}
