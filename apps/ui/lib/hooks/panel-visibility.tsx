"use client";

import { createContext, useContext } from "react";

/**
 * Is the surrounding workspace tab panel the visible one?
 *
 * Inactive workspace tabs unmount, so their pollers die with them. This
 * context is for anything that stays mounted while hidden (overlays, docks).
 * `useLive` pauses revalidation while hidden.
 *
 * Defaults to `true`: anything not inside a hidden panel is visible.
 */
export const PanelVisibilityContext = createContext(true);

export function usePanelVisible(): boolean {
  return useContext(PanelVisibilityContext);
}
