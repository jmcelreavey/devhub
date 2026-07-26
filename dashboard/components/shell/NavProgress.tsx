"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top-of-page bar that crawls to ~70% on link click and snaps to 100%
 * when the pathname changes, then fades out. Pure CSS transitions — no
 * external dep, no JS animation loop.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const prevPath = useRef(pathname);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    setPhase("done");
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setPhase("idle"), 320);
  }, [pathname]);

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
      if (a.target === "_blank") return;
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (href === pathname) return;
      setPhase("loading");
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [pathname]);

  return <div className={`nav-progress nav-progress-${phase}`} aria-hidden />;
}
