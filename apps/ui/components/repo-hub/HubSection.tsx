"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

/**
 * A counted, collapsible hub section with an optional filter box.
 *
 * Backlog and completed work stay compact until the user needs their rows.
 */
export function HubSection({
  title,
  count,
  open,
  onOpenChange,
  query,
  onQueryChange,
  searchThreshold = 6,
  searchPlaceholder = "Filter…",
  actions,
  sharedChips,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  query?: string;
  onQueryChange?: (next: string) => void;
  /** Show the filter box only once the list is long enough to need it. */
  searchThreshold?: number;
  searchPlaceholder?: string;
  actions?: ReactNode;
  /** Links every row shares, shown once here instead of on each row. */
  sharedChips?: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  const searchable = Boolean(onQueryChange) && count >= searchThreshold;
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <button
          type="button"
          className="flex min-h-11 items-center gap-1 text-sm font-semibold text-text"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          <span className="repo-hub-section-count">{count}</span>
        </button>
        {open ? actions : null}
      </div>
      <div id={contentId} hidden={!open}>
        {open ? <>
          {sharedChips ? <div className="repo-hub-section-shared">{sharedChips}</div> : null}
          {searchable ? (
            <div className="repo-hub-section-search">
              <Search size={13} aria-hidden />
              <input
                className="input"
                value={query ?? ""}
                onChange={(event) => onQueryChange?.(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={`Filter ${title}`}
              />
            </div>
          ) : null}
          {children}
        </> : null}
      </div>
    </section>
  );
}
