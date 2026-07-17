import { copyTextToClipboard } from "./clipboard";

interface ToastLike {
  error: (message: string) => void;
}

/** Copy context pack markdown. Success is silent — callers already show the result. */
export async function copyContextPackToClipboard(toast: ToastLike): Promise<boolean> {
  try {
    const r = await fetch("/api/context-pack?format=markdown");
    if (!r.ok) throw new Error("Could not build context pack.");
    const data = (await r.json()) as { markdown?: string };
    if (!data.markdown) throw new Error("Empty context pack.");
    await copyTextToClipboard(data.markdown);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Context pack failed.");
    return false;
  }
}
