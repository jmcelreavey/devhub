"use client";

import { navDestinationFor } from "@/lib/nav";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function TabTitle() {
  const pathname = usePathname();

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
      const label = navDestinationFor(pathname)?.label;
      if (label) title = label + " · DevHub";
    }
    document.title = title;
  }, [pathname]);

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
