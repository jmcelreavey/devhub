"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  advanceKonami,
  isTypingTarget,
  KONAMI_TIMEOUT_MS,
} from "@/lib/konami-sequence";

/**
 * The game is ~2,000 lines and was previously imported by the root layout,
 * so it shipped in the layout chunk on every route — a Pong easter egg
 * loading on the Datadog page. Now it costs nothing until it is earned.
 *
 * `ssr: false` because it is canvas + Web Audio; there is nothing to
 * pre-render, and it can never be visible on first paint.
 */
const KonamiPong = dynamic(
  () => import("@/components/shell/KonamiPong").then((m) => ({ default: m.KonamiPong })),
  { ssr: false },
);

/**
 * Listens for the Konami code and only then pulls in the game.
 *
 * Once armed we leave it mounted: the import has already been paid for, and
 * KonamiPong owns its own sequence listener, so subsequent plays work without
 * this gate doing anything further.
 */
export function KonamiGate() {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (armed) return;

    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const next = advanceKonami(index, event.key);
      clearTimeout(timer);

      if (next === null) {
        index = 0;
        setArmed(true);
        return;
      }

      index = next;
      if (index > 0) timer = setTimeout(() => (index = 0), KONAMI_TIMEOUT_MS);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, [armed]);

  if (!armed) return null;
  return <KonamiPong autoStart />;
}

export default KonamiGate;
