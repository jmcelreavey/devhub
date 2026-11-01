/**
 * Plugin integration surface for cross-entity links.
 *
 * Plugins should import EntityRef builders from here (or the
 * sibling `@/lib/task-note` / `@/lib/meeting-note` / `@/lib/pr-note` modules)
 * across core and plugins — never invent a parallel link format.
 *
 * Example (plugin dashboard module):
 *   import { buildEntityLinksSection, type EntityRef } from "@/lib/entity-links";
 */
export * from "../../../../packages/shared/ui-lib/entity-note";
export { buildTaskNoteMarkdown, taskEntityRefs, taskNotePath } from "../../../../packages/shared/ui-lib/task-note";
export { buildMeetingNoteMarkdown, meetingEntityRefs, meetingNotePath } from "../../../../packages/shared/ui-lib/meeting-note";
export { buildPrNoteMarkdown, prEntityId, prEntityRefs, prNotePath } from "../../../../packages/shared/ui-lib/pr-note";
export { parseGithubPrRef, parseGithubPrUrl } from "../../../../packages/shared/ui-lib/entity-links/parse-pr";
