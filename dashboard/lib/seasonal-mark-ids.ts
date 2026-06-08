/** IDs for seasonal marks — map in `lib/seasonal-mark-icon-map.ts`; assets in `lib/seasonal-iconify-subset.json`. */

export const SEASONAL_MARK_IDS = [
  "confettiPop",
  "jackO",
  "giftStack",
  "shamrockBadge",
  "sunbeam",
  "springBlossom",
  "springSprout",
  "springLeaf",
  "springHatchling",
  "springDaisy",
  "summerWave",
  "summerSail",
  "autumnLeaf",
  "winterCrystal",
] as const;

export type SeasonalMarkId = (typeof SEASONAL_MARK_IDS)[number];

export function isSeasonalMarkId(id: string): id is SeasonalMarkId {
  return (SEASONAL_MARK_IDS as readonly string[]).includes(id);
}
