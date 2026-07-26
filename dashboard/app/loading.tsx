import { BootScreen } from "@/components/today/TodayBootScreen";

/** Route-level loading: the branded boot overlay, not skeletons. */
export default function Loading() {
  return <BootScreen state="loading" />;
}
