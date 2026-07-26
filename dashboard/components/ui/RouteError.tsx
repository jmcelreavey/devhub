"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";

export interface RouteErrorProps {
  /** Next.js passes these to every `error.tsx`. */
  error: Error & { digest?: string };
  reset: () => void;
  /** Route-specific heading, e.g. "Couldn't load Jira tickets". */
  title?: string;
  /**
   * Route-specific remedy — usually which env vars or integration to check.
   * Routes that hit an external service should always set this; a generic
   * "something went wrong" is useless when the real answer is "your Datadog
   * key expired".
   */
  hint?: ReactNode;
}

/**
 * Shared route error boundary UI.
 *
 * Every `app/<route>/error.tsx` is a thin wrapper over this, so all failures
 * look the same and every one of them offers the same two things: a retry, and
 * the error text in a form you can paste into an issue. Before this, 32 of 35
 * routes had no `error.tsx` at all and fell through to Next's raw error
 * overlay — which is unhelpful on the routes most likely to fail, since those
 * are precisely the ones talking to Jira, Datadog, GitHub or an LLM.
 */
export function RouteError({ error, reset, title, hint }: RouteErrorProps) {
  useEffect(() => {
    console.error(`[route-error]${title ? ` ${title}:` : ""}`, error);
  }, [error, title]);

  const details = [
    error.message,
    error.stack ?? "",
    error.digest ? `digest: ${error.digest}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="page-wrapper">
      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} className="text-danger" aria-hidden />
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {title ?? "Something went wrong"}
          </h1>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          {hint ?? "An unexpected error broke this view. Try again, or copy the details below."}
        </p>

        {error.message && (
          <pre
            style={{
              marginTop: 12,
              marginBottom: 0,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: 10,
              fontSize: 12,
              overflowX: "auto",
              color: "var(--text-muted)",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
            }}
          >
            {error.message}
          </pre>
        )}

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

/**
 * Factory for the common case: a route wants the shared UI with its own
 * heading and remedy.
 *
 *   export default routeError({
 *     title: "Couldn't load Datadog",
 *     hint: <>Check <code>DATADOG_API_KEY</code> in <code>.env.local</code>.</>,
 *   });
 */
export function routeError(defaults: Pick<RouteErrorProps, "title" | "hint">) {
  return function BoundRouteError(props: Pick<RouteErrorProps, "error" | "reset">) {
    return <RouteError {...props} {...defaults} />;
  };
}

export default RouteError;
