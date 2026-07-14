"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, FetchError, LoadingLine, PageHeader, SearchInput } from "@/components";
import { SearchResultList } from "@/components/SearchResultList";
import type { SearchMode } from "@/lib/search-ui";
import { useDebouncedSearch } from "@/lib/use-debounced-search";

const MODE_OPTIONS: { id: Exclude<SearchMode, "auto">; label: string; hint: string }[] = [
  { id: "exact", label: "Exact", hint: "Substring match in note text" },
  { id: "semantic", label: "Ranked", hint: "TF-IDF lexical ranking — not embeddings" },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Exclude<SearchMode, "auto">>("exact");
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading, pending, error, scheduleSearch, retry, clear } = useDebouncedSearch();

  const onQueryChange = (val: string) => {
    setQuery(val);
    scheduleSearch(val, mode);
  };

  const onModeChange = (next: Exclude<SearchMode, "auto">) => {
    setMode(next);
    if (query.trim()) scheduleSearch(query, next);
  };

  const isSearching = (pending || loading) && !!query.trim();
  const showEmpty = !isSearching && !error && results && results.total === 0 && query.trim();
  const showResults = results && results.total > 0;

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Search"
        subtitle={<>Full vault search across notes and diagrams. Quick jump: <kbd className="text-[10px] px-1 rounded" style={{ background: "var(--bg-elevated)" }}>⌘K</kbd></>}
      />

      <div className="card card-body mb-4 space-y-3">
        <SearchInput
          inputRef={inputRef}
          autoFocus
          wrapperClassName=""
          value={query}
          onChange={onQueryChange}
          onClear={() => {
            setQuery("");
            clear();
            inputRef.current?.focus();
          }}
          placeholder="Search notes, learnings, diagrams…"
          isLoading={isSearching}
          inputClassName="text-sm"
        />

        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Search mode">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={mode === opt.id}
              title={opt.hint}
              onClick={() => onModeChange(opt.id)}
              className={`btn text-xs ${mode === opt.id ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "4px 10px" }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mode === "semantic" ? (
          <p className="text-[11px] leading-snug" style={{ color: "var(--text-subtle)" }}>
            Semantic mode ranks related notes by term relevance - useful when you remember the topic, not the exact phrase.
          </p>
        ) : null}
      </div>

      {isSearching ? <LoadingLine message="Searching…" /> : null}
      {error ? <FetchError message={error} onRetry={() => retry(query, mode)} /> : null}

      {showEmpty ? (
        <EmptyState
          icon={<Search size={32} />}
          title={`No results for "${query}"`}
          subtitle={mode === "semantic" ? "Try exact mode, or different keywords." : "Try ranked (TF-IDF) mode for related notes."}
        />
      ) : null}

      {showResults ? (
        <>
          <p className="text-xs mb-3" style={{ color: "var(--text-subtle)" }}>
            {results.total} result{results.total !== 1 ? "s" : ""} in {results.files.length} file{results.files.length !== 1 ? "s" : ""}
            {results.mode === "semantic" ? " · ranked" : ""}
          </p>
          <SearchResultList files={results.files} query={query} semantic={mode === "semantic"} />
        </>
      ) : null}

      {!query && !results && !isSearching ? (
        <EmptyState
          icon={<Search size={36} />}
          title="Search your vault"
          subtitle="Find tasks, learnings, daily notes, and diagrams. Use ranked mode for fuzzy topic matches (lexical TF-IDF, not embeddings)."
        />
      ) : null}
    </div>
  );
}
