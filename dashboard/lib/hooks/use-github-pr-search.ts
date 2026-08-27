"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PrSearchApiPayload, PrSearchRow } from "@/lib/github/pr-search";

export type { PrSearchRow };

const MIN_QUERY_LENGTH = 2;

export interface GithubPrSearchState {
  results: PrSearchRow[];
  ghQuery: string;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

interface InternalState extends Snapshot {
  /** The query these results belong to, so a stale response never renders. */
  query: string;
}

/** `retry` is a live callback, so the shared shapes stop just short of it. */
type Snapshot = Omit<GithubPrSearchState, "retry">;

const IDLE: Snapshot = { results: [], ghQuery: "", loading: false, error: null };
const PENDING: Snapshot = { ...IDLE, loading: true };
const INITIAL: InternalState = { ...IDLE, query: "" };

/**
 * Debounced GitHub-wide PR search — the fallback when a query matches nothing
 * in the locally loaded authored/review/recent buckets.
 *
 * Pass `enabled: false` to keep it quiet (empty query, or the box is in
 * "add a PR by URL" mode).
 */
export function useGithubPrSearch(
  query: string,
  enabled: boolean,
  debounceMs = 400,
): GithubPrSearchState {
  const [state, setState] = useState<InternalState>(INITIAL);
  const requestId = useRef(0);

  const trimmed = query.trim();
  const active = enabled && trimmed.length >= MIN_QUERY_LENGTH;

  const run = useCallback(async (q: string) => {
    const id = ++requestId.current;
    try {
      const res = await fetch(`/api/github/prs/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("GitHub search failed");
      const data = (await res.json()) as PrSearchApiPayload;
      if (id !== requestId.current) return;
      setState({
        query: q,
        results: data.results ?? [],
        ghQuery: data.ghQuery ?? "",
        loading: false,
        error: null,
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setState({
        query: q,
        results: [],
        ghQuery: "",
        loading: false,
        error: err instanceof Error ? err.message : "GitHub search failed",
      });
    }
  }, []);

  const retry = useCallback(() => {
    if (!active) return;
    void run(trimmed);
  }, [active, run, trimmed]);

  useEffect(() => {
    if (!active) {
      // Drop any in-flight response on the floor; the hook reports IDLE below.
      requestId.current++;
      return;
    }
    const timer = setTimeout(() => void run(trimmed), debounceMs);
    return () => clearTimeout(timer);
  }, [trimmed, active, debounceMs, run]);

  if (!active) return { ...IDLE, retry };
  // Debouncing, or waiting on the response for the query currently typed.
  if (state.query !== trimmed) return { ...PENDING, retry };
  return {
    results: state.results,
    ghQuery: state.ghQuery,
    loading: state.loading,
    error: state.error,
    retry,
  };
}
