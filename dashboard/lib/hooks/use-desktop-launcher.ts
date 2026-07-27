"use client";

import { useCallback } from "react";
import { useToast } from "@/lib/hooks/use-toast";
import { openInBrowser } from "@/lib/desktop/bridge";

/** Generic hook for launching a native desktop app via a POST endpoint. */
export function useDesktopLauncher({ endpoint, appName }: { endpoint: string; appName: string }) {
  const toast = useToast();
  return useCallback(async () => {
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 404 && body?.releasesUrl) {
          toast.error(`${appName} Desktop is not installed.`);
          void openInBrowser(body.releasesUrl as string);
          return;
        }
        toast.error((body?.error as string) ?? `Failed to launch ${appName} Desktop`);
        return;
      }

      if (body?.openUrl) {
        void openInBrowser(body.openUrl as string);
        toast.success(`Opening ${appName}…`);
        return;
      }

      toast.success(`Opening ${appName} Desktop…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to launch ${appName} Desktop`);
    }
  }, [endpoint, appName, toast]);
}
