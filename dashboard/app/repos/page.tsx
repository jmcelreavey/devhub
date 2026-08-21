import { Suspense } from "react";
import Client from "./client";
import { BootScreen } from "@/components/today/TodayBootScreen";

export const metadata = { title: "Repos" };


export default function Page() {
  return (
    <Suspense fallback={<BootScreen state="loading" />}>
      <Client />
    </Suspense>
  );
}
