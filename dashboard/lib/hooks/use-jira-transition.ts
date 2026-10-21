"use client";
import { useCallback } from "react";
import { mutate } from "swr";
import { useToast } from "@/lib/hooks/use-toast";
import { clearTransitionOverride, isTransitionPending, setTransitionOverride } from "@/lib/jira/transition-state";
import type { JiraTicket } from "@/lib/jira/client";
import { profileHeaders } from "@/lib/tasks/profile-scope";

interface Undo { toStatusId: string; label: string }
interface MoveResponse { undo?: Undo | null; from?: string | null; to?: string | null; error?: string }
export interface JiraMove { transitionId?: string; toStatusId?: string }
export interface JiraMoveOptions {
  /** Destination label. Lets the chip change before Jira answers. */
  to?: string;
  onChanged?: () => void;
  profile?: string;
}

const UNDO_WINDOW_MS = 10_000;
const TICKETS = "/api/jira/tickets";

function patchTickets(key: string, status: string) {
  void mutate(
    TICKETS,
    (current: { tickets?: JiraTicket[] } | undefined) => current?.tickets ? { ...current, tickets: current.tickets.map((t) => t.key === key ? { ...t, status } : t) } : current,
    { revalidate: false },
  );
}

type Toasts = ReturnType<typeof useToast>;

async function run(toast: Toasts, key: string, change: JiraMove, options: JiraMoveOptions): Promise<boolean> {
  if (isTransitionPending(key)) return false;
  if (options.to) { setTransitionOverride(key, options.to, true); patchTickets(key, options.to); }
  // Whatever happened, the server's answer replaces the guess.
  const settle = async () => {
    await Promise.all([mutate(TICKETS), mutate("/api/sidebar/counts")]);
    clearTransitionOverride(key);
    options.onChanged?.();
  };
  try {
    const res = await fetch(`/api/jira/ticket/${key}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...profileHeaders(options.profile) },
      body: JSON.stringify(change),
    });
    const body = (await res.json().catch(() => ({}))) as MoveResponse;
    if (!res.ok) {
      await settle();
      toast.error(`${key} wasn't moved${body.error ? `: ${body.error}` : "."}`, { duration: 9000 });
      return false;
    }
    if (options.to) setTransitionOverride(key, options.to, false);
    const undo = body.undo;
    const to = body.to ?? options.to;
    toast.success(to ? `${key} moved to ${to}` : `Updated ${key}`, {
      duration: undo ? UNDO_WINDOW_MS : undefined,
      action: undo ? { label: "Undo", onClick: () => void run(toast, key, { toStatusId: undo.toStatusId }, { to: body.from ?? undefined, onChanged: options.onChanged, profile: options.profile }) } : undefined,
    });
    await settle();
    return true;
  } catch {
    await settle();
    toast.error(`Couldn't reach DevHub to move ${key}. Check Jira before retrying.`, { duration: 9000 });
    return false;
  }
}

/**
 * One click moves a ticket. The chip shows the destination at once with a
 * spinner on the chip only, the request runs in the background, and the result
 * is a toast with Undo.
 */
export function useJiraTransition() {
  const toast = useToast();
  return useCallback((key: string, change: JiraMove, options: JiraMoveOptions = {}) => run(toast, key, change, options), [toast]);
}
