"use client";

import { useMemo } from "react";
import { useLive } from "./use-fetch";
import { asFailure, getJson } from "@/app/plugins/api";
import { ALL_NAV_DESTINATIONS, sectionTabs, type PluginNavDestination } from "../../../../packages/shared/ui-lib/navigation/nav";

/** useLive follows the existing plugin event stream, including CLI replacements. */
export function usePluginNav() {
  const result = useLive<{ items: PluginNavDestination[]; errors: string[] }>("/api/plugins/navigation", {
    fetcher: getJson,
    shouldRetryOnError: (error: unknown) => ![401, 403].includes(asFailure(error).status),
  });
  const status = result.error ? asFailure(result.error).status : 0;
  const errorMessage = status === 401 ? "Plugin links unavailable: authentication required (401)."
    : status === 403 ? "Plugin links unavailable: access denied (403)."
      : "Plugin links unavailable.";
  const nav = useMemo(() => {
    const items = result.error ? [] : result.data?.items ?? [];
    return { items, destinations: [...ALL_NAV_DESTINATIONS, ...items], sections: sectionTabs(items),
      warnings: result.data?.errors ?? [] };
  }, [result.data, result.error]);
  return { ...result, ...nav, errorMessage };
}
