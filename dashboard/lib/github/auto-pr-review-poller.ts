/**
 * Weekday daytime poller for auto agent-review.
 *
 * Interval always registers at dashboard boot so GUI / MCP can toggle without
 * restart. Each tick re-reads prefs (`notes/.config/auto-pr-review.json`) —
 * or env before the first prefs write — and no-ops unless `enabled`.
 *
 * When enabled, runs during weekdays (Mon–Fri) between
 * DEVHUB_AUTO_PR_REVIEW_START_HOUR (default 9) and
 * DEVHUB_AUTO_PR_REVIEW_END_HOUR (default 18) in DEVHUB_AUTO_PR_REVIEW_TZ
 * (default Europe/London), every DEVHUB_AUTO_PR_REVIEW_INTERVAL_MS (default 15m),
 * unless `always` / DEVHUB_AUTO_PR_REVIEW_ALWAYS skips the weekday window.
 *
 * Calls the same `runAutoPrReview` path as POST /api/github/prs/auto-review —
 * never posts GitHub review comments. Prefer the HTTP endpoint for Grok/cron;
 * this poller is the in-process option when the dashboard stays up.
 */
import { isGithubCliAuthenticated } from "@/lib/gh-exec";
import { reviewNoteActivityByPath } from "@/lib/notes/review-index-server";
import { autoReviewConcurrency, loadAutoReviewQueue, runAutoPrReview } from "@/lib/github/auto-pr-review";
import { readAutoPrReviewPrefs } from "@/lib/github/auto-pr-review-prefs";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
/** Last enabled state we logged, so toggles via GUI/MCP are visible in logs. */
let lastLoggedEnabled: boolean | null = null;

function envInt(key: string, fallback: number): number {
  const n = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function autoPrReviewIntervalMs(): number {
  return Math.max(60_000, envInt("DEVHUB_AUTO_PR_REVIEW_INTERVAL_MS", DEFAULT_INTERVAL_MS));
}

/** True when local time in `timeZone` is a weekday within [startHour, endHour). */
export function isWeekdayDaytime(
  now: Date = new Date(),
  opts: { timeZone?: string; startHour?: number; endHour?: number } = {},
): boolean {
  const timeZone = opts.timeZone ?? (process.env.DEVHUB_AUTO_PR_REVIEW_TZ?.trim() || "Europe/London");
  const startHour = opts.startHour ?? envInt("DEVHUB_AUTO_PR_REVIEW_START_HOUR", 9);
  const endHour = opts.endHour ?? envInt("DEVHUB_AUTO_PR_REVIEW_END_HOUR", 18);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number.parseInt(hourRaw, 10);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (!Number.isFinite(hour)) return false;
  return hour >= startHour && hour < endHour;
}

async function tick(): Promise<void> {
  if (inFlight) return;

  const prefs = readAutoPrReviewPrefs();
  if (lastLoggedEnabled !== prefs.enabled) {
    console.info(
      `[auto-pr-review] poller ${prefs.enabled ? "enabled" : "disabled"}` +
        ` (source=${prefs.source}${prefs.always ? ", always" : ", weekday daytime"})`,
    );
    lastLoggedEnabled = prefs.enabled;
  }
  if (!prefs.enabled) return;
  if (!prefs.always && !isWeekdayDaytime()) return;
  if (!(await isGithubCliAuthenticated())) return;

  inFlight = true;
  try {
    const result = await runAutoPrReview({
      ...(await loadAutoReviewQueue()),
      noteActivityByPath: reviewNoteActivityByPath(),
      dryRun: false,
      concurrency: autoReviewConcurrency(),
    });
    if (result.started.length || result.errors.length) {
      console.info(
        "[auto-pr-review]",
        `started=${result.started.length}`,
        `skipped=${result.skipped.length}`,
        `errors=${result.errors.length}`,
      );
    }
  } catch (err) {
    console.error("[auto-pr-review] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

/**
 * Register the in-process poller interval. Always starts (unref'd) so GUI/MCP
 * can enable without a dashboard restart; ticks no-op while disabled.
 * Safe to call once.
 */
export function startAutoPrReviewPoller(): void {
  if (started) return;
  started = true;
  const intervalMs = autoPrReviewIntervalMs();
  const prefs = readAutoPrReviewPrefs();
  console.info(
    `[auto-pr-review] poller registered (every ${Math.round(intervalMs / 60000)}m);` +
      ` currently ${prefs.enabled ? "enabled" : "disabled"} via ${prefs.source}` +
      (prefs.always ? " (always)" : ""),
  );
  lastLoggedEnabled = prefs.enabled;
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
}

/** Run one tick soon (e.g. after prefs save) without waiting for the interval. */
export function kickAutoPrReviewPoller(): void {
  void tick();
}

/** Test seam. */
export function stopAutoPrReviewPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  inFlight = false;
  lastLoggedEnabled = null;
}
