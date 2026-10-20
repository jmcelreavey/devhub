/** Plain-language milestone context, stored as labelled paragraphs in ## Status. */
export interface TaskStatusUpdate {
  summary: string;
  whatChanged: string;
  currentState: string;
  nextStep: string;
}

export const STATUS_UPDATE_LABELS: Record<keyof TaskStatusUpdate, string> = {
  summary: "Summary",
  whatChanged: "What changed",
  currentState: "Current state",
  nextStep: "Next step",
};

export function readStatusUpdate(lines: string[]): TaskStatusUpdate | undefined {
  const values: Partial<TaskStatusUpdate> = {};
  for (const key of Object.keys(STATUS_UPDATE_LABELS) as Array<keyof TaskStatusUpdate>) {
    const prefix = `${STATUS_UPDATE_LABELS[key]}: `;
    const line = lines.find((text) => text.startsWith(prefix));
    if (!line?.slice(prefix.length).trim()) return undefined;
    values[key] = line.slice(prefix.length).trim();
  }
  return values as TaskStatusUpdate;
}

export const TASK_STATUS_UPDATE_INSTRUCTION =
  "At each milestone (plan ready, implementation done, review done, failure, PR opened), and after follow-up work, call task_note_update with op: set_status_update and statusUpdate: {summary, whatChanged, currentState, nextStep}. " +
  "Write one or two short plain-language sentences per field: Summary, What changed, Current state, Next step. Explain failures and what can happen next; do not paste raw logs. This upserts the Status block and refreshes the card summary without replacing the plan or personal notes. " +
  "For UI work, capture a screenshot using the available browser/screenshot tooling and attach it with task_note_update op: add_media, localFile: the absolute screenshot path, caption and phase: after (before for a baseline). The latest attached screenshot appears in task details. If capture is unavailable, say why in currentState; never claim an unseen screenshot or completed checks.";
