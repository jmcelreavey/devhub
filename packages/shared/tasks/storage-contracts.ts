import type { EntityRef } from "../entity-note/index.ts";
import type { Task, TaskStage } from "./types.ts";

export interface NewTaskInput {
  text: string;
  jiraKey?: string | null;
  parentKey?: string;
  startDate?: string;
  due?: string;
  links?: EntityRef[];
  stage?: TaskStage;
  id?: string;
  notePath?: string;
  createdAt?: string;
  teamPickup?: Task["teamPickup"];
}

export interface TaskPatch {
  parentKey?: string;
  integrationRefs?: Task["integrationRefs"];
  text?: string;
  due?: string | null;
  links?: EntityRef[];
  stage?: "draft" | "ready";
  done?: boolean;
  status?: "complete" | "abandon" | "reactivate";
  abandonReason?: string;
  notePath?: string;
  timeSpentMs?: number;
  jiraKey?: string | null;
}

export interface DayBucket {
  date: string;
  tasks: Task[];
}
