"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import {
  ContextMenu,
  type ContextMenuGroup,
  type ContextMenuPosition,
} from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isDesktop, openInBrowser } from "@/lib/desktop/bridge";

/** Absolute http(s) href pointing outside the dashboard origin, else null. */
export function externalHref(target: EventTarget | null): string | null {
  const anchor = (target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return null;
  try {
    const url = new URL(anchor.href);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin) {
      return url.href;
    }
  } catch {
    // Relative or unparseable href — treat as internal.
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * In the packaged desktop app the webview has no working "open in new
 * window/tab" story and Tauri blocks external navigation, so plain
 * `<a target="_blank">` links and the native right-click "Open Link" item are
 * dead ends. Intercept external anchors globally: left/middle/cmd-click opens
 * them in the system browser, right-click shows our own two-item menu.
 * No-op in a regular browser where native behaviour already works.
 */
export function ExternalLinks() {
  const [menu, setMenu] = useState<{ url: string; position: ContextMenuPosition } | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;

    const activate = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.type === "auxclick" && event.button !== 1) return;
      const url = externalHref(event.target);
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      void openInBrowser(url);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      // Row hosts (PrRow, tasks, …) own right-click — don't steal their menu.
      const hit = event.target;
      if (hit instanceof Element && hit.closest("[data-context-menu-host]")) return;
      const url = externalHref(event.target);
      if (!url) return;
      event.preventDefault();
      setMenu({ url, position: { x: event.clientX, y: event.clientY } });
    };

    document.addEventListener("click", activate, true);
    document.addEventListener("auxclick", activate, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      document.removeEventListener("click", activate, true);
      document.removeEventListener("auxclick", activate, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  const groups: ContextMenuGroup[] = menu
    ? [
        {
          id: "external-link",
          items: [
            {
              id: "open",
              label: "Open in browser",
              description: hostOf(menu.url),
              icon: <ExternalLink size={12} aria-hidden />,
              onSelect: () => void openInBrowser(menu.url),
            },
            {
              id: "copy",
              label: "Copy link address",
              icon: <Copy size={12} aria-hidden />,
              onSelect: async () => {
                await copyTextToClipboard(menu.url);
              },
            },
          ],
        },
      ]
    : [];

  return (
    <ContextMenu
      open={menu !== null}
      position={menu?.position ?? null}
      groups={groups}
      label="External link"
      onClose={() => setMenu(null)}
    />
  );
}
