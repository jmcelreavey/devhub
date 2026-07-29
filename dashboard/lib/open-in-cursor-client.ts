/**
 * Client-side "open in Cursor" calls — thin wrappers over the API routes so
 * every button (repo rows, learn panel, dedicated learn screen, lab panels)
 * shares one implementation and one error message.
 */

interface ToastLike {
  error: (message: string) => void;
}

/** Open a cloned repo in Cursor, optionally with a note file in the same launch. */
export async function openRepoInCursor(
  name: string,
  toast: ToastLike,
  notePath?: string,
): Promise<{ writable: boolean } | null> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notePath }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; writable?: boolean };
    if (!res.ok) throw new Error(body.error || `Couldn't open ${name} in Cursor.`);
    return { writable: body.writable === true };
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Couldn't open ${name} in Cursor.`);
    return null;
  }
}

export async function applyCursorNoteDraft(
  name: string,
  notePath: string,
  toast: ToastLike,
): Promise<{ content: unknown; modified?: number } | null> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notePath }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      content?: unknown;
      modified?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error || "Couldn't apply Cursor changes.");
    if (body.content === undefined) throw new Error("Cursor changes were applied but the note could not reload.");
    return { content: body.content, modified: body.modified };
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Couldn't apply Cursor changes.");
    return null;
  }
}

export async function deleteCursorNoteDraft(
  name: string,
  notePath: string,
  toast: ToastLike,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notePath }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error || "Couldn't delete the Cursor working copy.");
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Couldn't delete the Cursor working copy.");
    return false;
  }
}

/** Open a lab's hands-on workspace directory in Cursor (path from the lab record). */
export async function openLabWorkspaceInCursor(category: string, toast: ToastLike): Promise<void> {
  try {
    const res = await fetch("/api/capability/workspace/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error || "open failed");
  } catch (e) {
    toast.error(e instanceof Error && e.message !== "open failed" ? e.message : "Couldn't open the workspace in Cursor.");
  }
}
