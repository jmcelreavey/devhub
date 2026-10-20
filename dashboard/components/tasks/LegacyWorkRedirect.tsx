"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { legacyWorkUrl } from "@/lib/tasks/legacy-work-url";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

export function LegacyWorkRedirect({ tab }: { tab: "tasks" | "jira" }) {
  const router = useRouter();
  const search = useSearchParams().toString();
  useEffect(() => {
    router.replace(legacyWorkUrl(search, tab, window.location.hash), { scroll: false });
  }, [router, search, tab]);
  return <div className="page-wrapper" aria-busy="true" aria-label="Opening Tasks">
    <SkeletonRows count={3} height={40} />
    <Link className="btn btn-ghost" href={legacyWorkUrl(search, tab)}>Open Tasks</Link>
  </div>;
}
