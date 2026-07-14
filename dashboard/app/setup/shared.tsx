import type { ReactNode } from "react";

export interface SetupStatus {
  core: boolean;
  github: boolean;
  datadog: boolean;
  calendar: boolean;
  jira: boolean;
  bi: boolean;
  /** When false, dashboard binds to localhost only. */
  allowLanNetwork: boolean;
  /** Whether OPENCHAMBER_UI_PASSWORD is already configured (value never echoed). */
  hasOpenchamberUiPassword?: boolean;
  coreVars: { repoRoot: string; notesDir: string };
  coreDefaults: { repoRoot: string; notesDir: string };
  githubVars: { authenticated: boolean };
  datadogVars: {
    hasApiKey: boolean;
    hasApplicationKey: boolean;
    hasEmail: boolean;
    hasScheduleId: boolean;
    email: string;
    scheduleId: string;
  };
  calendarVars: { hasClientId: boolean; hasClientSecret: boolean; hasRefreshToken: boolean };
  calendarClientIdPreview: string | null;
  calendarClientSecretPreview: string | null;
  jiraVars: { hasDomain: boolean; hasEmail: boolean; hasApiToken: boolean };
  biVars: { awsProfile: string | null; account: string | null; capiRepoPath: string | null };
  agentVars: {
    cli: "opencode" | "cursor";
    opencodeModel: string;
    cursorModel: string;
    cursorAgentInstalled: boolean;
  };
}

export interface PathCheck {
  ok: boolean;
  resolved: string;
  message: string;
  isGitRepo?: boolean;
  hasNotesIndex?: boolean;
}

export interface SetupStepMeta {
  id: string;
  title: string;
  icon: ReactNode;
  description: string;
  configured: boolean;
  optional: boolean;
}

export const SECRET_FIELD_MASK = "••••••••";

export function TipCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: "6px",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        fontSize: "12px",
        color: "var(--text-subtle)",
      }}
    >
      {children}
    </div>
  );
}

export function FeatureCard({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: "12px", color: "var(--text-subtle)" }}>{description}</div>
      </div>
      <span
        style={{
          fontSize: "10px",
          padding: "2px 8px",
          borderRadius: "4px",
          background: "var(--accent-dim)",
          color: "var(--accent)",
          fontWeight: 600,
        }}
      >
        {badge.toUpperCase()}
      </span>
    </div>
  );
}
