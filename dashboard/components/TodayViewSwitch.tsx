"use client";

import { useTodayView } from "@/lib/today-view";
import { useClientMounted } from "@/lib/use-client-mounted";
import { TodayFocusView } from "@/components/TodayFocusView";
import { TodayPage } from "@/components/TodayPage";
import { TodayBootScreen } from "@/components/TodayBootScreen";

/**
 * Picks the Today view: Calm Focus (design B, default) or the dashboard
 * grid (A+B combo). Mount-gated so SSR and the first client render agree
 * before localStorage is consulted. The pre-mount frame shows the boot
 * screen, which the chosen view then continues seamlessly — one loading
 * moment, no skeleton flash before it.
 */
export function TodayViewSwitch() {
  const [view] = useTodayView();
  const mounted = useClientMounted();

  if (!mounted) {
    return <TodayBootScreen state="loading" />;
  }

  return view === "focus" ? <TodayFocusView /> : <TodayPage />;
}
