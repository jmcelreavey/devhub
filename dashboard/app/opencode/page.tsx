/**
 * The /opencode route exists so the URL and sidebar link work, but the actual
 * iframe is rendered by <PersistentOpenCode> in the root layout so it survives
 * client-side navigation to other pages.
 */
export const metadata = { title: "OpenCode" };

export default function OpenCodePage() {
  return null;
}
