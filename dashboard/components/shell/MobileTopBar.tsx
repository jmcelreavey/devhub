"use client";

import Image from "next/image";
import { Search } from "lucide-react";
import { BRAND_BOTTLE_IMAGE_SRC, BRAND_LABEL } from "@/lib/brand-mark";
import { useRuntimeBrand } from "./RuntimeBrandProvider";
import { MobileNav } from "@/components/shell/MobileNav";
import { MobileQuickActionsMenu } from "@/components/shell/MobileQuickActionsMenu";
import { ContentSyncIndicator } from "@/components/runs/ContentSyncIndicator";

/**
 * Mobile-only chrome: hamburger nav + brand + search + a single overflow
 * menu holding the Notes/Tasks/Diagrams panels and the terminal toggle
 * (kept off the bar itself to avoid crowding a phone-width row).
 */
export function MobileTopBar() {
  const { brand } = useRuntimeBrand();
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
            src={brand?.logo || BRAND_BOTTLE_IMAGE_SRC}
            alt=""
            className={brand?.logo ? "mobile-brand-logo-img theme-brand-image" : "mobile-brand-logo-img theme-brand-image devhub-mark"}
            unoptimized
            width={34}
            height={34}
          />
        </span>
        {(brand?.label || BRAND_LABEL) && (
          <span className="font-semibold text-sm truncate text-text">
            {brand?.label || BRAND_LABEL}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ContentSyncIndicator />
        <button
          type="button"
          className="hub-icon-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("devhub:palette-toggle"))}
          aria-label="Search — tap a result to open, hold or use New tab to open in a workspace tab"
        >
          <Search size={15} aria-hidden />
        </button>
        <MobileQuickActionsMenu />
      </div>
    </header>
  );
}
