"use client";

import { useEffect, useRef, useState } from "react";
import { useClientMounted } from "@/lib/use-client-mounted";
import { useLive } from "@/lib/use-fetch";
import { Volume2, VolumeX } from "lucide-react";

interface ServicesStatus {
  openchamber?: { active?: boolean };
  opencode?: { active?: boolean };
}

const PREF_KEY = "devhub.agent-soundtrack";

/**
 * Optional Web Audio "Agent Vibes" bed — soft drone when Chamber/OpenCode peers
 * are active. Off by default; toggle persists in localStorage.
 */
function readPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function AgentSoundtrack() {
  // false during SSR/hydration, then the stored pref — no effect, no mismatch.
  const mounted = useClientMounted();
  const [pref, setPref] = useState<boolean | null>(null);
  const enabled = pref ?? (mounted && readPref());
  const { data } = useLive<ServicesStatus>("/api/status/services", {
    refreshInterval: enabled ? 15_000 : 0,
  });
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode[]>([]);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    const active = Boolean(data?.openchamber?.active || data?.opencode?.active);
    if (active) start();
    else stop();
    return () => stop();
  }, [enabled, data?.openchamber?.active, data?.opencode?.active]);

  function stop() {
    for (const o of oscRef.current) {
      try {
        o.stop();
      } catch {
        /* ignore */
      }
    }
    oscRef.current = [];
    if (gainRef.current) {
      try {
        gainRef.current.gain.setTargetAtTime(0, ctxRef.current?.currentTime ?? 0, 0.2);
      } catch {
        /* ignore */
      }
    }
  }

  function start() {
    if (typeof window === "undefined") return;
    if (oscRef.current.length) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = ctxRef.current ?? new Ctx();
    ctxRef.current = ctx;
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.03;
    master.connect(ctx.destination);
    gainRef.current = master;
    // Two soft sine tones — calm, not a ringtone
    for (const freq of [110, 164.81]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(master);
      osc.start();
      oscRef.current.push(osc);
    }
  }

  function toggle() {
    const next = !enabled;
    setPref(next);
    try {
      localStorage.setItem(PREF_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!next) stop();
  }

  const peersUp = Boolean(data?.openchamber?.active || data?.opencode?.active);
  const title = !enabled
    ? "Agent soundtrack off"
    : peersUp
      ? "Agent soundtrack on (click to mute)"
      : "Soundtrack on — quiet until Chamber/OpenCode peers are up";

  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={toggle}
      title={title}
      aria-pressed={enabled}
      aria-label="Toggle agent soundtrack"
    >
      {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
    </button>
  );
}
