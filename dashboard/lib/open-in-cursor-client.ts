/**
 * Client-side "open in Cursor" calls — thin wrappers over the API routes so
 * every button (repo rows, learn panel, dedicated learn screen, lab panels)
 * shares one implementation and one error message.
 */

interface ToastLike {
  error: (message: string) => void;
  success?: (message: string) => void;
  info?: (message: string) => void;
}

export async function getCursorNoteDraft(name: string, notePath: string): Promise<{
  writable: boolean;
} | null> {
  try {
    const params = new URLSearchParams({ notePath });
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open?${params}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { draft?: { writable?: boolean } | null };
    if (typeof body.draft?.writable !== "boolean") return null;
    return { writable: body.draft.writable };
  } catch {
    return null;
  }
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

export interface OpenPrInCursorResult {
  writable: boolean;
  branch: string;
  stashed: boolean;
  alreadyOnBranch: boolean;
  localRepoName: string;
}

/** Stash if dirty, check out the PR branch, then open the clone in Cursor. */
export async function openPrInCursor(
  repo: string,
  number: number,
  toast: ToastLike,
  notePath?: string,
): Promise<OpenPrInCursorResult | null> {
  try {
    const res = await fetch("/api/github/prs/open-in-cursor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, number, notePath }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      writable?: boolean;
      branch?: string;
      stashed?: boolean;
      alreadyOnBranch?: boolean;
      localRepoName?: string;
    };
    if (!res.ok) throw new Error(body.error || `Couldn't open ${repo}#${number} in Cursor.`);
    const result: OpenPrInCursorResult = {
      writable: body.writable === true,
      branch: body.branch || "",
      stashed: body.stashed === true,
      alreadyOnBranch: body.alreadyOnBranch === true,
      localRepoName: body.localRepoName || "",
    };
    const branch = result.branch ? ` ${result.branch}` : "";
    if (result.alreadyOnBranch) {
      toast.success?.(`Already on${branch}. Opened in Cursor.`);
    } else if (result.stashed) {
      toast.success?.(`Stashed local changes, checked out${branch}, opened in Cursor.`);
    } else {
      toast.success?.(`Checked out${branch}. Opened in Cursor.`);
    }
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Couldn't open ${repo}#${number} in Cursor.`);
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

/**
 * Open a repo in Cursor with a working-tree file, or a materialized historical
 * revision (`commit:path`) alongside the live tree. Shared by History / Blame
 * via `RepoFileOpenMenu`.
 *
 * Signature mirrors `openRepoInCursor(name, toast, notePath?)`.
 */
export async function openRepoFileInCursor(
  name: string,
  toast: ToastLike,
  filePath: string,
  commit?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath, commit }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; shortHash?: string };
    if (!res.ok) throw new Error(body.error || `Couldn't open ${filePath} in Cursor.`);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Couldn't open ${filePath} in Cursor.`);
    return false;
  }
}

/** Open a cloned repo in GitKraken Desktop (whole repo — no file-at-revision). */
export async function openRepoInGitKraken(name: string, toast: ToastLike): Promise<boolean> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open-gitkraken`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error || `Couldn't open ${name} in GitKraken.`);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Couldn't open ${name} in GitKraken.`);
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
