"use client";

import { useTodayView } from "@/lib/today/view";
import { useClientMounted } from "@/lib/hooks/use-client-mounted";
import { TodayFocusView } from "@/components/today/TodayFocusView";
import { TodayPage } from "@/components/today/TodayPage";
import { TodayBootScreen } from "@/components/today/TodayBootScreen";
import { WhileYouWereAway } from "@/components/briefing/WhileYouWereAway";

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

  return (
    <>
      {/*
        Above both views, because an overnight failure is the first thing you
        should see on opening the app. Renders nothing at all unless something
        actually failed, so it costs no space on a normal morning.
      */}
      <div className="px-4 pt-3">
        <WhileYouWereAway />
      </div>
      {view === "focus" ? <TodayFocusView /> : <TodayPage />}
    </>
  );
}
