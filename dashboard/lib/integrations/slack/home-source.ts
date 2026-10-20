import { TASK_NOTE_STATUS_LABEL } from "@shared/task-note/meta.ts";
import { loadSlackSnapshot } from "./answers";
import { buildHomeView, type SlackHomeInput } from "./home-view";
import type { SlackHomeView } from "./client";
import { buildPrSections } from "./pr-view";
import { slackThreadItemId, type SlackAudience } from "./thread-store";
import { loadSlackNeedsSnapshot } from "./needs-you-source";
import { actionablePrCount } from "@/lib/github/actionable-prs";

/** One part failing to load shows as "unavailable" for that part; the rest of the view still renders. */
export async function loadSlackHome(audience: SlackAudience, profile: string, now = Date.now()): Promise<SlackHomeInput> {
  let snapshot: ReturnType<typeof loadSlackSnapshot> | undefined;
  try { snapshot = loadSlackSnapshot(profile); } catch { snapshot = undefined; }
  const needs = snapshot ? await loadSlackNeedsSnapshot(profile, snapshot).then((result) => result.items.map((need) => ({ id: slackThreadItemId(need, audience), need })), () => undefined) : undefined;
  const today = new Set(snapshot?.todayTaskIds ?? []);
  const tasks = snapshot && !snapshot.errors.length
    ? snapshot.cards.filter((card) => today.has(card.taskId)).map((card) => ({ taskId: card.taskId, title: card.title, status: TASK_NOTE_STATUS_LABEL[card.status] }))
    : undefined;
  // Loaded on first use so importing the runtime never pulls in GitHub.
  const prs = await import("./pr-source").then(({ loadSlackPrs }) => loadSlackPrs()).then((data) => ({ configured: data.configured, sections: buildPrSections(data, now), actionableCount: actionablePrCount(data.authored, data.reviews, data.ownedRepos ?? []), stale: data.stale }), () => undefined);
  return { profile, channel: audience.channel, needs, tasks, prs, now };
}

export async function buildSlackHome(audience: SlackAudience, profile: string, now = Date.now()): Promise<SlackHomeView> {
  return buildHomeView(await loadSlackHome(audience, profile, now));
}
