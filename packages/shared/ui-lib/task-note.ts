/** Re-export shared task-note helpers (dashboard UI + MCP + plugins). */
export {
  buildTaskNoteMarkdown,
  normalizeTaskLinkState,
  rewriteTaskKey,
  taskEntityRefs,
  taskNotePath,
  textWithJiraLinkPromotion,
  type TaskNoteSource,
} from "../task-note/index.ts";
