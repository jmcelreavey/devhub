"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, FileText, Search, Menu, ChevronUp, ChevronDown, ListTodo } from "lucide-react";
import { useMobileShelf } from "@/lib/use-mobile-shelf";

const SHELF_EXPANDED_H = 56;
const SHELF_COLLAPSED_H = 24; // WCAG 2.5.8 AA minimum touch target

const TABS = [
  { href: "/",      label: "Today",  Icon: CalendarDays },
  { href: "/notes", label: "Notes",  Icon: FileText },
  { href: "/work",  label: "Work",   Icon: ListTodo },
];

function openPalette() {
  window.dispatchEvent(new CustomEvent("devhub:palette-toggle"));
}

export function MobileBottomShelf() {
  const pathname = usePathname();
  // On /chamber the OpenChamber iframe owns the screen and the mobile top
  // bar already carries the burger + quick actions, so the shelf is pure
  // overhead — drop it and reclaim its height for the iframe.
  const isChamber = pathname === "/chamber";
  const { collapsed, toggle } = useMobileShelf(pathname);

  const shelfH = isChamber ? 0 : collapsed ? SHELF_COLLAPSED_H : SHELF_EXPANDED_H;

  // Expose --shelf-h so PersistentChamber / <main> padding can account for it.
  useEffect(() => {
    document.documentElement.style.setProperty("--shelf-h", `${shelfH}px`);
  }, [shelfH]);

  if (isChamber) return null;

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 overflow-hidden"
      style={{
        height: shelfH,
        background: "var(--bg-sidebar, #0a0d12)",
        borderTop: "1px solid var(--border-muted)",
        transition: "height 200ms ease",
      }}
    >
      {/* Collapse / expand grabber - always visible */}
      <button
        type="button"
        onClick={toggle}
        className="absolute left-1/2 -translate-x-1/2 top-0 flex items-center justify-center"
        style={{ width: 40, height: SHELF_COLLAPSED_H, color: "var(--text-subtle)" }}
        aria-label={collapsed ? "Expand navigation shelf" : "Collapse navigation shelf"}
      >
        {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Tab row - only renders when expanded */}
      {!collapsed && (
        <div className="flex items-stretch h-full pt-[8px]">
          {TABS.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 no-underline transition-colors"
                style={{ color: active ? "var(--accent)" : "var(--text-subtle)" }}
              >
                <Icon size={18} strokeWidth={active ? 2 : 1.6} aria-hidden />
                <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{label}</span>
              </Link>
            );
          })}

          {/* Search pseudo-tab */}
          <button
            type="button"
            onClick={openPalette}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
            style={{ color: "var(--text-subtle)", background: "transparent", border: "none" }}
            aria-label="Search"
          >
            <Search size={18} strokeWidth={1.6} aria-hidden />
            <span style={{ fontSize: 10 }}>Search</span>
          </button>

          {/* More - fires existing mobile nav hamburger */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("devhub:mobile-nav-open"))}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
            style={{ color: "var(--text-subtle)", background: "transparent", border: "none" }}
            aria-label="More"
          >
            <Menu size={18} strokeWidth={1.6} aria-hidden />
            <span style={{ fontSize: 10 }}>More</span>
          </button>
        </div>
      )}
    </div>
  );
}
