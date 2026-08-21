"use client";

import type { ReactNode } from "react";
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
  /** Extra control after the clear button (e.g. "Add PR"). */
  trailing?: ReactNode;
  describedBy?: string;
}

/**
 * The single-line search row used across the dedicated screens (Work → Tasks,
 * Work → Jira, History, PRs). Deliberately borderless so it can sit inside a
 * `card` or directly above a list without adding a second box.
 *
 * Focus ring lives on this wrapper — not the inner input — so the accent
 * outline has padding between it and the icon/placeholder.
 */
export function InlineSearch({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus = false,
  trailing,
  describedBy,
}: InlineSearchProps) {
  return (
    <div className="search-field">
      <Search size={15} className="search-field__icon search-field__icon--accent" aria-hidden />
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
        className="search-field__input"
        aria-describedby={describedBy}
      />
      {hint ? (
        <span className="search-field__hint" role="status">
          {hint}
        </span>
      ) : null}
      {value ? (
        <button
          type="button"
          className="search-field__clear"
          onClick={() => onChange("")}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
      {trailing}
    </div>
  );
}
