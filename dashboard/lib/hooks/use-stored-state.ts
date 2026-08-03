"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `useState` that survives remounts by mirroring into localStorage.
 *
 * Reads happen in an effect rather than in the initializer so the first render
 * always matches the server render — reading storage during init would hydrate
 * a different tree than the one Next sent and blow up with a mismatch.
 *
 * Writes are deliberately not debounced by the caller's clock: `RepoSplit`
 * fires on every pointer move, so the write itself is throttled here.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  const writeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      const parsed = parse(raw);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted UI state after mount is the point
      if (parsed !== undefined) setValue(parsed);
    } catch {
      // private mode / corrupt value — keep the fallback
    }
    // Only re-read when the storage key itself changes (e.g. switching repo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => window.clearTimeout(writeTimer.current), []);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => {
        try {
          window.localStorage.setItem(key, serialize(next));
        } catch {
          // quota / private mode — the value still applies for this session
        }
      }, 200);
    },
    [key, serialize],
  );

  return [value, set];
}

const identity = (raw: string) => raw;

/** Persisted pane fraction for a `RepoSplit` gutter. */
export function useStoredFraction(key: string, fallback: number): [number, (value: number) => void] {
  return useStoredState<number>(
    key,
    fallback,
    useCallback((raw) => {
      const n = Number(raw);
      // Guard the stored value: a corrupt or out-of-range entry would otherwise
      // collapse a pane to zero width with no way back except clearing storage.
      return Number.isFinite(n) && n > 0 && n < 1 ? n : undefined;
    }, []),
    useCallback((value: number) => String(value), []),
  );
}

/** Persisted string choice (active tab, mode toggle) restricted to known values. */
export function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  return useStoredState<T>(
    key,
    fallback,
    useCallback((raw) => (allowed.includes(raw as T) ? (raw as T) : undefined), [allowed]),
    identity,
  );
}
