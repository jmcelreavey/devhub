import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { profileStateDir } from "@/lib/profile-state";

const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const destination = z.object({
  provider: z.literal("slack"), enabled: z.boolean(), workProfile: z.string(),
  quiet: z.object({ start: time, end: time, timeZone: z.string() }).optional(),
});

/** Keep existing Slack quiet hours without loading the removed alert delivery system. */
export function slackQuietHours(profile: string, now: Date, root = profileStateDir()): boolean {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, "workflow-alerts", "state.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  const { destinations } = z.object({ destinations: z.array(z.unknown()) }).parse(raw);
  return destinations.some((value) => {
    const parsed = destination.safeParse(value);
    if (!parsed.success || !parsed.data.enabled || parsed.data.workProfile !== profile || !parsed.data.quiet) return false;
    const q = parsed.data.quiet;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: q.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const current = parts.find((p) => p.type === "hour")!.value + ":" + parts.find((p) => p.type === "minute")!.value;
    return q.start < q.end ? current >= q.start && current < q.end : current >= q.start || current < q.end;
  });
}
