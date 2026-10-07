"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SetupProgressSchema, type SetupProgress, type SetupStepId } from "./progress";
import type { GoalId } from "./goals";

const ENDPOINT = "/api/desktop/first-run";

async function persist(progress: SetupProgress): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(progress),
  });
  if (!response.ok) throw new Error("Couldn't save setup progress. Please retry.");
}

export function useSetupProgress() {
  const [progress, setProgress] = useState(() => SetupProgressSchema.parse({}));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const lastSaved = useRef("");
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Couldn't load setup progress.");
        const saved = SetupProgressSchema.parse(await response.json());
        lastSaved.current = JSON.stringify(saved);
        setProgress(saved);
        setReady(true);
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Couldn't load setup progress. Please retry.");
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const snapshot = JSON.stringify(progress);
    if (!ready || snapshot === lastSaved.current) return;
    lastSaved.current = snapshot;
    // Keep step writes in order, including when someone clicks through quickly.
    writes.current = writes.current.then(() => persist(progress)).then(
      () => setError(""),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save setup progress."),
    );
  }, [progress, ready]);

  const setCurrentStepId = useCallback((currentStep: SetupStepId) => {
    setProgress((current) => ({ ...current, currentStep }));
  }, []);
  const updateGoals = useCallback((goals: GoalId[]) => {
    setProgress((current) => ({ ...current, goals }));
  }, []);
  const skipStep = useCallback((step: SetupStepId) => {
    setProgress((current) => ({ ...current, skipped: [...new Set([...current.skipped, step])] }));
  }, []);
  const finish = useCallback(async () => {
    await writes.current;
    await persist({ ...progress, completed: true });
  }, [progress]);
  const retry = useCallback(() => {
    if (!ready) {
      setAttempt((current) => current + 1);
      return;
    }
    writes.current = writes.current.then(() => persist(progress)).then(
      () => setError(""),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save setup progress."),
    );
  }, [progress, ready]);

  return { ...progress, ready, error, retry, setCurrentStepId, updateGoals, skipStep, finish };
}
