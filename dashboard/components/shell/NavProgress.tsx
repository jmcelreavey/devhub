"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isDesktop, logDesktopEvent, openInBrowser } from "@/lib/desktop/bridge";

/**
 * Thin top-of-page bar that crawls to ~70% on link click and snaps to 100%
 * when the pathname or query changes, then fades out. Pure CSS transitions — no
 * external dep, no JS animation loop.
 */
export function NavProgress() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const route = query ? `${pathname}?${query}` : pathname;
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const prevRoute = useRef(route);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevRoute.current === route) return;
    prevRoute.current = route;
    setPhase("done");
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setPhase("idle"), 320);
  }, [route]);

  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      const destination = new URL(a.href);
      const opensExternally =
        a.target === "_blank" ||
        ((destination.protocol === "http:" || destination.protocol === "https:") &&
          destination.origin !== window.location.origin);
      if (opensExternally && isDesktop()) {
        e.preventDefault();
        void logDesktopEvent(
          "nav:external-intercept",
          "Intercepted external navigation for system browser",
          destination.host,
        );
        void openInBrowser(destination.toString());
        return;
      }
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      const destinationQuery = destination.searchParams.toString();
      const destinationRoute = destinationQuery ? `${destination.pathname}?${destinationQuery}` : destination.pathname;
      if (destinationRoute === route) return;
      setPhase("loading");
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [route]);

  return <div className={`nav-progress nav-progress-${phase}`} aria-hidden />;
}
