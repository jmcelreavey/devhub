"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RotateCw } from "lucide-react";

interface ServiceStatus {
  name: string;
  active: boolean;
}

interface Props {
  /** Route that activates the iframe (e.g. "/chamber"). */
  route: string;
  /** Key in /api/status/services response (e.g. "openchamber"). */
  serviceId: string;
  /** Human-readable name for error messages (e.g. "OpenChamber"). */
  serviceName: string;
  /** Port for the iframe URL. `null` while the lazy-start API is still resolving. */
  port: string | null;
  /** iframe title attribute. */
  title: string;
  /** Optional path (e.g. `/session/abc`) appended to the service origin for deep-linking. */
  srcPath?: string | null;
  /** Called after an in-frame Restart so the parent can re-resolve the port. */
  onRestarted?: () => void;
}

function useServiceBaseUrl(port: string | null): string {
  const [base, setBase] = useState(`http://localhost:${port}`);
  useEffect(() => {
    if (!port) return;
    const id = window.setTimeout(() => {
      setBase(`${window.location.protocol}//${window.location.hostname}:${port}`);
    }, 0);
    return () => window.clearTimeout(id);
  }, [port]);
  return base;
}

function ServiceSpinner({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 text-text-subtle">
        <RotateCw size={14} className="animate-spin" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

export function PersistentServiceFrame({
  route,
  serviceId,
  serviceName,
  port,
  title,
  srcPath,
  onRestarted,
}: Props) {
  const pathname = usePathname();
  const isActive = pathname === route;
  const [mounted, setMounted] = useState(false);

  if (!mounted && isActive) setMounted(true);

  // RAM guard: the iframe stays mounted across routes to preserve session
  // state, but an embedded app (terminal buffers, editors) accumulates
  // memory forever. If the user hasn't visited this route in a while,
  // unload the iframe — it remounts fresh on the next visit.
  useEffect(() => {
    if (isActive || !mounted) return;
    const IDLE_UNLOAD_MS = 20 * 60 * 1000; // 20 minutes away → release it
    const t = setTimeout(() => setMounted(false), IDLE_UNLOAD_MS);
    return () => clearTimeout(t);
  }, [isActive, mounted]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden={!isActive}
      style={{
        position: "absolute",
        inset: 0,
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        zIndex: "var(--z-base)",
      }}
    >
      <ServiceIframe
        serviceId={serviceId}
        serviceName={serviceName}
        port={port}
        title={title}
        srcPath={srcPath}
        onRestarted={onRestarted}
      />
    </div>
  );
}

function ServiceIframe({
  serviceId,
  serviceName,
  port,
  title,
  srcPath,
  onRestarted,
}: {
  serviceId: string;
  serviceName: string;
  port: string | null;
  title: string;
  srcPath?: string | null;
  onRestarted?: () => void;
}) {
  const baseUrl = useServiceBaseUrl(port);
  const iframeSrc = srcPath ? `${baseUrl}${srcPath}` : baseUrl;
  const [services, setServices] = useState<Record<string, ServiceStatus> | null>(null);
  const [restarting, setRestarting] = useState(false);

  const fetchStatus = useCallback(() => {
    fetch("/api/status/services")
      .then((r) => r.json())
      .then(setServices)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const running = services?.[serviceId]?.active === true;

  async function restart() {
    setRestarting(true);
    try {
      await fetch("/api/status/services/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceId }),
      });
      setTimeout(fetchStatus, 2_000);
      // OpenCode comes back on a new ephemeral port — the parent has to ask
      // the listen API again or the iframe keeps pointing at the dead one.
      onRestarted?.();
    } finally {
      setRestarting(false);
    }
  }

  if (!port) return <ServiceSpinner label={`Starting ${serviceName}…`} />;

  if (services && !running) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-text-muted"
      >
        <AlertTriangle size={32} className="text-warning" />
        <p className="text-sm">{serviceName} is not running</p>
        <button
          className="btn btn-ghost flex items-center gap-1.5"
          style={{ fontSize: "12px", padding: "4px 10px" }}
          onClick={restart}
          disabled={restarting}
        >
          <RotateCw size={12} className={restarting ? "animate-spin" : ""} />
          {restarting ? "Restarting…" : "Restart"}
        </button>
      </div>
    );
  }

  if (!running) return <ServiceSpinner label={`Waiting for ${serviceName}…`} />;

  return (
    <>
      {/*
        "Open in new tab" used to live here — an escape hatch for a
        frame-restricted iframe. It never worked in the desktop app: Tauri
        blocks `target="_blank"` outright, so clicking it did nothing at all,
        silently. A dead control is worse than no control.

        The browser view in the same dropdown covers the real need, and now
        routes through the shell's opener rather than `window.open`, which was
        blocked the same way.
      */}
      <iframe
        src={iframeSrc}
        className="w-full border-0"
        style={{ background: "#fff", flex: "1 1 0%", minHeight: 0 }}
        allow="clipboard-read; clipboard-write"
        title={title}
      />
    </>
  );
}
