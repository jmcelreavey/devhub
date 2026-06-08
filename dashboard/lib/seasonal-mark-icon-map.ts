import type { SeasonalMarkId } from "./seasonal-mark-ids";

/**
 * Microsoft Fluent Emoji Flat (via Iconify). Slugs must exist in `seasonal-iconify-subset.json`
 * — regenerate with `npx tsx scripts/build-seasonal-iconify-subset.ts` after editing.
 */
export const SEASONAL_MARK_ICONIFY: Record<SeasonalMarkId, `fluent-emoji-flat:${string}`> = {
  confettiPop: "fluent-emoji-flat:party-popper",
  jackO: "fluent-emoji-flat:jack-o-lantern",
  giftStack: "fluent-emoji-flat:wrapped-gift",
  shamrockBadge: "fluent-emoji-flat:shamrock",
  sunbeam: "fluent-emoji-flat:sun-with-face",
  springBlossom: "fluent-emoji-flat:cherry-blossom",
  springSprout: "fluent-emoji-flat:seedling",
  springLeaf: "fluent-emoji-flat:leaf-fluttering-in-wind",
  springHatchling: "fluent-emoji-flat:hatching-chick",
  springDaisy: "fluent-emoji-flat:blossom",
  summerWave: "fluent-emoji-flat:water-wave",
  summerSail: "fluent-emoji-flat:sailboat",
  autumnLeaf: "fluent-emoji-flat:maple-leaf",
  winterCrystal: "fluent-emoji-flat:snowflake",
};
