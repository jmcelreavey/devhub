import type { QaReceipt } from "../../qa/src/types.ts";
import type { TaskQaScenario } from "../task-note/qa-scenario.ts";

export interface QaRunRecord {
  id: string;
  requestId: string;
  scenarioId: string;
  taskId?: string;
  /** Prevents a late result from attaching to the same task after Reset and Start. */
  orchestrationId?: string;
  createdAt: string;
  state: "running" | "finished";
  receipt?: QaReceipt;
  taskAssertions?: TaskQaScenario;
  revision?: QaReceipt["revision"];
  /** Recorded at task start to supply the "before" video; never advances the orchestration. */
  baseline?: boolean;
  ownerPid?: number;
}
