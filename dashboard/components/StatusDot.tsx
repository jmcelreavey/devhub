/**
 * Tiny coloured circle indicating live/dead or ok/error state.
 * Replaces duplicate inline implementations in ops and status pages.
 */
export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: ok ? "var(--success)" : "var(--danger)" }}
      aria-hidden
    />
  );
}
