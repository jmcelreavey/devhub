"use client";

import { createContext, useContext } from "react";

/**
 * Is the surrounding workspace tab panel the visible one?
 *
 * Workspace tabs keep every visited route mounted (see `WorkspaceTabPanels`),
 * so a page you opened once never unmounts — and neither do its pollers. With
 * `useLive` refreshing on a 60s interval, six idle tabs meant six times the API
 * load forever, including the expensive repo route that talks to Jira, Google
 * Calendar and GitHub.
 *
 * Panels publish their visibility here and `useLive` pauses revalidation while
 * hidden. Cached data is still returned, so switching tabs renders instantly
 * and then revalidates.
 *
 * Defaults to `true`: anything not inside a keep-alive panel is visible.
 */
export const PanelVisibilityContext = createContext(true);

export function usePanelVisible(): boolean {
  return useContext(PanelVisibilityContext);
}
