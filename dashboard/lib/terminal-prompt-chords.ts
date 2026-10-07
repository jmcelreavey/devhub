interface ChordEvent { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }

/** ⌘⇧↵ on a Mac, Ctrl+Shift+↵ elsewhere: send the prompt to the agent instead of the shell. */
export function isAskChord(event: ChordEvent): boolean {
  return event.key === "Enter" && event.shiftKey && (event.metaKey || event.ctrlKey);
}
