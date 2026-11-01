"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const runSearch = useCallback(async (q: string, searchMode: SearchMode) => {
    if (!q.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildSearchUrl(q, { mode: searchMode }), { signal: controller.signal });
      if (!r.ok) throw new Error("Search failed");
      const response = (await r.json()) as SearchResponse;
      if (requestId === requestRef.current) setResults(response);
    } catch (e) {
      if (requestId === requestRef.current && !controller.signal.aborted) {
        setResults(null);
        setError(e instanceof Error ? e.message : "Search failed");
      }
    } finally {
      if (requestId === requestRef.current) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const scheduleSearch = useCallback((q: string, searchMode: SearchMode) => {
    cancel();
    setLoading(false);
    setResults(null);
    setError(null);
    if (!q.trim()) {
      setPending(false);
      return;
    }
    setPending(true);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setPending(false);
      void runSearch(q, searchMode);
    }, debounceMs);
  }, [cancel, debounceMs, runSearch]);

  const retry = useCallback((q: string, searchMode: SearchMode) => {
    cancel();
    setPending(false);
    setLoading(false);
    if (q.trim()) void runSearch(q, searchMode);
  }, [cancel, runSearch]);

  const clear = useCallback(() => {
    cancel();
    setResults(null);
    setLoading(false);
    setPending(false);
    setError(null);
  }, [cancel]);

  return { results, loading, pending, error, scheduleSearch, retry, clear };
}
