"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { AGENT_CONVERSATION_EVENT } from "@/lib/agent-handoff";

/** This frame has no activity subscriptions: only local navigation can select a chat. */
export function PersistentAgents() {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = pathname === "/agents" && (!params.get("view") || params.get("view") === "chats");
  const conversation = params.get("conversation");
  const [origin, setOrigin] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const attempted = useRef(false);
  const appliedLink = useRef("");
  const appliedRequest = useRef(0);
  const [requested, setRequested] = useState<{ id: string; serial: number }>();
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === "string" && id) setRequested(previous => ({ id, serial: (previous?.serial ?? 0) + 1 }));
    };
    window.addEventListener(AGENT_CONVERSATION_EVENT, open);
    return () => window.removeEventListener(AGENT_CONVERSATION_EVENT, open);
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/aionui/connection", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "browser-session" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not connect to Agents.");
      const address = new URL(data.origin);
      // Cookies are host-scoped, not port-scoped. Use the local dashboard's host
      // so the normal HttpOnly AionUi session also authenticates the iframe.
      if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) throw new Error("Open DevHub on this computer to use Agents.");
      address.hostname = window.location.hostname;
      setOrigin(address.origin);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect to Agents."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (pathname === "/agents" && params.get("view") === "connection") attempted.current = false;
    if (!active || attempted.current) return;
    attempted.current = true;
    void connect();
  }, [active, connect, pathname, params]);

  useEffect(() => {
    if (!active || !origin || !conversation || !frame.current) return;
    const link = origin + ":" + conversation;
    if (appliedLink.current === link) return;
    // A fragment change preserves the loaded client and its drafts. Background
    // updates never change src, remount this frame or emit this navigation.
    frame.current.src = `${origin}/#/conversation/${encodeURIComponent(conversation)}`;
    appliedLink.current = link;
  }, [active, origin, conversation]);

  useEffect(() => {
    if (!active || !origin || !requested || !frame.current || appliedRequest.current === requested.serial) return;
    frame.current.src = `${origin}/#/conversation/${encodeURIComponent(requested.id)}`;
    appliedRequest.current = requested.serial;
  }, [active, origin, requested]);

  if (!active && !origin) return null;
  return (
    <section aria-label="Agents chats" hidden={!active} style={{ position: "absolute", inset: "57px 0 0", display: active ? "flex" : "none", flexDirection: "column", background: "var(--bg)" }}>
      {error && <div className="tone-panel tone-panel--warning m-4" role="alert">
        <p>{error}</p>
        <div className="flex gap-3 mt-3"><Link className="btn btn-primary" href="/agents?view=connection">Connect AionUi</Link><button className="btn btn-ghost" onClick={() => void connect()} disabled={loading}>Retry</button></div>
      </div>}
      {!origin && !error && <div className="p-6" aria-label="Loading Agents"><SkeletonRows count={5} variant="list" height={48} /></div>}
      {origin && <iframe ref={frame} src={`${origin}/#/guid`} title="Agents — AionUi" className="w-full flex-1 border-0 min-h-0" allow="clipboard-read; clipboard-write" />}
    </section>
  );
}
