/**
 * Client-side "open in Cursor" calls — thin wrappers over the API routes so
 * every button (repo rows, learn panel, dedicated learn screen, lab panels)
 * shares one implementation and one error message.
 */

interface ToastLike {
  error: (message: string) => void;
}

/** Open a cloned repo in Cursor (server resolves the path by name). */
export async function openRepoInCursor(name: string, toast: ToastLike): Promise<void> {
  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
  } catch {
    toast.error(`Couldn't open ${name} in Cursor.`);
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
