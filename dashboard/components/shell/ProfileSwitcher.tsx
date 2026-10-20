"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { Check, ChevronDown, Plus, Trash2, UserRound } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Top-bar task profile picker (home / work / …).
 *
 * The choice is per-machine, so switching does not touch git — it only changes
 * which `tasks/<profile>/` this machine writes to. Everything server-side
 * (tasks, sidebar counts, the Storyboard) keys off that, so a switch refetches
 * every SWR key and refreshes the route, without a page reload.
 */
export function ProfileSwitcher() {
  const { data, error, mutate } = useLive<TaskProfileOverview>(
    "/api/tasks/profiles",
  );
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const router = useRouter();
  const { mutate: mutateAll } = useSWRConfig();
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
        <UserRound size={14} aria-hidden className="hub-profile-icon" />
        <span className="hub-profile-label">Profiles</span>
        <ChevronDown size={12} aria-hidden className="hub-profile-chevron" />
      </button>
    );
  }
  const legacy = data.mode === "legacy";
  const newId = draft.trim().toLowerCase();
  const newIdValid =
    PROFILE_ID_RE.test(newId) && !data.profiles.includes(newId);
  const counts = data.counts ?? {};

  async function post(body: { action: "create" | "switch" | "delete"; id: string; moveTo?: string }): Promise<boolean> {
    if (busy) return false;
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
      const overview = await res.json() as TaskProfileOverview;
      if (overview.mode) await mutate(overview, { revalidate: false });
      else await mutate();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change profile.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Tasks, the board and every count are read for the active profile, so refetch everything. */
  async function refreshEverything() {
    await mutateAll(() => true);
    router.refresh();
  }

  async function switchTo(profile: string) {
    if (profile === data?.active) {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!(await post({ action: "switch", id: profile }))) return;
    setOpen(false);
    toast.success(`Switched to ${profile}`);
    await refreshEverything();
  }

  async function create(profile: string) {
    if (!(await post({ action: "create", id: profile }))) return;
    setDraft("");
    setCreating(false);
    setOpen(false);
    toast.success(`Created ${profile} and switched to it`);
    await refreshEverything();
  }

  async function remove(profile: string, moveTo?: string) {
    if (!(await post({ action: "delete", id: profile, ...(moveTo ? { moveTo } : {}) }))) return;
    setConfirming(null);
    toast.success(moveTo ? `Moved ${profile}’s tasks to ${moveTo} and deleted it` : `Deleted ${profile}`);
    await refreshEverything();
  }

  const label = legacy ? "Profiles" : titleCase(data.active ?? "");
  const deleteBlocked = (profile: string) =>
    profile === data.active ? "This machine uses it. Switch first." : profile === data.defaultProfile ? "The default profile can’t be deleted." : null;
  // A non-empty profile's tasks go to the active profile: the one John is looking at, and never the one being deleted.
  const moveTarget = data.active ?? data.profiles.find((profile) => profile !== confirming) ?? null;

  return (
    <div
      ref={ref}
      className="accent-picker"
      onBlur={(event) => {
        // Safari/WebKit (the desktop app) doesn't focus a clicked button, so a click inside the panel blurs with no
        // relatedTarget. Closing then unmounted the row before its click landed: only close when focus moves elsewhere.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="hub-icon-btn hub-profile-trigger"
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => {
          // Each open starts at the list: no half-typed name or pending delete from last time.
          setCreating(false);
          setConfirming(null);
          setOpen((v) => !v);
        }}
        title={legacy ? "Set up task profiles (home / work)" : `Task profile: ${data.active}`}
        aria-label={legacy ? "Set up task profiles" : `Task profile: ${data.active}. Change profile`}
        aria-expanded={open}
      >
        {/* Narrow top bars show just the initial, so each profile still reads
            as itself without spending the label's width. */}
        {!legacy && data.active && (
          <span className="hub-profile-initial" aria-hidden>
            {data.active.charAt(0).toUpperCase()}
          </span>
        )}
        <UserRound size={14} aria-hidden className="hub-profile-icon" />
        <span className="hub-profile-label">{label}</span>
        <ChevronDown size={12} aria-hidden className="hub-profile-chevron" />
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
          <h2 id={`${id}-title`}>Task profiles</h2>
          {legacy ? (
            <p>
              Keep separate task lists (e.g. home and work) in this repo and see
              the other one read-only.
              {data.legacyFiles > 0 &&
                ` Your ${data.legacyFiles} existing day-files move into the first profile (a git rename, history kept).`}
            </p>
          ) : (
            <ul className="hub-profile-list" aria-label="Profiles">
              {data.profiles.map((profile) => {
                const active = profile === data.active;
                const count = counts[profile];
                const blocked = deleteBlocked(profile);
                if (confirming === profile) {
                  const total = count?.total ?? 0;
                  return (
                    <li key={profile} className="hub-profile-confirm" role="group" aria-label={`Delete ${profile}`}>
                      <p>{total > 0 ? `Delete ${profile}? Its ${total} ${total === 1 ? "task moves" : "tasks move"} to ${moveTarget} first.` : `Delete ${profile}? It has no tasks.`}</p>
                      <div className="hub-profile-form-row">
                        <button type="button" className="btn btn-danger-ghost" disabled={busy || (total > 0 && !moveTarget)} onClick={() => void remove(profile, total > 0 ? moveTarget ?? undefined : undefined)}>
                          {total > 0 ? `Move ${total} ${total === 1 ? "task" : "tasks"} to ${moveTarget} and delete` : "Delete"}
                        </button>
                        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={profile} className="hub-profile-row" data-active={active || undefined}>
                    <button
                      type="button"
                      aria-pressed={active}
                      className="hub-profile-option"
                      disabled={busy}
                      onClick={() => void switchTo(profile)}
                    >
                      <span className="hub-profile-name">{titleCase(profile)}</span>
                      {count ? <span className="hub-profile-count">{count.open} open</span> : null}
                      {active ? <Check size={13} aria-label="Active" /> : null}
                    </button>
                    <button
                      type="button"
                      className="hub-profile-delete"
                      aria-label={`Delete ${profile}`}
                      title={blocked ?? `Delete ${profile}`}
                      disabled={busy || Boolean(blocked)}
                      onClick={() => setConfirming(profile)}
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {legacy || creating ? (
            <form
              className="hub-profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                const next = legacy && !newId ? "home" : newId;
                if (legacy ? PROFILE_ID_RE.test(next) : newIdValid) void create(next);
              }}
            >
              <label htmlFor={`${id}-name`}>{legacy ? "First profile" : "New profile"}</label>
              <div className="hub-profile-form-row">
                <input
                  id={`${id}-name`}
                  className="input"
                  disabled={busy}
                  aria-describedby={`${id}-hint`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={legacy ? "home" : "e.g. side-project"}
                  maxLength={32}
                  autoFocus={!legacy}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || (legacy ? draft.trim() !== "" && !PROFILE_ID_RE.test(newId) : !newIdValid)}
                >
                  {busy ? "Saving…" : legacy ? "Enable" : "Add"}
                </button>
              </div>
              <p id={`${id}-hint`}>Lowercase letters, numbers, hyphens or underscores. Creating one switches this machine to it.</p>
            </form>
          ) : (
            <button type="button" className="hub-profile-new" onClick={() => setCreating(true)}>
              <Plus size={12} aria-hidden />New profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function titleCase(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}
