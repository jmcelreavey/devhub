import { NextResponse } from "next/server";
import path from "node:path";
import { resolveActiveProfileId } from "@shared/vault/task-profiles.ts";
import { getTasksDir } from "@/lib/notes/dir";
import { withTaskDirectory } from "./profile-context";

export function activeTaskProfile(): string {
  return resolveActiveProfileId(getTasksDir()) ?? "legacy";
}

export function requestedTaskProfile(request: Request): string | null {
  return request.headers.get("X-Devhub-Task-Profile") ?? new URL(request.url).searchParams.get("taskProfile");
}

export function taskProfileConflict(expected: string): Response | null {
  if (expected === activeTaskProfile()) return null;
  return NextResponse.json({ error: "The active task profile changed. Refresh before continuing." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}

export function withTaskProfileRequest<T>(profile: string, work: () => T): T {
  const root = getTasksDir();
  return withTaskDirectory(root, profile === "legacy" ? root : path.join(root, profile), work);
}
