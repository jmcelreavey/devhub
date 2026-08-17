/**
 * Plugin integration surface for cross-entity links.
 *
 * BI and future plugins should import EntityRef builders from here (or the
 * sibling `@/lib/task-note` / `@/lib/meeting-note` / `@/lib/pr-note` modules)
 * after materialize — never invent a parallel link format.
 *
 * Example (plugin dashboard module):
 *   import { buildEntityLinksSection, type EntityRef } from "@/lib/entity-links";
 */
export * from "@/lib/entity-note";
export { buildTaskNoteMarkdown, taskEntityRefs, taskNotePath } from "@/lib/task-note";
export { buildMeetingNoteMarkdown, meetingEntityRefs, meetingNotePath } from "@/lib/meeting-note";
export { buildPrNoteMarkdown, prEntityId, prEntityRefs, prNotePath } from "@/lib/pr-note";
export { parseGithubPrRef, parseGithubPrUrl } from "@/lib/entity-links/parse-pr";
