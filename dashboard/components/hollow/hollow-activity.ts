const EDITING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], .xterm, .cm-editor, .monaco-editor, .bn-root';

/** Keep ambient work asleep for the whole editing session, including IME composition. */
export function hollowActivityPaused(): boolean {
  return document.hidden || Boolean(document.activeElement?.closest(EDITING));
}

export function observeHollowActivity(onChange: () => void): () => void {
  let active = true;
  // focusout fires before activeElement points at the next control.
  const blur = () => { void Promise.resolve().then(() => { if (active) onChange(); }); };
  document.addEventListener("visibilitychange", onChange);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", blur);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", onChange);
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", blur);
  };
}
