"use client";

import { useCallback, useRef, useState } from "react";
import { buildSearchUrl, type SearchFileGroup, type SearchMode } from "@/lib/search-ui";

export interface SearchResponse {
  query: string;
  total: number;
  mode?: string;
  files: SearchFileGroup[];
}

export function useDebouncedSearch(debounceMs = 300) {
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string, searchMode: SearchMode) => {
    if (!q.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildSearchUrl(q, { mode: searchMode }));
      if (!r.ok) throw new Error("Search failed");
      setResults((await r.json()) as SearchResponse);
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleSearch = useCallback((q: string, searchMode: SearchMode) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults(null);
      setPending(false);
      setError(null);
      return;
    }
    setPending(true);
    debounceRef.current = setTimeout(() => {
      void runSearch(q, searchMode);
      setPending(false);
    }, debounceMs);
  }, [debounceMs, runSearch]);

  const retry = useCallback((q: string, searchMode: SearchMode) => {
    if (q.trim()) void runSearch(q, searchMode);
  }, [runSearch]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResults(null);
    setPending(false);
    setError(null);
  }, []);

  return { results, loading, pending, error, scheduleSearch, retry, clear };
}
