"use client";

import { AlertCircle } from "lucide-react";

interface FetchErrorProps {
  message: string;
  onRetry?: () => void;
}

export function FetchError({ message, onRetry }: FetchErrorProps) {
  return (
    <div className="card card-body mb-3" style={{ borderLeft: "3px solid var(--danger)" }}>
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
