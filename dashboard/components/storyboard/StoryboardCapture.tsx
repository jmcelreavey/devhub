"use client";

import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { Plus } from "lucide-react";
import { TaskComposer, type TaskComposerCapture } from "@/components/tasks/TaskComposer";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { profileHeaders } from "@/lib/tasks/profile-scope";
import styles from "./StoryboardCapture.module.css";

/**
 * Home and Storyboard quick-add. It is the Tasks composer in capture mode, so
 * pasted links, Jira keys, #tags and `@` links work exactly as on Tasks, but
 * every submit saves a draft to the active profile's To do and starts nothing.
 */
export function StoryboardCapture({ empty = false, inline = false, id = "storyboard-capture", onCaptured }: { empty?: boolean; inline?: boolean; id?: string; onCaptured?: () => void }) {
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const [error, setError] = useState("");
  const toast = useToast();
  const destination = profile.data ? profile.data.active ?? "legacy" : "…";
  // Without profiles the destination id is "legacy"; John only needs to know it lands in To do.
  const where = profile.data?.active ? `${profile.data.active} · To do` : "To do";

  const focusedEmpty = useRef(false);

  useEffect(() => {
    if (!empty || focusedEmpty.current) return;
    focusedEmpty.current = true;
    document.getElementById(id)?.focus();
  }, [empty, id]);

  const hint = <p id={`${id}-hint`} className={styles.hint}>Saves to {where} · doesn&apos;t start an agent</p>;
  const capture: TaskComposerCapture = {
    endpoint: "/api/tasks/capture",
    formLabel: "Capture an idea",
    inputLabel: "Capture an idea or paste a ticket",
    headers: profileHeaders(destination),
    body: { profile: destination },
    disabled: !profile.data || !!profile.error,
    describedBy: `${id}-hint`,
    maxLength: 500,
    rowClassName: `${styles.controls}${inline ? " focus-host" : ""}`,
    leading: inline ? <Plus size={16} aria-hidden className={styles.plus} /> : null,
    trailing: inline ? hint : null,
    onError: (message) => setError(message ?? ""),
  };

  const onAdded = () => {
    onCaptured?.();
    toast.success(`Saved to ${where}. No agent started.`);
    void mutate((key) => typeof key === "string" && (key.startsWith("/api/storyboard") || key.startsWith("/api/tasks") || key.startsWith("/api/sidebar/counts")));
  };

  return <div className={`${styles.capture}${inline ? ` ${styles.inline}` : ""}`}>
    <TaskComposer inputId={id} placeholder="Capture an idea, paste a link or ticket, @ to link…" capture={capture} onAdded={onAdded} />
    {!inline ? hint : null}
    {profile.error ? <p role="alert" className={styles.error}>Couldn&apos;t confirm the active profile. <button type="button" className="btn btn-ghost" onClick={() => void profile.mutate()}>Retry</button></p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </div>;
}
