"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Resolve the port of a peer service that is started on demand.
 *
 * OpenChamber and OpenCode are no longer always-on peers: the first visit to
 * their tab is what starts them, via a `listen` API that returns the port it
 * bound. `port` stays `null` until that resolves, which the frame renders as a
 * spinner rather than a blank pane.
 */
export function useLazyServicePort(
  active: boolean,
  endpoint: string,
  fallbackPort?: string,
): { port: string | null; refresh: () => void } {
  const [port, setPort] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetch(endpoint)
      .then((res) => res.json())
      .then((data: { port?: number }) => {
        if (cancelled) return;
        setPort(typeof data.port === "number" ? String(data.port) : (fallbackPort ?? null));
      })
      .catch(() => {
        // Leave the frame on its waiting/not-running state, which offers Restart.
        if (!cancelled) setPort(fallbackPort ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, endpoint, fallbackPort, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { port, refresh };
}
