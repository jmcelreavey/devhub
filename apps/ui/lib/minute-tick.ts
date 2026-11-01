"use client";

/**
 * Kept as a re-export so existing imports keep working. The implementation
 * (and the seconds ticker that shares its refcounting + visibility pausing)
 * lives in `lib/tickers.ts`.
 *
 * New code should use `useMinuteTick()` / `useSecondTick()` from there.
 */
export { subscribeMinute, getNow, useMinuteTick, useSecondTick } from "./tickers";
