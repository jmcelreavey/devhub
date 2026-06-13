"use client";

import Image from "next/image";
import { Search } from "lucide-react";
import { BRAND_BOTTLE_IMAGE_SRC } from "@/lib/brand-mark";
import { MobileNav } from "@/components/MobileNav";
import { NotesBrowseButton } from "@/components/NotesBrowseButton";
import { TasksBrowseButton } from "@/components/TasksBrowseButton";
import { DiagramsBrowseButton } from "@/components/DiagramsBrowseButton";
import { ContentSyncIndicator } from "@/components/ContentSyncIndicator";

/**
 * Mobile-only chrome: hamburger nav + brand + the Notes/Tasks/Diagrams
 * quick-action side panels.
 *
 * Kept on every route including /chamber — the burger covers navigation
 * and the quick-action panels are the only way to reach Notes/Tasks/
 * Diagrams from inside the OpenChamber iframe. On /chamber the bottom
 * shelf is dropped instead (see MobileBottomShelf) so the iframe still
 * gets maximum height with no redundant chrome.
 */
export function MobileTopBar() {
  return (
    <header
      className="md:hidden flex items-center gap-3 px-4 py-3"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <MobileNav />
      <div className="flex items-center gap-1.5 min-w-0">
        <span aria-hidden className="mobile-brand-logo">
          <Image
            src={BRAND_BOTTLE_IMAGE_SRC}
            alt=""
            className="mobile-brand-logo-img"
            unoptimized
            width={34}
            height={34}
          />
        </span>
        <span className="font-semibold text-sm truncate" style={{ color: "var(--text)" }}>
          DevHub
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ContentSyncIndicator />
        <button
          type="button"
          className="hub-icon-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("devhub:palette-toggle"))}
          aria-label="Search"
        >
          <Search size={15} aria-hidden />
        </button>
        <NotesBrowseButton />
        <TasksBrowseButton />
        <DiagramsBrowseButton />
      </div>
    </header>
  );
}
