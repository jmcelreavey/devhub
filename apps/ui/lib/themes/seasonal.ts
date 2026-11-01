/**
 * Seasonal / holiday icon picker.
 *
 * Returns seasonal icon candidates and a date-selected seasonal icon.
 * Holiday windows take priority over the broader astronomical season
 * because they're more specific.
 *
 * Northern-hemisphere astronomical seasons (good enough — no need for
 * the actual equinox/solstice times). Holiday windows are a few days
 * either side of the date so the icon shows for a meaningful spell.
 */

export interface SeasonalEntry {
  /**
   * Lucide option label matching `IconPicker` / `ICON_OPTIONS[].label`
   * (e.g. "Tree" for TreePine), used as fallback and for resolveIconName.
   */
  icon: string;
  /** Human-readable label shown in the IconPicker tooltip. */
  label: string;
  /** Optional colorful glyph used for full-icon holiday treatments. */
  emoji?: string;
  /** Optional inline SVG mark (`components/icons/SeasonalMark.tsx`); shown instead of emoji when set. */
  markId?: string;
  /** If true, render the icon as a full colorful glyph instead of brand dot. */
  fullIcon?: boolean;
  /** "holiday" overrides "season" in priority. Used so multi-day holiday
   *  windows shadow the season they fall inside. */
  kind: "holiday" | "season";
}

interface Range {
  start: [number, number]; // [month (1-12), day]
  end: [number, number];   // inclusive
  entries: SeasonalEntry[];
}

const HOLIDAYS: Range[] = [
  // New Year — straddles Dec/Jan; we encode as two ranges below.
  {
    start: [12, 30],
    end: [12, 31],
    entries: [
      { icon: "PartyPopper", label: "New Year", kind: "holiday", emoji: "🎉", fullIcon: true, markId: "confettiPop" },
      { icon: "Sparkles", label: "New Year", kind: "holiday", emoji: "✨", fullIcon: true },
      { icon: "Star", label: "New Year", kind: "holiday", emoji: "🌟", fullIcon: true },
      { icon: "Bell", label: "New Year", kind: "holiday", emoji: "🔔", fullIcon: true },
      { icon: "Gift", label: "New Year", kind: "holiday", emoji: "🎁", fullIcon: true },
    ],
  },
  {
    start: [1, 1],
    end: [1, 2],
    entries: [
      { icon: "PartyPopper", label: "New Year", kind: "holiday", emoji: "🎉", fullIcon: true, markId: "confettiPop" },
      { icon: "Sparkles", label: "New Year", kind: "holiday", emoji: "✨", fullIcon: true },
      { icon: "Star", label: "New Year", kind: "holiday", emoji: "🌟", fullIcon: true },
      { icon: "Bell", label: "New Year", kind: "holiday", emoji: "🔔", fullIcon: true },
      { icon: "Gift", label: "New Year", kind: "holiday", emoji: "🎁", fullIcon: true },
    ],
  },
  {
    start: [2, 13],
    end: [2, 14],
    entries: [
      { icon: "Heart", label: "Valentine's Day", kind: "holiday", emoji: "💘", fullIcon: true },
      { icon: "Heart", label: "Valentine's Day", kind: "holiday", emoji: "❤️", fullIcon: true },
      { icon: "Gift", label: "Valentine's Day", kind: "holiday", emoji: "💝", fullIcon: true },
      { icon: "Flower", label: "Valentine's Day", kind: "holiday", emoji: "🌹", fullIcon: true },
      { icon: "Sparkles", label: "Valentine's Day", kind: "holiday", emoji: "✨", fullIcon: true },
    ],
  },
  {
    start: [3, 17],
    end: [3, 17],
    entries: [
      { icon: "Sprout", label: "St. Patrick's Day", kind: "holiday", emoji: "☘️", fullIcon: true, markId: "shamrockBadge" },
      { icon: "Leaf", label: "St. Patrick's Day", kind: "holiday", emoji: "🍀", fullIcon: true },
      { icon: "Gift", label: "St. Patrick's Day", kind: "holiday", emoji: "🌈", fullIcon: true },
      { icon: "Sparkles", label: "St. Patrick's Day", kind: "holiday", emoji: "✨", fullIcon: true },
      { icon: "Crown", label: "St. Patrick's Day", kind: "holiday", emoji: "💚", fullIcon: true },
    ],
  },
  {
    start: [10, 25],
    end: [11, 1],
    entries: [
      { icon: "Ghost", label: "Halloween", kind: "holiday", emoji: "🎃", fullIcon: true, markId: "jackO" },
      { icon: "Ghost", label: "Halloween", kind: "holiday", emoji: "👻", fullIcon: true },
      { icon: "Moon", label: "Halloween", kind: "holiday", emoji: "🌙", fullIcon: true },
      { icon: "Sparkles", label: "Halloween", kind: "holiday", emoji: "🕸️", fullIcon: true },
      { icon: "Flame", label: "Halloween", kind: "holiday", emoji: "🦇", fullIcon: true },
    ],
  },
  {
    start: [12, 18],
    end: [12, 26],
    entries: [
      { icon: "Gift", label: "Christmas", kind: "holiday", emoji: "🎅", fullIcon: true, markId: "giftStack" },
      { icon: "Gift", label: "Christmas", kind: "holiday", emoji: "🎄", fullIcon: true },
      { icon: "Snowflake", label: "Christmas", kind: "holiday", emoji: "❄️", fullIcon: true },
      { icon: "Bell", label: "Christmas", kind: "holiday", emoji: "🔔", fullIcon: true },
      { icon: "Star", label: "Christmas", kind: "holiday", emoji: "⭐", fullIcon: true },
    ],
  },
];

const SEASONS: Range[] = [
  {
    start: [3, 20],
    end: [6, 20],
    entries: [
      { icon: "Flower", label: "Spring", kind: "season", emoji: "🌸", fullIcon: true, markId: "springBlossom" },
      { icon: "Sprout", label: "Spring", kind: "season", emoji: "🌱", fullIcon: true, markId: "springSprout" },
      { icon: "Leaf", label: "Spring", kind: "season", emoji: "🍃", fullIcon: true, markId: "springLeaf" },
      { icon: "Bird", label: "Spring", kind: "season", emoji: "🐣", fullIcon: true, markId: "springHatchling" },
      { icon: "Sun", label: "Spring", kind: "season", emoji: "🌼", fullIcon: true, markId: "springDaisy" },
    ],
  },
  {
    start: [6, 21],
    end: [9, 22],
    entries: [
      { icon: "Sun", label: "Summer", kind: "season", emoji: "☀️", fullIcon: true, markId: "sunbeam" },
      { icon: "Waves", label: "Summer", kind: "season", emoji: "🌊", fullIcon: true, markId: "summerWave" },
      { icon: "Sailboat", label: "Summer", kind: "season", emoji: "⛵", fullIcon: true, markId: "summerSail" },
      { icon: "Flower", label: "Summer", kind: "season", emoji: "🌻", fullIcon: true },
      { icon: "Tree", label: "Summer", kind: "season", emoji: "🏖️", fullIcon: true },
    ],
  },
  {
    start: [9, 23],
    end: [12, 20],
    entries: [
      { icon: "Leaf", label: "Autumn", kind: "season", emoji: "🍂", fullIcon: true, markId: "autumnLeaf" },
      { icon: "Tree", label: "Autumn", kind: "season", emoji: "🌾", fullIcon: true },
      { icon: "Cloud", label: "Autumn", kind: "season", emoji: "🌥️", fullIcon: true },
      { icon: "Flame", label: "Autumn", kind: "season", emoji: "🔥", fullIcon: true },
      { icon: "Ghost", label: "Autumn", kind: "season", emoji: "🎃", fullIcon: true },
    ],
  },
  // Winter wraps around the year — encoded as two ranges.
  {
    start: [12, 21],
    end: [12, 31],
    entries: [
      { icon: "Snowflake", label: "Winter", kind: "season", emoji: "❄️", fullIcon: true, markId: "winterCrystal" },
      { icon: "Cloud", label: "Winter", kind: "season", emoji: "☁️", fullIcon: true },
      { icon: "Mountain", label: "Winter", kind: "season", emoji: "🏔️", fullIcon: true },
      { icon: "Gift", label: "Winter", kind: "season", emoji: "🧣", fullIcon: true },
      { icon: "Moon", label: "Winter", kind: "season", emoji: "🌌", fullIcon: true },
    ],
  },
  {
    start: [1, 1],
    end: [3, 19],
    entries: [
      { icon: "Snowflake", label: "Winter", kind: "season", emoji: "❄️", fullIcon: true, markId: "winterCrystal" },
      { icon: "Cloud", label: "Winter", kind: "season", emoji: "☁️", fullIcon: true },
      { icon: "Mountain", label: "Winter", kind: "season", emoji: "🏔️", fullIcon: true },
      { icon: "Gift", label: "Winter", kind: "season", emoji: "🧣", fullIcon: true },
      { icon: "Moon", label: "Winter", kind: "season", emoji: "🌌", fullIcon: true },
    ],
  },
];

function inRange(date: Date, r: Range): boolean {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (r.start[0] === r.end[0]) {
    return m === r.start[0] && d >= r.start[1] && d <= r.end[1];
  }
  if (m === r.start[0] && d >= r.start[1]) return true;
  if (m === r.end[0] && d <= r.end[1]) return true;
  if (m > r.start[0] && m < r.end[0]) return true;
  return false;
}

function getRangeForDate(date: Date = new Date()): Range | null {
  for (const r of HOLIDAYS) if (inRange(date, r)) return r;
  for (const r of SEASONS) if (inRange(date, r)) return r;
  return null;
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function getDateSeed(date: Date): number {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Seasonal candidates for the active date window only. */
export function getCurrentSeasonalEntries(date: Date = new Date()): SeasonalEntry[] {
  return getRangeForDate(date)?.entries ?? [];
}

/** Picks one entry from the active seasonal window based on date. */
export function getSeasonalEntry(date: Date = new Date()): SeasonalEntry | null {
  const options = getCurrentSeasonalEntries(date);
  if (options.length === 0) return null;
  // Stable "daily random": changes once per day, constant throughout that day.
  const idx = (getDateSeed(date) + getDayOfYear(date)) % options.length;
  return options[idx] ?? options[0];
}
