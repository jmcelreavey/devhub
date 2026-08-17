"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { mutate } from "swr";
import type { GithubPrAuthor, GithubPrRow } from "@/lib/github/prs";
import { useToast } from "@/lib/hooks/use-toast";
import { PersonChip } from "@/components/PersonChip";
import { HoverTip } from "@/components/ui/HoverTip";

interface ReviewerContextPayload {
  requested?: GithubPrAuthor[];
  suggested?: GithubPrAuthor[];
}

export function ReviewerFacepile({
  reviewers,
  onClick,
  size = 18,
}: {
  reviewers: GithubPrAuthor[];
  onClick?: () => void;
  size?: number;
}) {
  if (reviewers.length === 0) return null;
  const names = reviewers.map((user) => user.login).join(", ");
  const label = `Requested: ${names}`;

  return (
    <HoverTip label={label} pos="top">
      <button
        type="button"
        className="reviewer-facepile"
        title={label}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick?.();
        }}
      >
        {reviewers.map((user) => (
          <PersonChip
            key={user.login}
            name={user.login}
            email={`${user.login}@users.noreply.github.com`}
            avatarUrl={user.avatarUrl}
            size={size}
            avatarOnly
            className="reviewer-facepile-item"
            nameClassName="sr-only"
          />
        ))}
      </button>
    </HoverTip>
  );
}

export function RequestReviewDialog({
  row,
  onClose,
}: {
  row: GithubPrRow;
  onClose: () => void;
}) {
  const toast = useToast();
  const menuId = useId();
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typed, setTyped] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<GithubPrAuthor[]>([]);
  const [requestedOverride, setRequestedOverride] = useState<GithubPrAuthor[] | null>(null);
  const requested = requestedOverride ?? row.requestedReviewers ?? [];

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      repo: row.repo,
      number: String(row.number),
    });
    void fetch(`/api/github/prs/reviewers?${params}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as ReviewerContextPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || `Couldn't load reviewers (${res.status})`);
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        if (body.requested) setRequestedOverride(body.requested);
        setSuggested(body.suggested ?? []);
        setSelected([]);
        queueMicrotask(() => inputRef.current?.focus());
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Couldn't load suggested reviewers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.number, row.repo, toast]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const requestedKeys = new Set(requested.map((user) => user.login.toLowerCase()));
  const visibleSuggested = suggested.filter((user) => !requestedKeys.has(user.login.toLowerCase()));

  const toggle = (login: string) => {
    setSelected((current) =>
      current.some((item) => item.toLowerCase() === login.toLowerCase())
        ? current.filter((item) => item.toLowerCase() !== login.toLowerCase())
        : [...current, login],
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const reviewers = [...selected, typed];
    if (reviewers.every((item) => !item.trim())) return;
    setBusy(true);
    try {
      const res = await fetch("/api/github/prs/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: row.repo,
          number: row.number,
          reviewers,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        requested?: GithubPrAuthor[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      const next = body.requested ?? [];
      setRequestedOverride(next);
      setTyped("");
      setSelected([]);
      onClose();
      const names = next.map((user) => user.login).join(", ");
      toast.success(names ? `Requested review from ${names}.` : "Review requested.");
      void mutate("/api/github/prs");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't request reviewers.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      ref={rootRef}
      id={menuId}
      role="dialog"
      aria-label="Request reviewers"
      className="mt-1.5 w-full max-w-xs rounded border p-2 shadow-lg"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => void onSubmit(event)}
    >
      {requested.length > 0 ? (
        <p className="mb-1.5 text-[11px] text-text-muted">
          Already requested: {requested.map((user) => user.login).join(", ")}
        </p>
      ) : null}

      {loading ? (
        <p className="mb-1.5 text-[11px] text-text-subtle">Loading suggestions…</p>
      ) : visibleSuggested.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {visibleSuggested.map((user) => {
            const active = selected.some((item) => item.toLowerCase() === user.login.toLowerCase());
            return (
              <button
                key={user.login}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(user.login)}
                className="rounded px-1.5 py-0.5 text-[11px]"
                style={{
                  border: `1px solid ${active ? "var(--accent)" : "var(--border-muted)"}`,
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: "var(--text)",
                }}
              >
                {user.login}
              </button>
            );
          })}
        </div>
      ) : null}

      <label className="sr-only" htmlFor={`${menuId}-login`}>
        GitHub username
      </label>
      <input
        ref={inputRef}
        id={`${menuId}-login`}
        type="text"
        className="input mb-1.5 w-full font-mono text-[11px]"
        placeholder="username, another"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        className="btn btn-secondary w-full text-[11px]"
        disabled={busy || (!typed.trim() && selected.length === 0)}
      >
        {busy ? "Requesting…" : "Request"}
      </button>
    </form>
  );
}
