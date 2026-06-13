import { BootScreen } from "@/components/TodayBootScreen";

/** Route-level loading: the branded boot overlay, not skeletons. */
export default function Loading() {
  return <BootScreen state="loading" />;
}
