"use client";

import { useLive } from "@/lib/use-fetch";

interface NotesAiStatus {
  configured: boolean;
}

/**
 * Whether in-editor AI is available. Pass `configured` from the server when you
 * have it to avoid a loading frame; otherwise fetches `/api/notes/ai/status`.
 */
export function useNotesAiConfigured(configuredFromServer?: boolean): {
  configured: boolean;
  ready: boolean;
} {
  const { data, isLoading } = useLive<NotesAiStatus>(
    configuredFromServer === undefined ? "/api/notes/ai/status" : null,
  );

  if (configuredFromServer !== undefined) {
    return { configured: configuredFromServer, ready: true };
  }

  return {
    configured: data?.configured === true,
    ready: !isLoading,
  };
}
