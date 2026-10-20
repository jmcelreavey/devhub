"use client";

import { mutate } from "swr";
import type { TaskNoteOp } from "@shared/task-note/sections.ts";
import type { UpdateTaskNoteResult } from "@shared/task-note/update.ts";
import { profileHeaders, profileKey } from "@/lib/tasks/profile-scope";

const pending = new Map<string, Promise<UpdateTaskNoteResult>>();

export function taskNoteSectionsKey(notePath: string): string {
  return `/api/tasks/note/sections?notePath=${encodeURIComponent(notePath)}`;
}

export function submitTaskNoteOperation(notePath: string, op: TaskNoteOp, profile?: string): Promise<UpdateTaskNoteResult> {
  const key = `${profile ?? ""}:${notePath}:${JSON.stringify(op)}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(async () => {
    const response = await fetch("/api/tasks/note/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...profileHeaders(profile) },
      body: JSON.stringify({ notePath, ...op }),
    });
    const result = await response.json() as UpdateTaskNoteResult & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Couldn't save the answer. Your text is still here; try again.");
    await mutate(taskNoteSectionsKey(notePath), result, { revalidate: false });
    if (profile) await mutate(profileKey(taskNoteSectionsKey(notePath), profile), result, { revalidate: false });
    void mutate((cacheKey) => typeof cacheKey === "string" && (cacheKey.startsWith("/api/storyboard") || cacheKey.startsWith("/api/tasks/workflow")));
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
