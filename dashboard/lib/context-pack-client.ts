interface ToastLike {
  success: (message: string) => void;
  error: (message: string) => void;
}

export async function copyContextPackToClipboard(
  toast: ToastLike,
  options?: { successMessage?: string },
): Promise<boolean> {
  try {
    const r = await fetch("/api/context-pack?format=markdown");
    if (!r.ok) throw new Error("Could not build context pack.");
    const data = (await r.json()) as { markdown?: string };
    if (!data.markdown) throw new Error("Empty context pack.");
    await navigator.clipboard.writeText(data.markdown);
    toast.success(options?.successMessage ?? "Context pack copied.");
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Context pack failed.");
    return false;
  }
}
