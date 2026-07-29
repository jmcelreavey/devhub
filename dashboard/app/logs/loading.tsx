export default function Loading() {
  return (
    <div className="page-wrapper flex flex-col gap-3">
      <div className="h-5 w-24 animate-pulse rounded bg-border-muted" />
      <div className="h-3 w-64 animate-pulse rounded bg-border-muted" />
      <div className="animate-pulse rounded-lg bg-border-muted/40" style={{ minHeight: "min(70vh, 40rem)" }} />
    </div>
  );
}
