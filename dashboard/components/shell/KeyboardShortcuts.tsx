"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function KeyboardShortcuts() {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingG, setPendingG] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "?") {
        e.preventDefault();
        const event = new CustomEvent("shortcuts:toggle");
        window.dispatchEvent(event);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        const event = new CustomEvent("sidebar:toggle");
        window.dispatchEvent(event);
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        if (pendingG) return;
        setPendingG(true);
        setTimeout(() => setPendingG(false), 600);
        return;
      }

      if (pendingG) {
        setPendingG(false);
        const goto: Record<string, string> = {
          h: "/",
          n: "/notes",
          "/": "/search",
          f: "/diagrams",
          s: "/status",
          o: "/ops",
          a: "/actions",
          r: "/repos",
          k: "/skills",
          c: "/chamber",
          l: "/calendar",
          j: "/work?tab=jira",
          d: "/datadog",
          t: "/work?tab=tasks",
          w: "/work",
          p: "/prs",
        };
        const target = goto[e.key];
        if (target && target !== pathname) {
          router.push(target);
        }
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pendingG, pathname, router]);

  return null;
}
