/**
 * The gentle nudge to back notes and tasks up to a private repo.
 *
 * Content lives in app data until a repo is connected, which is a fine place to
 * start and a poor place to stay: one disk, no history, no second machine. The
 * nudge waits until setup is finished (never mid-wizard), disappears once a
 * repo is linked, and stays gone after "Not now".
 */
export function shouldRemindContentRepo(state: { desktop: boolean; completed: boolean; dismissed: boolean; linked: boolean }): boolean {
  return state.desktop && state.completed && !state.dismissed && !state.linked;
}
