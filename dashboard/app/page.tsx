import { TodayViewSwitch } from "@/components/today/TodayViewSwitch";
import { redirect } from "next/navigation";
import { isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { readSetupProgress } from "@/lib/setup/first-run";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";


export default function Home() {
  if (isDesktopRuntime() && !readSetupProgress().completed) redirect("/setup");
  return <TodayViewSwitch />;
}
