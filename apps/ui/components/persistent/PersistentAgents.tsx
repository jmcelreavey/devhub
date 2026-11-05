"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/lib/navigation";
import { ExternalLink, RotateCw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { SidePanel, SidePanelControls } from "@/components/shell/SidePanel";
import { HoverTip } from "@/components/ui/HoverTip";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";
import { AGENT_CONVERSATION_EVENT } from "@/lib/agent-handoff";
import { isDesktop, openInBrowser } from "@/lib/desktop/bridge";
import { requestErrorMessage } from "@/lib/request-error";
import { setPaseoBackground, usePaseoChrome } from "@/lib/paseo/appearance";
import { resolvePaseoLink } from "@/lib/paseo/link";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";

/**
 * Paseo syncs its stack with history.go() inside the Send gesture. That call
 * shares the window's session history, so it can step DevHub back to the
 * previous page. The sandbox blocks ancestor navigation (including
 * user-activated history traversals) and leaves the frame's own history alone.
 */
const PASEO_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";

/** This frame has no activity subscriptions: only local navigation can select a chat. */
export function PersistentAgents({ sideRun }: { sideRun?: { id: string; conversationId?: string } } = {}) {
  const router = useRouter();
  const { openHref } = useWorkspaceTabs();
  const chrome = usePaseoChrome();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const desktopKeyboard = (sidebarOpen || Boolean(sideRun)) && !isMobile;
  const desktopKeyboardRef = useRef(desktopKeyboard);
  const fullPage = pathname === "/agents" && params.get("view") !== "connection" && params.get("view") !== "usage";
  const active = Boolean(sideRun) || sidebarOpen || fullPage;
  const conversation = sideRun?.conversationId ?? (!sideRun && fullPage ? params.get("conversation") : null);
  const runLink = sideRun?.id ?? (fullPage ? params.get("run") : null);
  const [origin, setOrigin] = useState<string>();
  const [error, setError] = useState<string>();
  const [setupHelp, setSetupHelp] = useState<{ detail: string | null; setupHref: string | null }>({ detail: null, setupHref: null });
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const [chatRetryable, setChatRetryable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [resolvedUrl, setResolvedUrl] = useState<string>();
  const frame = useRef<HTMLIFrameElement>(null);
  const attempted = useRef(false);
  const appliedLink = useRef("");
  const dismissedLink = useRef("");
  const appliedRequest = useRef(0);
  const [requested, setRequested] = useState<{ id: string; serial: number }>();
  const [startingLabel, setStartingLabel] = useState<string>();
  const pendingSince = useRef(0);
  const pendingQuery = useRef("");
  const confirm = useConfirm();
  useEffect(() => {
    if (sideRun) return;
    const toggle = () => setSidebarOpen(value => !value);
    const close = () => setSidebarOpen(false);
    const events = ["devhub:notes-toggle", "devhub:notes-open-today", "devhub:notes-open-path", "devhub:tasks-toggle", "devhub:diagrams-toggle"];
    window.addEventListener("devhub:agents-toggle", toggle);
    for (const event of events) window.addEventListener(event, close);
    return () => {
      window.removeEventListener("devhub:agents-toggle", toggle);
      for (const event of events) window.removeEventListener(event, close);
    };
  }, [sideRun]);
  useEffect(() => {
    if (sideRun) return;
    window.dispatchEvent(new CustomEvent("devhub:agents-sidebar", { detail: sidebarOpen }));
  }, [sidebarOpen, sideRun]);
  useEffect(() => { setSidebarOpen(false); }, [pathname]);
  useEffect(() => {
    desktopKeyboardRef.current = desktopKeyboard;
    if (origin) frame.current?.contentWindow?.postMessage({ type: "devhub:paseo:keyboard", desktopKeyboard }, origin);
  }, [desktopKeyboard, origin]);
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
      if (event.data?.type === "devhub:paseo:appearance") { if (!sideRun) setPaseoBackground(event.data.background); return; }
      if (event.data?.type === "devhub:paseo:location") {
        try { const target = new URL(event.data.url); if (target.origin === origin) setResolvedUrl(target.href); } catch { /* Ignore malformed frame messages. */ }
        return;
      }
      if (event.data?.type === "devhub:paseo:confirm") { void answerConfirm(source as Window, event.data); return; }
      // The desktop webview blocks window.open() inside the frame, so Paseo sends links here instead.
      if (event.data?.type === "devhub:paseo:open-link") {
        const link = resolvePaseoLink(event.data.url, window.location.origin);
        if (link?.kind === "internal") openHref(link.href, { newTab: true });
        else if (link) void openInBrowser(link.href);
        return;
      }
      if (event.data?.type !== "devhub:paseo:ready") return;
      if (inFlight.has(source)) return;
      inFlight.add(source);
      try {
        const response = await fetch("/api/agent/connection/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (response.status === 204) { (source as Window).postMessage({ type: "devhub:paseo:skip", bridgeConfirm, desktopKeyboard: desktopKeyboardRef.current }, origin); return; }
        const data = await response.json() as { serverId?: string; password?: string; error?: string };
        if (!response.ok || !data.serverId || !data.password) throw new Error(data.error || "Could not prepare the Paseo connection.");
        (source as Window).postMessage({ type: "devhub:paseo:credentials", serverId: data.serverId, password: data.password, bridgeConfirm, desktopKeyboard: desktopKeyboardRef.current }, origin);
      } catch (err) {
        (source as Window).postMessage({ type: "devhub:paseo:skip", bridgeConfirm, desktopKeyboard: desktopKeyboardRef.current }, origin);
        setChatRetryable(false);
        setChatError(requestErrorMessage(err, "Could not prepare the Paseo connection."));
      } finally { inFlight.delete(source); }
    };
    window.addEventListener("message", onFrameMessage);
    return () => window.removeEventListener("message", onFrameMessage);
  }, [origin, confirm, sideRun, openHref]);
  useEffect(() => {
    const open = (event: Event) => {
      if (sideRun) return;
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === "string" && id) setRequested(previous => ({ id, serial: (previous?.serial ?? 0) + 1 }));
    };
    window.addEventListener(AGENT_CONVERSATION_EVENT, open);
    return () => window.removeEventListener(AGENT_CONVERSATION_EVENT, open);
  }, [sideRun]);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setSetupHelp({ detail: null, setupHref: null });
    try {
      const response = await fetch("/api/agent/connection", { signal: AbortSignal.timeout(15_000) });
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
    } catch (err) { setError(requestErrorMessage(err, "Could not connect to Agents.")); }
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
    let timer: number | undefined;
    if (pendingQuery.current !== query) {
      pendingQuery.current = query;
      pendingSince.current = 0;
    }
    void (async () => {
      let retryable = true;
      try {
        const response = await fetch(`/api/paseo/open?${query}&format=json`, { signal: AbortSignal.timeout(15_000) });
        const data = await response.json() as { url?: string; error?: string; starting?: boolean };
        if (cancelled) return;
        if (response.status === 404 && data.starting) {
          if (!pendingSince.current) pendingSince.current = Date.now();
          if (Date.now() - pendingSince.current > 120_000) {
            pendingSince.current = 0;
            setStartingLabel(undefined);
            setChatRetryable(true);
            throw new Error(data.error || "The agent is still starting. Check Activity, then try again.");
          }
          setChatError(undefined);
          setStartingLabel(data.error || "Starting the agent…");
          timer = window.setTimeout(() => { if (!cancelled) setRetry((value) => value + 1); }, 400);
          return;
        }
        pendingSince.current = 0;
        setStartingLabel(undefined);
        if (!response.ok || !data.url) {
          retryable = response.status >= 500;
          setChatRetryable(retryable);
          throw new Error(data.error || "This chat could not be opened.");
        }
        const target = new URL(data.url);
        if (target.origin !== origin) {
          retryable = false;
          setChatRetryable(false);
          throw new Error("This chat belongs to a different Paseo connection.");
        }
        if (frame.current) {
          frame.current.src = target.href;
          setResolvedUrl(target.href);
          appliedLink.current = link;
          if (explicit) appliedRequest.current = requested.serial;
          setChatError(undefined);
        }
      } catch (err) {
        if (!cancelled) { setChatRetryable(retryable); setChatError(requestErrorMessage(err, "This chat could not be opened.")); }
      }
    })();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [active, origin, conversation, runLink, requested, retry]);

  if (!active && !origin) return null;
  return (
    <SidePanel open={active} onClose={() => setSidebarOpen(false)} storageKey="chat-panel-width" defaultWidth={480} ariaLabel="Agents chats" mode={sidebarOpen ? "panel" : "inline"} keepMounted inlineStyle={{ position: "absolute", inset: sideRun ? "0" : "40px 0 0", background: "var(--bg)" }} style={chrome}>
      {(origin || sidebarOpen) && <div data-panel-drag-handle className={`flex shrink-0 items-center justify-end gap-2 px-3 text-xs ${sideRun || sidebarOpen ? "border-b border-border bg-bg-surface h-12" : "absolute right-0 -top-10 h-10 z-10"}`}>
        {sidebarOpen && <span className="mr-auto font-medium">Chat</span>}
        {origin && <HoverTip label="Open in Paseo"><button type="button" className="hub-icon-btn relative" aria-label="Open in Paseo" onClick={() => void openInBrowser(resolvedUrl ?? origin)}><span aria-hidden className="block h-5 w-5 bg-current" style={{ mask: "url(/icons/paseo.svg) center / contain no-repeat" }} /><ExternalLink size={9} aria-hidden className="absolute -right-0.5 -top-0.5" /></button></HoverTip>}
        {sidebarOpen && <>
          <button className="hub-icon-btn" aria-label="Open chat in full page" title="Open in full page" onClick={() => { setSidebarOpen(false); router.push("/agents"); }}><ExternalLink size={14} /></button>
          <SidePanelControls closeLabel="Close chat panel" />
        </>}
      </div>}
      {startingLabel && active ? <p className="px-4 py-2 text-xs text-text-muted" role="status">{startingLabel}</p> : null}
      {error && <div className="tone-panel tone-panel--warning m-4" role="alert">
        <p>{error}</p>
        {setupHelp.detail ? <details className="mt-2 text-xs"><summary>Developer detail</summary><p className="mt-1">{setupHelp.detail}</p></details> : null}
        <div className="flex gap-3 mt-3">
          {setupHelp.setupHref ? <Link className="btn btn-primary" href={setupHelp.setupHref}>Go to Setup → Tools</Link> : null}
          <Link className="btn btn-ghost" href="/agents?view=connection">Check Paseo</Link>
          <button className="btn btn-ghost" onClick={() => void connect()} disabled={loading}>Retry</button>
        </div>
      </div>}
      {chatError && <div className="tone-panel tone-panel--warning flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs" role="alert">
        <p className="flex-1 min-w-48">{chatError}</p>
        <div className="flex items-center gap-2">
          {chatRetryable && <button className="btn btn-ghost gap-1" onClick={() => setRetry(value => value + 1)}><RotateCw size={12} />Try again</button>}
          <Link className="btn btn-ghost" href="/agents?view=connection">Check connection</Link>
          <button className="btn btn-ghost" aria-label="Dismiss chat error" onClick={() => {
            const query = conversation ? `agent=${encodeURIComponent(conversation)}` : runLink ? `run=${encodeURIComponent(runLink)}` : "";
            if (query) dismissedLink.current = origin + ":" + query;
            setChatError(undefined);
            setRequested(undefined);
            if (!sideRun) router.replace("/agents");
          }}><X size={14} /></button>
        </div>
      </div>}
      {!origin && !error && <div className="p-6" aria-label="Loading Agents"><SkeletonRows count={5} variant="list" height={48} /></div>}
      {origin && <iframe ref={frame} src={`${origin}/`} title="Agents — Paseo" className="w-full flex-1 border-0 min-h-0" sandbox={PASEO_FRAME_SANDBOX} allow="clipboard-read; clipboard-write" />}
    </SidePanel>
  );
}
