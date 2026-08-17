/**
 * The /cursor route exists so the URL and sidebar link work, but the actual
 * terminal is rendered by <PersistentCursor> in the root layout so the CLI
 * session survives client-side navigation to other pages.
 */
export const metadata = { title: "Cursor" };

export default function CursorPage() {
  return null;
}
