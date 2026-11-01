import { createTaskService } from "./service";
import { getActiveTasksDir, getNotesDir, getTasksDir } from "../../lib/notes/dir";
import { seedSummaryFromJira } from "./seed-jira-summary";
import { listRepoNames } from "../../lib/repos/index";
import { createTaskNoteResolver } from "./task-notes";
import { resolveTaskInput } from "../../../../../packages/shared/ui-lib/tasks/resolve-task-input";

export type { Task } from "../../../../../packages/shared/tasks/types";
export { isTaskOpen } from "../../../../../packages/shared/tasks/types";
export const { migrationAllowed, ensureTasksMigrated, taskMigrationNotice, present, getTasks, addTask, toggleTask, setTaskCompletion, abandonTask, reactivateTask, deleteTask, updateTask, taskUpdatePatch, reorderOpenTasks, startTaskTimer, stopTaskTimer, itemsModified, listTaskFiles, listTaskDays } = createTaskService({ getActiveTasksDir, getNotesDir, getTasksDir, createTaskNoteResolver, listRepoNames, resolveTaskInput, seedSummaryFromJira });
