import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { costLabel } from "@/lib/storyboard/work-insights";
import styles from "./TaskDetailPanel.module.css";

export function TaskCost({ card }: { card: BoardCard }) {
  const usage = (card.usage ?? card.steps).filter((run) => costLabel(run.costUsd));
  if (!usage.length) return null;
  return <details className={styles.section}>
    <summary>Reported cost {costLabel(card.costUsd ?? usage.reduce((sum, run) => sum + (run.costUsd ?? 0), 0))}</summary>
    <div className={styles.sectionBody}>
      <p>Reported by the provider. Runs without a reported price are excluded.</p>
      <ul className={styles.list} aria-label="Cost by run and model">{usage.map((run) => <li key={run.runId}><strong>{run.label ?? run.role}</strong> · {run.model ?? run.provider ?? "Model not recorded"} · {costLabel(run.costUsd)}<br /><small>{run.runId}{run.tokens ? ` · ${run.tokens.toLocaleString()} tokens` : ""}</small></li>)}</ul>
    </div>
  </details>;
}
