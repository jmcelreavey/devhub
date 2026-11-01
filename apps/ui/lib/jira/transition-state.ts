"use client";
import { useSyncExternalStore } from "react";

/**
 * Where a ticket is *going*, shared by every status chip on screen. The chip
 * that was clicked, the same ticket in the task list and the key chip in a
 * note all read one source, so they change together and none waits on Jira.
 */
export interface TransitionOverride { status: string; pending: boolean }

const overrides = new Map<string, TransitionOverride>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function setTransitionOverride(key: string, status: string, pending: boolean) {
  overrides.set(key, { status, pending });
  emit();
}
export function clearTransitionOverride(key: string) {
  if (overrides.delete(key)) emit();
}
export function isTransitionPending(key: string) {
  return overrides.get(key)?.pending === true;
}
export function useTransitionOverride(key: string): TransitionOverride | undefined {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => overrides.get(key),
    () => undefined,
  );
}
