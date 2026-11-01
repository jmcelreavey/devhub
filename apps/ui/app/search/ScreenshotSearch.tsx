"use client";

import { useState } from "react";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { FetchError, LoadingLine } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";

interface SearchData {
  total: number; indexed: number; failed: number; unavailable: number; queued: number; truncated: boolean;
  matches: Array<{ name: string; url: string; snippet: string }>;
}
export function ScreenshotSearch({ query }: { query: string }) {
  const search = useLive<SearchData>(`/api/notes-media/search?q=${encodeURIComponent(query.trim())}`, { keepPreviousData: true });
  const [indexing, setIndexing] = useState(false);
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState<SearchData["matches"][number]>();
  async function index() {
    setIndexing(true);
    setFailure("");
    try {
      const result = await fetch("/api/notes-media/search", { method: "POST" });
      if (!result.ok) throw new Error("Couldn’t queue screenshot indexing. Try again.");
      await search.mutate();
    } catch (error) { setFailure(error instanceof Error ? error.message : "Couldn’t index screenshots."); }
    finally { setIndexing(false); }
  }
  return <section aria-label="Screenshot text search">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-text-muted">{search.data ? `${search.data.indexed} of ${search.data.total} images indexed${search.data.queued ? " · indexing in the background" : ""}` : "Reading screenshot index…"} · Text stays on this computer.</p>
      <button type="button" className="btn btn-ghost" disabled={indexing || !!search.data?.queued} onClick={() => void index()}>{indexing ? "Queuing…" : "Index stored images"}</button>
    </div>
    {search.isLoading ? <LoadingLine message="Reading screenshot index…" /> : null}
    {failure || search.error ? <FetchError message={failure || search.error.message} onRetry={() => void search.mutate()} /> : null}
    {search.data?.unavailable ? <p className="mb-4 text-xs text-text-muted">Local OCR requires macOS with Swift command-line tools. Your images remain available.</p> : null}
    {search.data?.failed ? <p className="mb-4 text-xs text-text-muted">{search.data.failed} images could not be indexed. Use “Index stored images” to retry.</p> : null}
    {!query.trim() ? <p className="text-sm text-text-muted">Find a stored note image by words visible in it. New uploads are indexed in the background.</p> :
      search.data && !search.data.matches.length ? <p className="text-sm text-text-muted">No indexed screenshots match this text.</p> : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{search.data?.matches.map(item => <button key={item.name} type="button" className="card card-body text-left" onClick={() => setSelected(item)}>
      <img src={item.url} alt="" className="mb-3 h-36 w-full rounded object-contain" />
      <p className="text-sm whitespace-pre-wrap">{item.snippet}</p><span className="mt-2 block text-xs text-text-muted">Open image · {item.name.slice(0, 8)}</span>
    </button>)}</div>
    {search.data?.truncated ? <p className="mt-3 text-xs text-text-muted">Showing the first 50 matches. Refine the search for fewer results.</p> : null}
    {selected ? <ImageViewer label="Screenshot text match" images={[{ url: selected.url, caption: selected.snippet }]} onClose={() => setSelected(undefined)} /> : null}
  </section>;
}
