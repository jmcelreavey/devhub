"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Today",
  "/calendar": "Calendar",
  "/work": "Work",
  "/prs": "PRs",
  "/notes": "Notes",
  "/docs": "Docs",
  "/chamber": "Chamber",
  "/status": "Status",
  "/ops": "Ops",
  "/skills": "Skills",
  "/repos": "Repos",
  "/actions": "Actions",
  "/search": "Search",
  "/setup": "Setup",
  "/learnings": "Learnings",
  "/radar": "Radar",
};

export function TabTitle() {
  const pathname = usePathname();

  useEffect(() => {
    let title = "DevHub";
    if (pathname === "/") {
      title = "Today · DevHub";
    } else if (pathname.startsWith("/notes/")) {
      const parts = pathname.replace("/notes/", "").split("/");
      title = parts[parts.length - 1] + " · Notes";
    } else if (pathname.startsWith("/docs/")) {
      const parts = pathname.replace("/docs/", "").split("/");
      title = parts[parts.length - 1] + " · Docs";
    } else {
      const base = "/" + pathname.split("/")[1];
      const label = PAGE_TITLES[base];
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
