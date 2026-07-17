import { Suspense } from "react";
import Client from "./client";
import { BootScreen } from "@/components/TodayBootScreen";

export default function Page() {
  return (
    <Suspense fallback={<BootScreen state="loading" />}>
      <Client />
    </Suspense>
  );
}
