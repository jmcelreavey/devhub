import { Sunrise, Sun, Sunset, Moon } from "lucide-react";

export interface HeroEvent {
  id: string;
  title?: string;
  start?: string;
  end?: string;
  isAllDay?: boolean;
}

/**
 * Hero signal: the meeting happening right now, or the next one coming up.
 * Cheap enough to run per render — the clock already re-renders every second.
 */
export function nowNextEvent(
  events: HeroEvent[] | undefined,
): { kind: "now" | "next"; event: HeroEvent; whenLabel: string } | null {
  const now = Date.now();
  const timed = (events ?? []).filter((e) => !e.isAllDay && e.start && e.end && e.title);
  const current = timed.find(
    (e) => Date.parse(e.start as string) <= now && now < Date.parse(e.end as string),
  );
  if (current) {
    const ends = new Date(current.end as string).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { kind: "now", event: current, whenLabel: `ends ${ends}` };
  }
  const upcoming = timed
    .filter((e) => Date.parse(e.start as string) > now)
    .sort((a, b) => Date.parse(a.start as string) - Date.parse(b.start as string))[0];
  if (!upcoming) return null;
  const mins = Math.ceil((Date.parse(upcoming.start as string) - now) / 60000);
  const whenLabel =
    mins <= 120
      ? `in ${mins}m`
      : `at ${new Date(upcoming.start as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return { kind: "next", event: upcoming, whenLabel };
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Time-of-day greeting. Mounted-gated by the caller (server time ≠ client time). */
export function greetingForHour(hour: number): { label: string; Icon: typeof Sun } {
  if (hour >= 5 && hour < 12) return { label: "Good morning", Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { label: "Good afternoon", Icon: Sun };
  if (hour >= 17 && hour < 22) return { label: "Good evening", Icon: Sunset };
  return { label: "Up late", Icon: Moon };
}
