"use client";

import type { InputHTMLAttributes, Ref } from "react";
import { Clock, Search, X } from "lucide-react";

/**
 * Browser spellcheck and writing-suggestions intercept ArrowUp/ArrowDown
 * (and can rewrite the query) before result-navigation handlers run.
 * `writingsuggestions` is the Safari 18 / Chrome chip; not in React's input types yet.
 */
export const SEARCH_QUERY_INPUT_ATTRS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  writingsuggestions: "false",
} as InputHTMLAttributes<HTMLInputElement>;

interface SearchInputProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  isLoading?: boolean;
  showClear?: boolean;
  onClear?: () => void;
  /** Wrapper class; default adds bottom margin for page layouts. */
  wrapperClassName?: string;
  inputClassName?: string;
}

/**
 * Boxed search field. Shares `.search-field` spacing/focus with InlineSearch
 * so list pages and overlays don't each invent a different ring.
 */
export function SearchInput({
  id,
  value,
  onChange,
  placeholder = "Search...",
  autoFocus = false,
  inputRef,
  isLoading = false,
  showClear = true,
  onClear,
  wrapperClassName = "mb-4",
  inputClassName = "",
}: SearchInputProps) {
  const classes = ["search-field", "search-field--boxed", wrapperClassName].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <Search size={15} className="search-field__icon" aria-hidden />
      <input
        id={id}
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        {...SEARCH_QUERY_INPUT_ATTRS}
        className={`search-field__input ${inputClassName}`.trim()}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {isLoading ? (
        <Clock size={14} className="search-field__busy" aria-hidden />
      ) : showClear && value ? (
        <button
          type="button"
          className="search-field__clear"
          onClick={() => (onClear ? onClear() : onChange(""))}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
