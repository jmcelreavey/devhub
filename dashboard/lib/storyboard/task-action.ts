"use client";

import { useSyncExternalStore } from "react";

export interface ActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

const pending = new Map<string, Promise<ActionResult>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function runTaskAction(taskId: string, action: string, work: () => Promise<ActionResult>, profile?: string): Promise<ActionResult> {
  const key = `${JSON.stringify([profile ?? "", taskId])}:${action}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(work).finally(() => {
    pending.delete(key);
    notify();
  });
  pending.set(key, promise);
  notify();
  return promise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTaskActionPending(taskId: string, profile?: string): boolean {
  const prefix = `${JSON.stringify([profile ?? "", taskId])}:`;
  return useSyncExternalStore(subscribe, () => [...pending.keys()].some((key) => key.startsWith(prefix)), () => false);
}
