import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { PluginsPage } from "./client";
import "./plugins.css";

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PluginsPage />
    </Suspense>
  );
}
