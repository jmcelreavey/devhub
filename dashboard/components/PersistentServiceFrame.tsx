"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ExternalLink, RotateCw } from "lucide-react";

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
  /** Port to build the iframe URL (resolved by the parent from NEXT_PUBLIC env). */
  port: string;
  /** iframe title attribute. */
  title: string;
  /** When true, shows an "Open in new tab" escape-hatch link above the iframe. */
  showExternalLink?: boolean;
  /** Optional path (e.g. `/session/abc`) appended to the service origin for deep-linking. */
  srcPath?: string | null;
}

function useServiceBaseUrl(port: string): string {
  const [base, setBase] = useState(`http://localhost:${port}`);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setBase(`${window.location.protocol}//${window.location.hostname}:${port}`);
    }, 0);
    return () => window.clearTimeout(id);
  }, [port]);
  return base;
}

export function PersistentServiceFrame({
  route,
  serviceId,
  serviceName,
  port,
  title,
  showExternalLink = false,
  srcPath,
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
        zIndex: 1,
      }}
    >
      <ServiceIframe
        serviceId={serviceId}
        serviceName={serviceName}
        port={port}
        title={title}
        showExternalLink={showExternalLink}
        srcPath={srcPath}
      />
    </div>
  );
}

function ServiceIframe({
  serviceId,
  serviceName,
  port,
  title,
  showExternalLink,
  srcPath,
}: {
  serviceId: string;
  serviceName: string;
  port: string;
  title: string;
  showExternalLink: boolean;
  srcPath?: string | null;
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
    } finally {
      setRestarting(false);
    }
  }

  if (services && !running) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center gap-3 p-8"
        style={{ color: "var(--text-muted)" }}
      >
        <AlertTriangle size={32} style={{ color: "var(--warning)" }} />
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

  if (!running) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2" style={{ color: "var(--text-subtle)" }}>
          <RotateCw size={14} className="animate-spin" />
          <span className="text-sm">Waiting for {serviceName}…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {showExternalLink && (
        <div
          className="flex items-center justify-end px-3 py-1 shrink-0"
          style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border-muted)" }}
        >
          <a
            href={baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--text-subtle)" }}
          >
            <ExternalLink size={10} />
            Open in new tab
          </a>
        </div>
      )}
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
