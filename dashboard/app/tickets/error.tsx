"use client";

import { RotateCw } from "lucide-react";

export default function TicketsError({ reset }: { reset: () => void }) {
  return (
    <div className="page-wrapper">
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Couldn&apos;t load Jira tickets
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>
          Check that <code>JIRA_DOMAIN</code>, <code>JIRA_EMAIL</code>, and{" "}
          <code>JIRA_API_TOKEN</code> are set in <code>.env.local</code>, and that the API token
          is still valid.
        </p>
        <button type="button" className="btn btn-primary mt-3" onClick={reset}>
          <RotateCw size={13} aria-hidden /> Retry
        </button>
      </div>
    </div>
  );
}
