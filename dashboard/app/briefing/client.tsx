"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wand2, FlaskConical, ExternalLink, Loader2, Share2 } from "lucide-react";
import { BriefingDesignChat } from "@/components/BriefingDesignChat";
import { BriefingResearch } from "@/components/BriefingResearch";
import { readAppTheme, encodeTheme } from "@/lib/briefing-theme";
import { useToast } from "@/lib/use-toast";

// The /briefing page is now a thin shell around a bespoke, AI-authored canvas.
// The canvas (full HTML/CSS/JS) is served same-origin from /api/briefing/canvas
// and embedded in an iframe so its arbitrary CSS/DOM can't touch the app chrome,
// while still having full same-origin access to the dashboard's APIs. You reshape
// it by chatting (design chat); the data refreshes daily on its own.

const CANVAS_URL = "/api/briefing/canvas";

export default function Client() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [designOpen, setDesignOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [nonce, setNonce] = useState(() => Date.now());
  const [withRefresh, setWithRefresh] = useState(false);
  // Derive "loaded" from which nonce last fired onLoad — no effect, no cascading
  // render. A fresh nonce (reload) makes this false until the iframe loads again.
  const [loadedNonce, setLoadedNonce] = useState<number | null>(null);
  const loaded = loadedNonce === nonce;

  // Build the canvas URL with the app's current theme baked in. Read on the
  // client (via the ref below), so the canvas matches the app's dark/light mode
  // and there is no SSR theme-hydration mismatch.
  const buildSrc = useCallback(
    () => `${CANVAS_URL}?theme=${encodeTheme(readAppTheme())}&${withRefresh ? "refresh=1&" : ""}v=${nonce}`,
    [withRefresh, nonce],
  );

  // Ref callback instead of onLoad: the iframe can finish loading before React
  // hydrates and wires up a synthetic onLoad, which leaves the overlay stuck
  // over already-rendered content. Setting src here (client-only) keeps the
  // theme correct; the readyState check catches an already-complete load.
  const attachFrame = useCallback(
    (node: HTMLIFrameElement | null) => {
      if (!node) return;
      node.src = buildSrc();
      const markLoaded = () => setLoadedNonce(nonce);
      node.addEventListener("load", markLoaded, { once: true });
      try {
        const href = node.contentWindow?.location?.href ?? "";
        if (node.contentDocument?.readyState === "complete" && href.includes("/api/briefing/canvas")) {
          markLoaded();
        }
      } catch {
        /* same-origin canvas; ignore */
      }
    },
    [buildSrc, nonce],
  );

  // Reload the iframe because the canvas HTML changed (design edit) — data is unchanged.
  const reloadCanvas = useCallback(() => {
    setWithRefresh(false);
    setNonce(Date.now());
  }, []);

  // Rebuild today's data and reload.
  const refreshData = useCallback(() => {
    setWithRefresh(true);
    setNonce(Date.now());
  }, []);

  // Publish a shareable snapshot (secret gist rendered via gistpreview) and copy the link.
  const share = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch("/api/briefing/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: readAppTheme() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; share?: { viewUrl?: string } };
      if (!res.ok || !json.ok || !json.share?.viewUrl) throw new Error(json.error ?? "Could not publish share");
      const url = json.share.viewUrl;
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Share link copied. Anyone with the link can view it.");
      } catch {
        toastSuccess("Briefing shared");
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not publish share");
    } finally {
      setSharing(false);
    }
  }, [sharing, toastSuccess, toastError]);

  // Keep the canvas matched to the app when the user switches dark/light or preset.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setWithRefresh(false);
      setNonce(Date.now());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-preset"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="briefing-canvas-page">
      <header className="briefing-toolbar">
        <div className="briefing-toolbar-title">
          <span className="briefing-toolbar-dot" aria-hidden />
          <span>Briefing</span>
          <span className="briefing-toolbar-hint">bespoke · auto-refreshes daily</span>
        </div>
        <div className="briefing-toolbar-actions">
          <button type="button" className="btn btn-ghost briefing-toolbar-btn" onClick={() => setResearchOpen(true)}>
            <FlaskConical size={13} aria-hidden /> Research
          </button>
          <button type="button" className="btn btn-ghost briefing-toolbar-btn" onClick={refreshData} disabled={!loaded}>
            <RefreshCw size={13} className={withRefresh && !loaded ? "animate-spin" : ""} aria-hidden /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost briefing-toolbar-btn"
            onClick={() => window.open(buildSrc(), "_blank", "noopener,noreferrer")}
            title="Open the canvas in a new tab"
          >
            <ExternalLink size={13} aria-hidden /> Open
          </button>
          <button
            type="button"
            className="btn btn-ghost briefing-toolbar-btn"
            onClick={() => void share()}
            disabled={sharing}
            title="Publish a shareable link (secret GitHub gist, anyone with the link can view)"
          >
            {sharing ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Share2 size={13} aria-hidden />} Share
          </button>
          <button type="button" className="btn btn-primary briefing-toolbar-btn" onClick={() => setDesignOpen(true)}>
            <Wand2 size={13} aria-hidden /> Design
          </button>
        </div>
      </header>

      <div className="briefing-canvas-frame">
        {!loaded && (
          <div className="briefing-canvas-loading" aria-hidden>
            <Loader2 size={22} className="animate-spin" />
            <span>{withRefresh ? "Refreshing today's data…" : "Loading your briefing…"}</span>
          </div>
        )}
        <iframe
          key={nonce}
          ref={attachFrame}
          title="Bespoke briefing"
          className="briefing-canvas-iframe"
        />
      </div>

      <BriefingDesignChat
        open={designOpen}
        onClose={() => setDesignOpen(false)}
        onCanvasUpdated={reloadCanvas}
        onSideEffects={refreshData}
      />
      <BriefingResearch open={researchOpen} onClose={() => setResearchOpen(false)} />
    </div>
  );
}
