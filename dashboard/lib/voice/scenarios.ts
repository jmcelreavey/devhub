import type { VoiceScenario } from "./types";

/**
 * Situations the quiz asks about. Ids are stored with answers, so never reuse
 * or renumber one; retire a scenario by deleting it and its answers go inert.
 *
 * Each one is a circumstance plus an action, with no hint of how to phrase it:
 * a prompt that models a tone just gets that tone echoed back.
 */
export const VOICE_SCENARIOS: VoiceScenario[] = [
  {
    id: "slack-disagree-dependency",
    register: "slack",
    situation:
      "In an engineering Slack thread a teammate proposes adding a new library to solve something a few lines of code would cover.",
    task: "Reply in the thread.",
  },
  {
    id: "slack-confirm-fix",
    register: "slack",
    situation:
      "A colleague posts the fix you suggested yesterday and asks whether it looks right. It does.",
    task: "Reply.",
  },
  {
    id: "slack-deadline-pushback",
    register: "slack",
    situation:
      "Product asks whether a feature can ship by Friday. Realistically it's Tuesday, and only if nothing else lands.",
    task: "Answer them.",
  },
  {
    id: "slack-ask-for-help",
    register: "slack",
    situation:
      "You've lost two hours to a CI test that only fails on the build server. You want the wider channel's help.",
    task: "Post the question.",
  },
  {
    id: "slack-own-mistake",
    register: "slack",
    situation:
      "A migration you merged broke staging for the whole team. You've reverted it and it's recovering.",
    task: "Tell the team.",
  },
  {
    id: "email-decline-meeting",
    register: "email",
    situation:
      "A senior colleague invites you to a recurring weekly meeting you don't need to be in.",
    task: "Decline, keeping the relationship intact.",
  },
  {
    id: "email-chase-reply",
    register: "email",
    situation:
      "Someone hasn't replied to a request you sent them eight days ago, and you need the answer this week.",
    task: "Chase them.",
  },
  {
    id: "email-thank-unblocker",
    register: "email",
    situation:
      "A colleague dropped what they were doing yesterday to unblock you on a deadline.",
    task: "Thank them.",
  },
  {
    id: "email-support-damaged-order",
    register: "email",
    situation:
      "An online order arrived with a cracked screen and the retailer's returns page won't accept the claim.",
    task: "Write to their support team.",
  },
  {
    id: "email-cold-outreach",
    register: "email",
    situation:
      "A local business has a website that loads slowly and looks dated. You do freelance web work and have never spoken to them.",
    task: "Write the first message.",
  },
  {
    id: "email-explain-delay",
    register: "email",
    situation:
      "A non-technical stakeholder asks why a report is late. The cause is a cache that kept serving stale data.",
    task: "Explain it to them.",
  },
  {
    id: "ticket-bug-report",
    register: "ticket",
    situation:
      "On Safari the checkout button does nothing once a promo code has been applied. Chrome is fine.",
    task: "Write the ticket title and description.",
  },
  {
    id: "ticket-small-chore",
    register: "ticket",
    situation: "A feature flag that shipped to everyone months ago is still in the code.",
    task: "Write the ticket title and description for removing it.",
  },
  {
    id: "pr-description-backoff",
    register: "pr",
    situation:
      "You changed an API client's retry logic from a fixed delay to exponential backoff because it kept hammering a struggling upstream.",
    task: "Write the pull request description.",
  },
  {
    id: "pr-review-nit",
    register: "pr",
    situation: "A pull request you're reviewing has a variable named `data2` that holds user permissions.",
    task: "Leave the review comment.",
  },
  {
    id: "pr-review-blocking",
    register: "pr",
    situation:
      "A pull request wraps a payment call in a try/catch that swallows the error. You can't approve it as is.",
    task: "Leave the review comment.",
  },
  {
    id: "commit-rename-config",
    register: "commit",
    situation: "You renamed a config key and updated its three call sites. Nothing else changed.",
    task: "Write the commit message.",
  },
  {
    id: "chat-agent-instruction",
    register: "chat",
    situation:
      "Your coding agent has proposed a plan that includes a tempting refactor. You want the fix only, with a small diff.",
    task: "Tell the agent what to do.",
  },
  {
    id: "chat-standup-update",
    register: "chat",
    situation:
      "Yesterday you chased a production bug that turned out to be a timezone issue. Today you're writing its regression test and picking up a review.",
    task: "Write your stand-up update.",
  },
  {
    id: "feedback-missing-tests",
    register: "feedback",
    situation:
      "A junior teammate's pull request is well structured and readable, but has no tests.",
    task: "Give them feedback.",
  },
];

export function findScenario(id: string): VoiceScenario | undefined {
  return VOICE_SCENARIOS.find((scenario) => scenario.id === id);
}
