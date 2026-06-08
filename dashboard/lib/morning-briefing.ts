export interface BriefingInput {
  date: string;
  events: { title: string; time: string }[];
  staleTickets: { key: string; summary: string }[];
  prsToReview: { title: string; repo: string }[];
  oncallAlerts: { title: string }[];
  topTasks: { text: string }[];
}

function section(title: string, items: string[]): string {
  if (items.length === 0) return `${title}: none`;
  return `${title}:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** Returns true when there is nothing worth summarising (so we can skip the model call). */
export function briefingIsEmpty(input: BriefingInput): boolean {
  return (
    input.events.length === 0 &&
    input.staleTickets.length === 0 &&
    input.prsToReview.length === 0 &&
    input.oncallAlerts.length === 0 &&
    input.topTasks.length === 0
  );
}

/** Build the prompt that turns the day's signals into a one-paragraph briefing. */
export function buildBriefingPrompt(input: BriefingInput): string {
  const facts = [
    section("Meetings today", input.events.map((e) => `${e.time} ${e.title}`)),
    section("PRs waiting on my review", input.prsToReview.map((p) => `${p.title} (${p.repo})`)),
    section("Stale Jira tickets assigned to me", input.staleTickets.map((t) => `${t.key}: ${t.summary}`)),
    section("Overnight on-call alerts", input.oncallAlerts.map((a) => a.title)),
    section("Top open tasks", input.topTasks.map((t) => t.text)),
  ].join("\n\n");

  return [
    `You are writing a brief morning stand-up summary for a senior engineer on ${input.date}.`,
    "Using only the facts below, write ONE short paragraph (3–5 sentences) that tells them what to focus on today.",
    "Lead with anything urgent (on-call alerts, PRs blocking others). Be direct and specific — name tickets/PRs. No greeting, no preamble, no bullet points, no markdown headings.",
    "",
    facts,
  ].join("\n");
}
