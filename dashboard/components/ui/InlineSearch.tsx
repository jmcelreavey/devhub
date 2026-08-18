"use client";

import { Search, X } from "lucide-react";

export interface InlineSearchProps {
  id: string;
  /** Screen-reader label; the visible placeholder usually repeats it. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Right-aligned hint, e.g. "12 of 48". */
  hint?: string;
  autoFocus?: boolean;
}

/**
 * The single-line search row used across the dedicated screens (Work → Tasks,
 * Work → Jira, History, PRs). Deliberately borderless so it can sit inside a
 * `card` or directly above a list without adding a second box.
 */
export function InlineSearch({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus = false,
}: InlineSearchProps) {
  return (
    <div className="flex items-center gap-2">
      <Search size={15} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoFocus={autoFocus}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none text-text"
      />
      {hint ? (
        <span className="shrink-0 text-xs text-text-subtle" role="status">
          {hint}
        </span>
      ) : null}
      {value ? (
        <button
          type="button"
          className="rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
          onClick={() => onChange("")}
          style={{ color: "var(--text-subtle)", flexShrink: 0 }}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
