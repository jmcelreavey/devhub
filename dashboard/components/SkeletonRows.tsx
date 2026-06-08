interface SkeletonRowsProps {
  count?: number;
  height?: number;
}

export function SkeletonRows({ count = 3, height = 60 }: SkeletonRowsProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, borderRadius: "var(--radius)" }} />
      ))}
    </div>
  );
}
