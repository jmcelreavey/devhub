import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import NotePage from "./client";

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const decoded = path.map((segment) => decodeURIComponent(segment));
  return { title: decoded[decoded.length - 1] ?? "Notes" };
}

export default async function Page(props: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<unknown>;
}) {
  const [{ path }] = await Promise.all([props.params, props.searchParams]);
  const decodedPath = path.map((segment) => decodeURIComponent(segment));
  return <NotePage path={decodedPath} notesAiConfigured={isNotesAiConfigured()} />;
}
