"use client";

import { useCallback, useEffect, useState } from "react";

/** Listen can spawn a binary; don't leave the tab on a spinner if that hangs. */
const LISTEN_TIMEOUT_MS = 20_000;

/**
 * Parse `/api/opencode/listen` (or Chamber) JSON. A 403 `{ error }` used to
 * leave `port` null forever, which the frame renders as "Starting…" with no
 * way out.
 */
export function listenPortFromPayload(
  data: unknown,
  httpOk: boolean,
): { port: number | null; error: string | null } {
  if (data && typeof data === "object" && "port" in data) {
    const port = (data as { port: unknown }).port;
    if (typeof port === "number" && Number.isFinite(port) && port > 0) {
      return { port, error: null };
    }
  }
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return { port: null, error: message };
    }
  }
  return { port: null, error: httpOk ? "Did not return a port." : "Could not start." };
}

/**
 * Resolve the port of a peer service that is started on demand.
 *
 * OpenChamber and OpenCode are no longer always-on peers: the first visit to
 * their tab is what starts them, via a `listen` API that returns the port it
 * bound. `port` stays `null` until that resolves, which the frame renders as a
 * spinner rather than a blank pane. A failed listen sets `error` so the frame
 * can show Retry instead of spinning forever.
 */
export function useLazyServicePort(
  active: boolean,
  endpoint: string,
  fallbackPort?: string,
): { port: string | null; error: string | null; refresh: () => void } {
  const [port, setPort] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), LISTEN_TIMEOUT_MS);

    void fetch(endpoint, { signal: ac.signal, credentials: "same-origin" })
      .then(async (res) => {
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        return { ok: res.ok, data };
      })
      .then(({ ok, data }) => {
        if (cancelled) return;
        const parsed = listenPortFromPayload(data, ok);
        if (parsed.port != null) {
          setPort(String(parsed.port));
          setError(null);
          return;
        }
        setPort(fallbackPort ?? null);
        setError(parsed.error);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPort(fallbackPort ?? null);
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setError(aborted ? "Timed out while starting." : "Could not reach the service.");
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [active, endpoint, fallbackPort, nonce]);

  const refresh = useCallback(() => {
    setError(null);
    setNonce((n) => n + 1);
  }, []);
  return { port, error, refresh };
}
