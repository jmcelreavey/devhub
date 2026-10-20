"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { legacyTodayHref } from "@/lib/home-redirect";

/** Hashes never reach the server; keep old section bookmarks useful too. */
export function LegacyTodayRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const search = params.toString();
  useEffect(() => {
    const redirect = () => {
      const href = legacyTodayHref(search, window.location.hash);
      if (href) router.replace(href, { scroll: false });
    };
    redirect();
    window.addEventListener("hashchange", redirect);
    return () => window.removeEventListener("hashchange", redirect);
  }, [router, search]);
  return null;
}
