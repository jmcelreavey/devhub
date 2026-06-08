"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled UI error:", error);
  }, [error]);

  const details = `${error.message}\n${error.stack ?? ""}${error.digest ? `\ndigest: ${error.digest}` : ""}`;

  return (
    <div className="page-wrapper">
      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} style={{ color: "var(--danger)" }} aria-hidden />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Something went wrong</h1>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          An unexpected error broke this view. You can try again or copy the details for debugging.
        </p>
        <pre
          style={{
            marginTop: 12,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: 10,
            fontSize: 12,
            overflowX: "auto",
            color: "var(--text-muted)",
            maxHeight: 200,
          }}
        >
          {error.message}
        </pre>
        <div className="flex items-center gap-2 mt-4">
          <button type="button" className="btn btn-primary" onClick={reset}>
            <RotateCw size={13} aria-hidden /> Try again
          </button>
          <CopyButton text={details} label="error details" size={13} />
        </div>
      </div>
    </div>
  );
}
