/**
 * The /claude route exists so the URL and sidebar link work, but the actual
 * terminal is rendered by <PersistentClaude> in the root layout so the CLI
 * session survives client-side navigation to other pages.
 */
export const metadata = { title: "Claude" };

export default function ClaudePage() {
  return null;
}
