import { z } from "zod/v3";
import { TASK_QA_GOAL_LIMIT } from "../../../packages/shared/task-note/qa-scenario.ts";

export const taskQaScenarioInputSchema = z.object({
  goals: z.array(z.object({
    description: z.string().min(1).max(200),
    assertion: z.enum(["text", "visible"]),
    selector: z.string().min(1).max(300),
    expected: z.string().max(300).optional(),
  }).strict()).min(1).max(TASK_QA_GOAL_LIMIT),
}).strict();
