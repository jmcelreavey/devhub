"use client";

import { FetchError } from "@/components";

export default function GitHubError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page-wrapper">
      <FetchError message={error.message} onRetry={reset} />
    </div>
  );
}
