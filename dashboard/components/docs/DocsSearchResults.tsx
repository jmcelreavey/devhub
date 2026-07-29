"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, SearchX } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { getSectionMeta } from "@/lib/docs/doc-sections";
import type { DocSearchHit } from "@/lib/docs/doc-search-types";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;

/**
 * Sidebar search results.
 *
 * Shows section-scoped hits rather than just page names — the useful answer to
 * "where is X documented" is usually a heading three levels into a reference
 * page, not the page itself.
 */
export function DocsSearchResults({ query }: { query: string }) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    // Debounced: the index is fast, but firing on every keystroke makes results
    // flicker between partial-word matches.
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();
  const { data, isLoading } = useLive<{ results: DocSearchHit[] }>(
    trimmed.length >= MIN_QUERY ? `/api/docs/search?q=${encodeURIComponent(trimmed)}&limit=12` : null,
    { refreshInterval: 0, revalidateOnFocus: false, keepPreviousData: true },
  );

  const results = data?.results;
  if (!results) {
    return (
      <div className="lib-search-empty">
        <SearchX size={18} aria-hidden />
        <p>Searching…</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="lib-search-empty">
        <SearchX size={18} aria-hidden />
        <p>No matches for “{trimmed}”.</p>
      </div>
    );
  }

  return (
    <div className="lib-search-results" aria-busy={isLoading}>
      <p className="lib-search-count">
        {results.length} {results.length === 1 ? "page" : "pages"}
      </p>
      {results.map((hit) => (
        <div key={hit.slug} className="lib-search-hit">
          <Link href={hit.href} className="lib-search-hit-title">
            <FileText size={12} aria-hidden />
            <span>{hit.title}</span>
          </Link>
          <span className="lib-search-hit-section">{getSectionMeta(hit.section).label}</span>
          {hit.matches.map((match, i) => (
            <Link key={i} href={match.href} className="lib-search-match">
              <span className="lib-search-match-heading">{match.heading}</span>
              <span className="lib-search-match-snippet">{match.snippet}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
