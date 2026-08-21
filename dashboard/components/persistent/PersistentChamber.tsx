"use client";

import { usePathname } from "next/navigation";
import { useLazyServicePort } from "@/lib/hooks/use-lazy-service-port";
import { PersistentServiceFrame } from "./PersistentServiceFrame";

const FALLBACK_PORT = process.env.NEXT_PUBLIC_OPENCHAMBER_PORT ?? "1336";

/**
 * Keeps the OpenChamber iframe alive across client-side route changes.
 * Lazy-mounts on first visit to /chamber, persists with display:none elsewhere.
 *
 * Chamber is not an always-on peer. Booting it with DevHub started a second
 * OpenCode that raced OpenChamber.app on opencode.json. The listen API starts
 * Chamber on 1336 only when this tab needs it, with skip-start / OPENCODE_PORT
 * stripped so Setup can restart OpenCode.
 */
export function PersistentChamber() {
  const active = usePathname() === "/chamber";
  const { port, refresh } = useLazyServicePort(active, "/api/openchamber/listen", FALLBACK_PORT);

  return (
    <PersistentServiceFrame
      route="/chamber"
      serviceId="openchamber"
      serviceName="OpenChamber"
      port={port}
      title="OpenChamber"
      onRestarted={refresh}
    />
  );
}
