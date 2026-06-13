/**
 * Re-mounts on every route navigation (Next.js template semantics), giving
 * each page a single entrance pass — fade + 4px rise, 200ms, one curve.
 * Replaces the old per-`.hub` entrance so all pages (including
 * `.page-wrapper` ones) arrive the same way.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter min-w-0">{children}</div>;
}
