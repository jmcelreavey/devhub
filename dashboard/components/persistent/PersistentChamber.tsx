"use client";

import { PersistentServiceFrame } from "./PersistentServiceFrame";

const PORT = process.env.NEXT_PUBLIC_OPENCHAMBER_PORT ?? "1336";

/**
 * Keeps the OpenChamber iframe alive across client-side route changes.
 * Lazy-mounts on first visit to /chamber, persists with display:none elsewhere.
 */
export function PersistentChamber() {
  return (
    <PersistentServiceFrame
      route="/chamber"
      serviceId="openchamber"
      serviceName="OpenChamber"
      port={PORT}
      title="OpenChamber"
    />
  );
}
