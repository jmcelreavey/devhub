import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ServiceSurfaceReadRequest } from "../../../../../packages/shared/plugin-runtime";
import { CALENDAR_WEEK_TTL_MS, getWeekCalendarCache, setWeekCalendarCache } from "../../domains/calendar/cache";
import { getWeekEvents, isGoogleCalendarAuthError, isGoogleCalendarConfigured, type CalendarEvent } from "../google-calendar";
import { loadGithubPrsList } from "../github/prs-list";
import { loadOwnedPrs } from "../github/owned-prs-load";
import { listOwnedRepos } from "../ownership/owned-repos";
import { profileStateDir } from "../../../../../packages/shared/storage/profile-state";
import { assertSafePath } from "./filesystem";

const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const destination = z.object({
  provider: z.string(), enabled: z.boolean(), workProfile: z.string(),
  quiet: z.object({ start: time, end: time, timeZone: z.string() }).optional(),
});

function quietHours(request: Extract<ServiceSurfaceReadRequest, { operation: "quiet-hours" }>): boolean {
  const configured = profileStateDir();
  const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
  const file = path.join(root, "workflow-alerts", "state.json");
  assertSafePath(root, file);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  const { destinations } = z.object({ destinations: z.array(z.unknown()) }).parse(raw);
  return destinations.some((value) => {
    const parsed = destination.safeParse(value);
    if (!parsed.success || !parsed.data.enabled || parsed.data.provider !== request.destination || parsed.data.workProfile !== request.profile || !parsed.data.quiet) return false;
    const quiet = parsed.data.quiet;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: quiet.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(request.now));
    const current = parts.find((part) => part.type === "hour")!.value + ":" + parts.find((part) => part.type === "minute")!.value;
    return quiet.start < quiet.end ? current >= quiet.start && current < quiet.end : current >= quiet.start || current < quiet.end;
  });
}

export async function serviceSurfaceRead(request: ServiceSurfaceReadRequest, current: () => boolean) {
  if (!current()) throw new Error("Service authorisation or active task profile changed");
  if (request.operation === "quiet-hours") {
    const quiet = quietHours(request);
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    return { quiet };
  }
  if (request.operation === "pull-requests") {
    const prs = await loadGithubPrsList();
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    if (!prs.configured) return { configured: false, authored: [], reviews: [], ownedFailed: [], stale: false };
    let owned: Awaited<ReturnType<typeof loadOwnedPrs>> | undefined;
    try { owned = await loadOwnedPrs(); } catch { owned = undefined; }
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    return { configured: true, authored: prs.authored, reviews: prs.reviews, feedbackPrs: prs.feedbackPrs, owned: owned?.prs, ownedRepos: listOwnedRepos().map((repo) => repo.fullName), ownedFailed: owned?.failedRepos ?? [], stale: prs.stale === true };
  }
  if (!isGoogleCalendarConfigured()) return { state: "not-configured" as const };
  const cached = getWeekCalendarCache();
  let days: Record<string, CalendarEvent[]>;
  if (cached && Date.now() - cached.ts < CALENDAR_WEEK_TTL_MS) days = cached.data as Record<string, CalendarEvent[]>;
  else {
    try { days = await getWeekEvents(); }
    catch (error) {
      if (!current()) throw new Error("Service authorisation or active task profile changed");
      if (isGoogleCalendarAuthError(error)) return { state: "needs-reauth" as const };
      throw error;
    }
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    setWeekCalendarCache(days);
  }
  if (!current()) throw new Error("Service authorisation or active task profile changed");
  return { state: "ok" as const, events: Object.values(days).flat() };
}
