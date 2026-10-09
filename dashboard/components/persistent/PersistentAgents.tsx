"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { AGENT_CONVERSATION_EVENT } from "@/lib/agent-handoff";
import { isDesktop, openInBrowser } from "@/lib/desktop/bridge";

/**
 * Paseo syncs its stack with history.go() inside the Send gesture. That call
 * shares the window's session history, so it can step DevHub back to the
 * previous page. The sandbox blocks ancestor navigation (including
 * user-activated history traversals) and leaves the frame's own history alone.
 */
const PASEO_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";

/** This frame has no activity subscriptions: only local navigation can select a chat. */
export function PersistentAgents() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = pathname === "/agents" && params.get("view") !== "connection" && params.get("view") !== "usage";
  const conversation = params.get("conversation");
  const runLink = params.get("run");
  const [origin, setOrigin] = useState<string>();
  const [error, setError] = useState<string>();
  const [setupHelp, setSetupHelp] = useState<{ detail: string | null; setupHref: string | null }>({ detail: null, setupHref: null });
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const [chatRetryable, setChatRetryable] = useState(false);
  const [retry, setRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const attempted = useRef(false);
  const appliedLink = useRef("");
  const dismissedLink = useRef("");
  const appliedRequest = useRef(0);
  const [requested, setRequested] = useState<{ id: string; serial: number }>();
  const confirm = useConfirm();
  useEffect(() => { if (!conversation && !runLink) dismissedLink.current = ""; }, [conversation, runLink]);
  useEffect(() => {
    if (!origin) return;
    const inFlight = new Set<MessageEventSource>();
    // The desktop webview silently answers window.confirm() with false, so Paseo's archive prompts never appear.
    const bridgeConfirm = isDesktop();
    const answerConfirm = async (source: Window, data: { id?: unknown; message?: unknown }) => {
      if (!Number.isSafeInteger(data.id) || typeof data.message !== "string") return;
      // Paseo's web fallback asks for `${title}\n\n${message}`.
      const [title, ...rest] = data.message.slice(0, 4000).split("\n\n");
      const ok = await confirm({ title: title || "Confirm", message: rest.join("\n\n") || undefined });
      source.postMessage({ type: "devhub:paseo:confirm-result", id: data.id, ok }, origin);
    };
    const onFrameMessage = async (event: MessageEvent) => {
      const source = event.source;
      if (!source || event.origin !== origin || source !== frame.current?.contentWindow) return;
      if (event.data?.type === "devhub:paseo:confirm") { void answerConfirm(source as Window, event.data); return; }
      // The desktop webview blocks window.open() inside the frame, so Paseo sends links here instead.
      if (event.data?.type === "devhub:paseo:open-link") {
        if (typeof event.data.url === "string" && event.data.url.length <= 4096) void openInBrowser(event.data.url);
        return;
      }
      if (event.data?.type !== "devhub:paseo:ready") return;
      if (inFlight.has(source)) return;
      inFlight.add(source);
      try {
        const response = await fetch("/api/agent/connection/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
        if (response.status === 204) { (source as Window).postMessage({ type: "devhub:paseo:skip", bridgeConfirm }, origin); return; }
        const data = await response.json() as { serverId?: string; password?: string; error?: string };
        if (!response.ok || !data.serverId || !data.password) throw new Error(data.error || "Could not prepare the Paseo connection.");
        (source as Window).postMessage({ type: "devhub:paseo:credentials", serverId: data.serverId, password: data.password, bridgeConfirm }, origin);
      } catch (err) {
        (source as Window).postMessage({ type: "devhub:paseo:skip", bridgeConfirm }, origin);
        setChatRetryable(false);
        setChatError(err instanceof Error ? err.message : "Could not prepare the Paseo connection.");
      } finally { inFlight.delete(source); }
    };
    window.addEventListener("message", onFrameMessage);
    return () => window.removeEventListener("message", onFrameMessage);
  }, [origin, confirm]);
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
    setSetupHelp({ detail: null, setupHref: null });
    try {
      const response = await fetch("/api/agent/connection");
      const data = await response.json() as { connected?: boolean; error?: string; origin?: string; detail?: unknown; setupHref?: unknown };
      if (!response.ok || !data.connected || typeof data.origin !== "string") {
        setSetupHelp({
          detail: typeof data.detail === "string" ? data.detail : null,
          setupHref: typeof data.setupHref === "string" ? data.setupHref : null,
        });
        throw new Error(data.error || "Paseo isn't running.");
      }
      const address = new URL(data.origin);
      // Paseo's web UI keeps its login per origin: match the dashboard's loopback
      // name so it's asked for once, the same host /api/paseo/open redirects to.
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

  // Resolve before navigating: a missing chat must never replace Paseo with an API error.
  useEffect(() => {
    if (!active || !origin || !frame.current) return;
    const explicit = requested && appliedRequest.current !== requested.serial;
    const agent = explicit ? requested.id : conversation;
    const query = agent ? `agent=${encodeURIComponent(agent)}` : runLink ? `run=${encodeURIComponent(runLink)}` : "";
    if (!query) return;
    const link = origin + ":" + query;
    if (!explicit && (appliedLink.current === link || dismissedLink.current === link)) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/paseo/open?${query}&format=json`);
        const data = await response.json() as { url?: string; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.url) {
          setChatRetryable(response.status >= 500);
          throw new Error(data.error || "This chat could not be opened.");
        }
        const target = new URL(data.url);
        if (target.origin !== origin) {
          setChatRetryable(false);
          throw new Error("This chat belongs to a different Paseo connection.");
        }
        if (frame.current) {
          frame.current.src = target.href;
          appliedLink.current = link;
          if (explicit) appliedRequest.current = requested.serial;
          setChatError(undefined);
        }
      } catch (err) {
        if (!cancelled) setChatError(err instanceof Error ? err.message : "This chat could not be opened.");
      }
    })();
    return () => { cancelled = true; };
  }, [active, origin, conversation, runLink, requested, retry]);

  if (!active && !origin) return null;
  return (
    <section aria-label="Agents chats" hidden={!active} style={{ position: "absolute", inset: "57px 0 0", display: active ? "flex" : "none", flexDirection: "column", background: "var(--bg)" }}>
      {error && <div className="tone-panel tone-panel--warning m-4" role="alert">
        <p>{error}</p>
        {setupHelp.detail ? <details className="mt-2 text-xs"><summary>Developer detail</summary><p className="mt-1">{setupHelp.detail}</p></details> : null}
        <div className="flex gap-3 mt-3">
          {setupHelp.setupHref ? <Link className="btn btn-primary" href={setupHelp.setupHref}>Go to Setup → Tools</Link> : null}
          <Link className="btn btn-ghost" href="/agents?view=connection">Check Paseo</Link>
          <button className="btn btn-ghost" onClick={() => void connect()} disabled={loading}>Retry</button>
        </div>
      </div>}
      {chatError && <div className="tone-panel tone-panel--warning m-4" role="alert">
        <p>{chatError}</p>
        <div className="flex gap-3 mt-3">
          <button className="btn btn-primary" onClick={() => {
            const query = conversation ? `agent=${encodeURIComponent(conversation)}` : runLink ? `run=${encodeURIComponent(runLink)}` : "";
            if (query) dismissedLink.current = origin + ":" + query;
            setChatError(undefined);
            setRequested(undefined);
            router.replace("/agents");
          }}>Dismiss</button>
          {chatRetryable && <button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Try again</button>}
        </div>
      </div>}
      {!origin && !error && <div className="p-6" aria-label="Loading Agents"><SkeletonRows count={5} variant="list" height={48} /></div>}
      {origin && <iframe ref={frame} src={`${origin}/`} title="Agents — Paseo" className="w-full flex-1 border-0 min-h-0" sandbox={PASEO_FRAME_SANDBOX} allow="clipboard-read; clipboard-write" />}
    </section>
  );
}
