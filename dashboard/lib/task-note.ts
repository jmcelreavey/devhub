/** Re-export shared task-note helpers (dashboard UI + MCP + plugins). */
export {
  buildTaskNoteMarkdown,
  normalizeTaskLinkState,
  rewriteTaskKey,
  taskEntityRefs,
  taskNotePath,
  textWithJiraLinkPromotion,
  type TaskNoteSource,
} from "../../shared/task-note/index.ts";
