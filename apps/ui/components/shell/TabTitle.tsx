"use client";

import { useWorkspaceTabs } from "./WorkspaceTabs";
import { usePluginNav } from "@/lib/hooks/use-plugin-nav";
import { navDestinationFor } from "../../../../packages/shared/ui-lib/navigation/nav";
import { usePathname, useSearchParams } from "@/lib/navigation";
import { useEffect } from "react";

export function TabTitle() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { items } = usePluginNav();
  const { publishLabel, tabs, activeId } = useWorkspaceTabs();
  const active = tabs.find(tab => tab.id === activeId);
  const href = `${pathname}?${search}`;
  const destination = navDestinationFor(href, items);
  const pluginLabel = destination?.href.startsWith("/plugins/runtime/") ? destination.label : undefined;

  useEffect(() => {
    if (pluginLabel && active?.href === href && active.title !== pluginLabel) publishLabel(href, pluginLabel);
  }, [href, pluginLabel, publishLabel, active?.href, active?.title]);

  useEffect(() => {
    let title = "DevHub";
    if (pathname.startsWith("/notes/")) {
      const parts = pathname.replace("/notes/", "").split("/");
      title = parts[parts.length - 1] + " · Notes";
    } else if (pathname.startsWith("/docs/")) {
      const parts = pathname.replace("/docs/", "").split("/");
      title = parts[parts.length - 1] + " · Docs";
    } else {
      // Named by the nav registry, like the sidebar and the workspace tabs, so a
      // rename can't leave the browser tab behind.
      const label = navDestinationFor(`${pathname}?${search}`, items)?.label;
      if (label) title = label + " · DevHub";
    }
    document.title = title;
  }, [pathname, search, items, active?.href, active?.title]);

  return null;
}

export function useTabSaveStatus() {
  return {
    setSaving: () => { document.title = "● " + document.title.replace(/^[●✓] /, ""); },
    setSaved: () => {
      document.title = document.title.replace(/^[●] /, "✓ ");
      setTimeout(() => {
        document.title = document.title.replace(/^[✓] /, "");
      }, 2500);
    },
    clear: () => { document.title = document.title.replace(/^[●✓] /, ""); },
  };
}
