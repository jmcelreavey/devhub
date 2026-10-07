"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Top-bar task profile picker (home / work / …).
 *
 * The choice is per-machine, so switching does not touch git — it only changes
 * which `tasks/<profile>/` this machine writes to. Everything server-side
 * (tasks, sidebar counts, recall) keys off that, so a full reload is the
 * honest way to refresh all of it at once.
 */
export function ProfileSwitcher() {
  const { data, error, mutate } = useLive<TaskProfileOverview>(
    "/api/tasks/profiles",
  );
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>("button:not(:disabled), input")
      ?.focus();
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!data) {
    return (
      <button
        type="button"
        className="hub-icon-btn hub-profile-trigger"
        disabled={!error}
        onClick={() => void mutate()}
        aria-label={
          error ? "Couldn't load task profiles. Retry" : "Loading task profiles"
        }
        title={
          error
            ? "Couldn't load task profiles. Click to retry."
            : "Loading task profiles"
        }
      >
        <UserRound size={14} aria-hidden />
        <span className="hub-profile-label">Profiles</span>
        <ChevronDown size={12} aria-hidden />
      </button>
    );
  }
  const legacy = data.mode === "legacy";
  const newId = draft.trim().toLowerCase();
  const newIdValid =
    PROFILE_ID_RE.test(newId) && !data.profiles.includes(newId);

  async function post(body: { action: "create" | "switch"; id: string }) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't change profile.",
      );
      setBusy(false);
    }
  }

  return (
    <div
      ref={ref}
      className="accent-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="hub-icon-btn hub-profile-trigger"
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        title={
          legacy
            ? "Set up task profiles (home / work)"
            : `Task profile: ${data.active}`
        }
        aria-label={
          legacy
            ? "Set up task profiles"
            : `Task profile: ${data.active}. Change profile`
        }
        aria-expanded={open}
      >
        <UserRound size={14} aria-hidden />
        <span className="hub-profile-label">
          {legacy ? "Profiles" : data.active}
        </span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          className="accent-picker-pop hub-profile-pop"
          role="dialog"
          aria-labelledby={`${id}-title`}
          aria-busy={busy}
        >
          <div>
            <h2 id={`${id}-title`}>Task profiles</h2>
            <p>Choose the task list used on this machine.</p>
          </div>
          {legacy ? (
            <p>
              Keep separate task lists (e.g. home and work) in this repo and see
              the other one read-only.
              {data.legacyFiles > 0 &&
                ` Your ${data.legacyFiles} existing day-files move into the first profile (a git rename, history kept).`}
            </p>
          ) : (
            <div
              className="hub-profile-list"
              role="group"
              aria-label="Available profiles"
            >
              {data.profiles.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === data.active}
                  className="btn btn-ghost hub-profile-option"
                  disabled={busy}
                  onClick={() => {
                    if (id !== data.active) {
                      void post({ action: "switch", id });
                      return;
                    }
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <span>{id}</span>
                  {id === data.active && <Check size={13} aria-hidden />}
                </button>
              ))}
            </div>
          )}
          <form
            className="hub-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              const id = legacy && !newId ? "home" : newId;
              if (legacy ? PROFILE_ID_RE.test(id) : newIdValid)
                void post({ action: "create", id });
            }}
          >
            <label htmlFor={`${id}-name`}>
              {legacy ? "First profile" : "New profile"}
            </label>
            <div className="hub-profile-form-row">
              <input
                id={`${id}-name`}
                className="input"
                disabled={busy}
                aria-describedby={`${id}-hint`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={legacy ? "home" : "New profile…"}
                aria-label={legacy ? "First profile name" : "New profile name"}
                maxLength={32}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  busy ||
                  (legacy
                    ? draft.trim() !== "" && !PROFILE_ID_RE.test(newId)
                    : !newIdValid)
                }
              >
                {busy ? "Saving…" : legacy ? "Enable" : "Add"}
              </button>
            </div>
            <p id={`${id}-hint`}>
              Use letters, numbers, hyphens or underscores.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
