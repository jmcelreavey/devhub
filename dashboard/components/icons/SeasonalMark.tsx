"use client";

/**
 * Seasonal marks: Microsoft **Fluent Emoji Flat** via Iconify (~17KB bundled subset).
 * Confined to brand mark + IconPicker seasonal row — chrome UI stays Lucide.
 * Regenerate JSON with `npx tsx scripts/build-seasonal-iconify-subset.ts`.
 */

import { Icon, addCollection } from "@iconify/react";
import type { IconifyJSON } from "@iconify/types";
import seasonalSubset from "@/lib/seasonal-iconify-subset.json";
import { SEASONAL_MARK_ICONIFY } from "@/lib/seasonal-mark-icon-map";
import { isSeasonalMarkId } from "@/lib/seasonal-mark-ids";

let collectionRegistered = false;

function ensureSeasonalCollection(): void {
  if (collectionRegistered) return;
  addCollection(seasonalSubset as IconifyJSON);
  collectionRegistered = true;
}

interface SeasonalMarkProps {
  id: string;
  size: number;
  className?: string;
}

export function SeasonalMark({ id, size, className }: SeasonalMarkProps) {
  ensureSeasonalCollection();
  if (!isSeasonalMarkId(id)) return null;
  const icon = SEASONAL_MARK_ICONIFY[id];

  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ display: "block", verticalAlign: "middle" }}
    />
  );
}
