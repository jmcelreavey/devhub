import { redirect } from "next/navigation";

/**
 * The Workflow screen is gone: a task's checks, review and QA evidence live in its Storyboard side panel.
 * Old links (alerts, Slack, notes, agent prompts) still arrive here and land on that panel.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = new URLSearchParams();
  const taskId = typeof params.taskId === "string" ? params.taskId : undefined;
  if (taskId) { next.set("task", taskId); next.set("taskSection", "evidence"); }
  for (const key of ["profile", "taskProfile"] as const) {
    const value = params[key];
    if (typeof value === "string") next.set(key, value);
  }
  redirect(`/storyboard${next.size ? `?${next}` : ""}`);
}
