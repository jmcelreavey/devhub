export function LoadingLine({ message = "Loading…" }: { message?: string }) {
  return (
    <p className="text-sm py-2" style={{ color: "var(--text-subtle)" }}>
      {message}
    </p>
  );
}
