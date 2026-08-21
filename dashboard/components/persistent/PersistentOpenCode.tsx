"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLazyServicePort } from "@/lib/hooks/use-lazy-service-port";
import { PersistentServiceFrame } from "./PersistentServiceFrame";
import { consumePendingOpenCodeSession, onOpenCodeSession } from "@/lib/opencode/session";

/**
 * Keeps the OpenCode iframe alive across client-side route changes.
 * Lazy-mounts on first visit to /opencode, persists with display:none elsewhere.
 *
 * OpenCode is not an always-on peer on 1338 (that made OpenChamber.app attach
 * as an external server). The listen API starts an ephemeral loopback instance
 * only when this tab — or a session deep-link, e.g. the Datadog "Investigate"
 * button — actually needs it.
 */
export function PersistentOpenCode() {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(() => consumePendingOpenCodeSession());
  const { port, refresh } = useLazyServicePort(
    pathname === "/opencode" || sessionId !== null,
    "/api/opencode/listen",
  );

  useEffect(() => onOpenCodeSession(setSessionId), []);

  // Agent jobs / Datadog Investigate request a session from outside /opencode —
  // land the user on the tab so the iframe is visible.
  useEffect(() => {
    if (!sessionId) return;
    if (pathname === "/opencode") return;
    router.push("/opencode");
  }, [sessionId, pathname, router]);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href) router.push(href);
    };
    window.addEventListener("devhub:navigate", onNavigate);
    return () => window.removeEventListener("devhub:navigate", onNavigate);
  }, [router]);

  return (
    <PersistentServiceFrame
      route="/opencode"
      serviceId="opencode"
      serviceName="OpenCode"
      port={port}
      title="OpenCode"
      srcPath={sessionId ? `/session/${encodeURIComponent(sessionId)}` : null}
      onRestarted={refresh}
    />
  );
}
