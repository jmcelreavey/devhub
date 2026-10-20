import { hasLiveWork } from "@/lib/storyboard/next-action";
import { loadSlackSnapshot, slackRouteContext } from "./answers";
import type { SlackTaskMatch } from "./ticket-args";

/**
 * DevHub tasks for a Jira key, task id, or words from the title, from the same board the keyword answers read.
 * The message's profile is searched first; other profiles only when it has no match.
 */
export function findSlackTasks(ref: { jiraKey?: string; taskId?: string; words?: string }, profile: string): SlackTaskMatch[] {
  const context = slackRouteContext();
  const order = [profile, ...[context.activeProfile, ...context.profiles].filter((other) => other !== profile)];
  for (const candidate of [...new Set(order)]) {
    let cards;
    try { cards = loadSlackSnapshot(candidate).cards; } catch { continue; }
    const key = ref.jiraKey?.toUpperCase();
    const id = ref.taskId?.toLowerCase();
    const words = ref.words?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const matches = [...new Map(cards.map((card) => [card.taskId, card])).values()].flatMap((card): SlackTaskMatch[] => {
      const own = key ? card.task?.jiraKey?.toUpperCase() === key || card.jira?.[0]?.toUpperCase() === key : true;
      const hit = id ? card.taskId.toLowerCase() === id
        : words.length ? words.every((word) => card.title.toLowerCase().includes(word))
        : !!key && (own || !!card.jira?.some((item) => item.toUpperCase() === key));
      if (!hit) return [];
      return [{ taskId: card.taskId, date: card.task?.startDate ?? card.date, title: card.title, profile: candidate, done: card.taskDone || !!card.task?.abandonedAt, own, running: hasLiveWork(card) }];
    });
    if (matches.length) return matches;
  }
  return [];
}
