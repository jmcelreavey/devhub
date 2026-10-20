import { PageSkeleton } from "@/components/ui/PageSkeleton";

export default function Loading() {
  return <PageSkeleton titleWidth={200} rows={3} rowHeight={144} variant="list" />;
}
