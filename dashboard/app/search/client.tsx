"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState, FetchError, LoadingLine, PageHeader, SearchInput } from "@/components";
import { SearchResultList } from "@/components/ui/SearchResultList";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import { RecallResults } from "./RecallResults";

type SearchTab = "exact" | "ranked" | "recall";

const MODE_OPTIONS: { id: SearchTab; label: string; hint: string }[] = [
  { id: "exact", label: "Exact", hint: "Substring match in note text" },
  { id: "ranked", label: "Ranked", hint: "TF-IDF lexical ranking — not embeddings" },
  { id: "recall", label: "Semantic", hint: "Recall: vector + lexical fusion over everything indexed" },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("exact");
  const inputRef = useRef<HTMLInputElement>(null);
  const [recallRefresh, setRecallRefresh] = useState(0);
  const { results, loading, pending, error, scheduleSearch, retry, clear } = useDebouncedSearch();

  const onQueryChange = (val: string) => {
    setQuery(val);
    if (tab !== "recall") scheduleSearch(val, tab === "ranked" ? "semantic" : "exact");
  };

  const onModeChange = (next: SearchTab) => {
    setTab(next);
    if (next === "recall") {
      clear();
      setRecallRefresh((n) => n + 1); // re-run semantic for the current query
    } else if (query.trim()) {
      scheduleSearch(query, next === "ranked" ? "semantic" : "exact");
    }
  };

  const isLexical = tab !== "recall";
  const isSearching = isLexical && (pending || loading) && !!query.trim();
  const showEmpty =
    isLexical && !isSearching && !error && results && results.total === 0 && query.trim();
  const showResults = isLexical && results && results.total > 0;

  return (
    <div className="page-wrapper">
      <PageHeader
        title="Search"
        subtitle={<>Everything — notes, docs, tasks, learnings, diagrams, events. Quick jump: <kbd className="text-[10px] px-1 rounded" style={{ background: "var(--bg-elevated)" }}>⌘P</kbd></>}
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
              aria-selected={tab === opt.id}
              title={opt.hint}
              onClick={() => onModeChange(opt.id)}
              className={`btn text-xs ${tab === opt.id ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "4px 10px" }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {tab === "ranked" ? (
          <p className="text-[11px] leading-snug text-text-subtle">
            Ranked mode scores by term relevance — useful when you remember the topic, not the exact phrase.
          </p>
        ) : null}
        {tab === "recall" ? (
          <p className="text-[11px] leading-snug text-text-subtle">
            Semantic mode fuses vector and lexical ranking with recency priors, so newer notes win ties.
          </p>
        ) : null}
      </div>

      {tab === "recall" ? (
        <RecallResults query={query} refreshKey={recallRefresh} />
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
              title={`No results for "${query}"`}
              subtitle={tab === "exact" ? "Try Semantic mode for related notes." : "Try exact mode, or different keywords."}
            />
          ) : null}

          {showResults ? (
            <>
              <p className="text-xs mb-3 text-text-subtle">
                {results.total} result{results.total !== 1 ? "s" : ""} in {results.files.length} file{results.files.length !== 1 ? "s" : ""}
                {results.mode === "semantic" ? " · ranked" : ""}
              </p>
              <SearchResultList files={results.files} query={query} semantic={tab === "ranked"} />
            </>
          ) : null}
        </>
      )}

      {!query && tab !== "recall" && !results && !isSearching ? (
        <EmptyState
          icon={<Search size={36} />}
          title="Search everything"
          subtitle="Exact for phrases, Ranked for TF-IDF, Semantic for meaning. Semantic covers tasks, learnings, daily notes, diagrams and your event spine."
        />
      ) : null}
    </div>
  );
}
