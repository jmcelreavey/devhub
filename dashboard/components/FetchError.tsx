"use client";

import { AlertCircle } from "lucide-react";

interface FetchErrorProps {
  message: string;
  onRetry?: () => void;
  /** Flat panel — use when already inside a `.card` (avoids card-in-card). */
  bare?: boolean;
}

export function FetchError({ message, onRetry, bare }: FetchErrorProps) {
  return (
    <div className={bare ? "mb-3 py-1" : "card card-body mb-3"}>
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <AlertCircle size={14} style={{ color: "var(--danger)" }} aria-hidden />
        {message}
        {onRetry && (
          <button type="button" className="btn btn-ghost ml-auto" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
