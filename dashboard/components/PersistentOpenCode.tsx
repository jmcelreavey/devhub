"use client";

import { useEffect, useState } from "react";
import { PersistentServiceFrame } from "./PersistentServiceFrame";
import { consumePendingOpenCodeSession, onOpenCodeSession } from "@/lib/opencode-session";

const PORT = process.env.NEXT_PUBLIC_OPENCODE_PORT ?? "1338";

/**
 * Keeps the OpenCode iframe alive across client-side route changes.
 * Lazy-mounts on first visit to /opencode, persists with display:none elsewhere.
 * Shows an "Open in new tab" link as fallback if the iframe is frame-restricted.
 *
 * Listens for session-open requests (e.g. the Datadog "Investigate" button) and
 * deep-links the iframe to `/session/{id}` so the freshly-created session is the
 * one the user actually lands on.
 */
export function PersistentOpenCode() {
  const [sessionId, setSessionId] = useState<string | null>(() => consumePendingOpenCodeSession());

  useEffect(() => onOpenCodeSession(setSessionId), []);

  return (
    <PersistentServiceFrame
      route="/opencode"
      serviceId="opencode"
      serviceName="OpenCode"
      port={PORT}
      title="OpenCode"
      showExternalLink
      srcPath={sessionId ? `/session/${encodeURIComponent(sessionId)}` : null}
    />
  );
}
