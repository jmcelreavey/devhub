/** Rotating tips + family attraction catalogue. */
import type { DevTip } from "./types";

export const DEV_TIPS: DevTip[] = [
  { tag: "git", text: "`git switch -` jumps back to the previous branch — like `cd -` for git." },
  { tag: "git", text: "`git commit --fixup=<sha>` + `git rebase -i --autosquash` folds fixes into the right commit automatically." },
  { tag: "git", text: "`git restore --staged <file>` unstages without touching your working changes." },
  { tag: "git", text: "`git log -S\"someString\"` finds the exact commit that added or removed a string (the 'pickaxe')." },
  { tag: "git", text: "`git worktree add ../hotfix main` checks out a second branch in a sibling folder — no stashing." },
  { tag: "git", text: "`git bisect` binary-searches your history to pinpoint the commit that introduced a bug." },
  { tag: "typescript", text: "`satisfies` validates a value against a type without widening it — you keep the literal inference." },
  { tag: "typescript", text: "Use `as const` on objects/arrays to get readonly literal types instead of widened `string`/`number`." },
  { tag: "typescript", text: "Template literal types let you type things like `` `on${Capitalize<E>}` `` for event-name unions." },
  { tag: "typescript", text: "`Awaited<T>` unwraps nested Promises — handy for typing `ReturnType<typeof asyncFn>`." },
  { tag: "typescript", text: "A discriminated union + exhaustive `switch` with a `never` default catches unhandled cases at compile time." },
  { tag: "javascript", text: "`structuredClone(obj)` deep-clones built-ins (Maps, Dates, typed arrays) — no JSON round-trip needed." },
  { tag: "javascript", text: "`Object.groupBy(items, fn)` groups an array into an object by key, natively." },
  { tag: "javascript", text: "`Array.prototype.at(-1)` reads the last element without `arr[arr.length - 1]`." },
  { tag: "javascript", text: "`Promise.allSettled` waits for every promise and reports each result — failures don't reject the whole batch." },
  { tag: "javascript", text: "Labelled statements let you `break outer;` out of nested loops in one go." },
  { tag: "node", text: "Node 20+ ships a built-in test runner: `node --test`. No dependency required." },
  { tag: "node", text: "`node --watch app.js` restarts on file changes without nodemon." },
  { tag: "node", text: "Set `NODE_OPTIONS=--enable-source-maps` to get original TS line numbers in stack traces." },
  { tag: "shell", text: "`!$` expands to the last argument of the previous command — `mkdir foo && cd !$`." },
  { tag: "shell", text: "`Ctrl-R` reverse-searches your shell history incrementally." },
  { tag: "shell", text: "`cd -` toggles between your two most recent directories." },
  { tag: "shell", text: "`command | tee file.log` shows output and saves it at the same time." },
  { tag: "css", text: "`gap` works in flexbox now, not just grid — drop those margin hacks between children." },
  { tag: "css", text: "`:has()` is a parent selector: `.card:has(img)` styles cards that contain an image." },
  { tag: "css", text: "`clamp(min, preferred, max)` gives fluid type/spacing without media queries." },
  { tag: "web", text: "`<dialog>` gives you a native modal with focus trapping and a backdrop — `showModal()` / `close()`." },
  { tag: "web", text: "`AbortController` cancels fetches: pass `signal` and call `abort()` on cleanup to stop stale requests." },
  { tag: "debug", text: "`console.table(arrayOfObjects)` renders structured data far more readably than `console.log`." },
  { tag: "debug", text: "`console.log({ x, y })` (shorthand) labels each value with its variable name automatically." },
  { tag: "react", text: "A `key` change forces React to remount a component — handy to reset state on route/id change." },
  { tag: "react", text: "Pass a function to `useState(() => expensive())` so the initial value is computed only once." },
];

/** Day-of-year index (1–366), so the tip rotates once per calendar day. */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86_400_000);
}

/** Deterministic per-day pick from DEV_TIPS. */
export function pickDevTip(date: Date, tips: DevTip[] = DEV_TIPS): DevTip | null {
  if (tips.length === 0) return null;
  return tips[dayOfYear(date) % tips.length];
}

// ── Family days out (curated defaults — overridable via briefing prefs) ──────
// Attractions (farm parks, forests, soft play, playgrounds) are evergreen places,
// not dated events, and tourism sites render listings via JavaScript — so a
// curated local list is both more reliable and more useful than scraping.
// Users can override this area via their briefing preferences.

export interface Attraction {
  name: string;
  area: string;
  tag: string;
  /** Optional explicit maps query; defaults to `${name}, ${area}`. */
  query?: string;
}

/** Default attractions near Co. Armagh, NI — the original curated list. */
export const FAMILY_ATTRACTIONS: Attraction[] = [
  { name: "Tannaghmore Gardens & Animal Farm", area: "Craigavon", tag: "Farm" },
  { name: "Gosford Forest Park", area: "Markethill", tag: "Forest" },
  { name: "Peatlands Park", area: "Dungannon", tag: "Park" },
  { name: "Oxford Island, Lough Neagh Discovery Centre", area: "Craigavon", tag: "Nature" },
  { name: "The Palace Demesne Adventure Playground", area: "Armagh", tag: "Playground" },
  { name: "Armagh Planetarium", area: "Armagh", tag: "Science" },
  { name: "Navan Centre & Fort", area: "Armagh", tag: "Heritage" },
  { name: "Lurgan Park", area: "Lurgan", tag: "Park" },
  { name: "Parkanaur Forest Park", area: "Dungannon", tag: "Forest" },
  { name: "Loughgall Country Park", area: "Loughgall", tag: "Park" },
  { name: "Dungannon Park", area: "Dungannon", tag: "Park" },
  { name: "Clare Glen", area: "Tandragee", tag: "Forest walk" },
  { name: "Todds Leap Activity Centre", area: "Ballygawley", tag: "Adventure" },
  { name: "Soft play centres", area: "near Craigavon", tag: "Soft play", query: "soft play near Craigavon" },
  { name: "Soft play centres", area: "near Dungannon", tag: "Soft play", query: "soft play near Dungannon" },
];

export function attractionMapsUrl(a: Attraction, area = "Northern Ireland"): string {
  const q = a.query ?? `${a.name}, ${a.area}, ${area}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
