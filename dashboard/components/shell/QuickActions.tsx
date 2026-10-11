"use client";

import { TerminalDockButton } from "@/components/shell/TerminalDock";
import { TopBarMoreMenu } from "@/components/shell/TopBarMoreMenu";

/**
 * Keep terminal activity visible; panel shortcuts have one home at every width.
 */
export function QuickActions() {
  return (
    <>
      <TerminalDockButton />
      <TopBarMoreMenu />
    </>
  );
}
