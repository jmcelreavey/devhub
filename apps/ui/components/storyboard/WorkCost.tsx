import { costLabel } from "../../../../packages/shared/ui-lib/storyboard/work-insights";
import type { NotesBoard } from "../../../../packages/shared/ui-lib/storyboard/notes-board-shared";

export function WorkCost({ cost }: { cost?: NotesBoard["cost"] }) {
  const today = costLabel(cost?.todayUsd);
  const week = costLabel(cost?.weekUsd);
  if (!today && !week) return null;
  return <span className="text-xs text-text-muted" title="Reported run costs, grouped by run start date. Some providers do not report prices.">{[today && `Today ${today}`, week && `This week ${week}`].filter(Boolean).join(" · ")}</span>;
}
