export interface NotesChecklistsLinkParams {
  scope?: string;
  notePath?: string;
}

/** Deep link into Notes with the checklists panel open. */
export function notesChecklistsHref(params?: NotesChecklistsLinkParams): string {
  const sp = new URLSearchParams();
  sp.set("panel", "checklists");
  if (params?.scope) sp.set("scope", params.scope);
  if (params?.notePath) sp.set("notePath", params.notePath);
  return `/notes?${sp.toString()}`;
}

export function isNotesChecklistsPanel(searchParams: URLSearchParams): boolean {
  return searchParams.get("panel") === "checklists";
}
