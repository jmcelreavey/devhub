"use client";

import type { Ref } from "react";
import { Clock, Search, X } from "lucide-react";

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
  const showTrailingControl = isLoading || (showClear && value);

  return (
    <div className={wrapperClassName} style={{ position: "relative" }}>
      <Search
        size={14}
        style={{
          position: "absolute",
          left: "10px",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-subtle)",
        }}
        aria-hidden
      />
      <input
        id={id}
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        className={`input w-full ${inputClassName}`.trim()}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: "32px", paddingRight: showTrailingControl ? "32px" : undefined }}
      />
      {isLoading ? (
        <Clock
          size={14}
          className="animate-spin"
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-subtle)",
          }}
          aria-hidden
        />
      ) : showClear && value ? (
        <button
          type="button"
          onClick={() => (onClear ? onClear() : onChange(""))}
          style={{
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-subtle)",
          }}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
