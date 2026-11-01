"use client";

import { ShortcutKbd } from "@/components/ui/ShortcutKbd";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "@/lib/navigation";
import { Search } from "lucide-react";
import { EmptyState, FetchError, LoadingLine, PageHeader, SearchInput } from "@/components";
import { SearchResultList } from "@/components/ui/SearchResultList";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import RecallPage from "@/app/recall/client";
import { RouteLoading } from "@/components/ui/RouteLoading";
import { RecallResults } from "./RecallResults";
import { RecentWork } from "./RecentWork";
import { ScreenshotSearch } from "./ScreenshotSearch";

type SearchTab = "exact" | "ranked" | "semantic" | "recall" | "screenshots";

const MODE_OPTIONS: { id: SearchTab; label: string; hint: string }[] = [
  { id: "exact", label: "Exact", hint: "Substring match in note text" },
  { id: "ranked", label: "Ranked", hint: "Find notes by the words and topics that matter most" },
  { id: "semantic", label: "Semantic", hint: "Find related ideas even when the wording is different" },
  { id: "recall", label: "Recall", hint: "Explore budgeted context, sources and events" },
  { id: "screenshots", label: "Screenshots", hint: "Find images by text visible in them" },
];

export default function SearchPage({ defaultMode = "exact" }: { defaultMode?: SearchTab }) {
  return <Suspense fallback={<RouteLoading />}><SearchContent defaultMode={defaultMode} /></Suspense>;
}

function SearchContent({ defaultMode }: { defaultMode: SearchTab }) {
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const tab = MODE_OPTIONS.find((option) => option.id === requestedMode)?.id ?? defaultMode;
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading, pending, error, scheduleSearch, retry, clear } = useDebouncedSearch();

  const onQueryChange = (value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("q", value);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  };

  const onModeChange = (next: SearchTab) => {
    if (next === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", next);
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    if (next !== "exact" && next !== "ranked") clear();
  };

  const isLexical = tab === "exact" || tab === "ranked";
  useEffect(() => {
    const timer = setTimeout(() => setQuery(new URL(window.location.href).searchParams.get("q") ?? ""), 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

  useEffect(() => {
    if (!isLexical) return;
    const timer = setTimeout(() => scheduleSearch(query, tab === "ranked" ? "semantic" : "exact"), 0);
    return () => clearTimeout(timer);
  }, [isLexical, query, scheduleSearch, tab]);
  const isSearching = isLexical && (pending || loading) && !!query.trim();
  const currentResults = isLexical && results?.query === query &&
    (tab === "ranked" ? results.mode === "semantic" : results.mode !== "semantic") ? results : null;
  const showEmpty =
    !isSearching && !error && currentResults && currentResults.total === 0 && query.trim();
  const showResults = currentResults && currentResults.total > 0;

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Search"
        subtitle={<>Search notes or explore related context across sources. Quick jump: <ShortcutKbd keys="P" className="text-[10px] px-1 rounded" /></>}
      />

      <div className="card card-body mb-4 space-y-3">
        <SearchInput
          inputRef={inputRef}
          autoFocus
          wrapperClassName=""
          value={query}
          onChange={onQueryChange}
          onClear={() => {
            onQueryChange("");
            clear();
            inputRef.current?.focus();
          }}
          placeholder={tab === "recall" ? "What do I already know about…?" : isLexical ? "Search notes…" : tab === "screenshots" ? "Search screenshots…" : "Search notes, docs, tasks and events…"}
          isLoading={isSearching}
          inputClassName="text-sm"
        />

        <div className="flex flex-wrap gap-1" role="group" aria-label="Search mode">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={tab === opt.id}
              title={opt.hint}
              onClick={() => onModeChange(opt.id)}
              className={`btn text-xs ${tab === opt.id ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "4px 10px" }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {isLexical ? (
          <p className="text-[11px] leading-snug text-text-subtle">
            {tab === "exact" ? "Exact searches notes for a phrase." : "Ranked searches notes by term relevance."} Use Semantic or Recall to search across sources.
          </p>
        ) : null}
        {tab === "semantic" ? (
          <p className="text-[11px] leading-snug text-text-subtle">
            Find related ideas across your notes, tasks and events, even when the words are different.
          </p>
        ) : null}
      </div>

      {tab === "screenshots" ? <ScreenshotSearch query={query} /> : tab === "semantic" ? (
        <RecallResults query={query} onOpenRecall={() => onModeChange("recall")} />
      ) : tab === "recall" ? (
        <RecallPage input={query} setInput={onQueryChange} />
      ) : (
        <>
          {isSearching ? <LoadingLine message="Searching…" /> : null}
          {error ? (
            <FetchError
              message={error}
              onRetry={() => retry(query, tab === "ranked" ? "semantic" : "exact")}
            />
          ) : null}

          {showEmpty ? (
            <EmptyState
              icon={<Search size={32} />}
              title={`No notes found for "${query}"`}
              subtitle="Try different keywords or search across sources."
              action={<button type="button" className="btn btn-ghost" onClick={() => onModeChange("semantic")}>Search across sources →</button>}
            />
          ) : null}

          {showResults ? (
            <>
              <p className="text-xs mb-3 text-text-subtle">
                {currentResults.total} result{currentResults.total !== 1 ? "s" : ""} in {currentResults.files.length} file{currentResults.files.length !== 1 ? "s" : ""}
                {currentResults.mode === "semantic" ? " · ranked" : ""}
              </p>
              <SearchResultList files={currentResults.files} query={query} semantic={tab === "ranked"} />
            </>
          ) : null}
        </>
      )}

      {!query && isLexical && !currentResults && !isSearching ? (
        <RecentWork />
      ) : null}
    </div>
  );
}
