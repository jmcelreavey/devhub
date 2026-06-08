"use client";

import { useEffect } from "react";
import { ShortcutsModal, useShortcutsModal } from "./ShortcutsModal";

export function DashboardShell() {
  const shortcuts = useShortcutsModal();

  useEffect(() => {
    const handler = () => shortcuts.show();
    window.addEventListener("shortcuts:toggle", handler);
    return () => window.removeEventListener("shortcuts:toggle", handler);
  }, [shortcuts]);

  return (
    <>
      <ShortcutsModal open={shortcuts.open} onClose={shortcuts.hide} />
    </>
  );
}
