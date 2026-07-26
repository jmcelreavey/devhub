"use client";

import { GoalPicker } from "@/components/setup/GoalPicker";
import type { GoalId } from "@/lib/setup/goals";
import { GoogleSetupSteps } from "@/components/setup/GoogleSetupSteps";
import { useState, useEffect } from "react";
import Link from "next/link";
import { FieldError } from "@/components/ui/FieldError";
import { FeatureCard, TipCard, type PathCheck, type SetupStatus, type SetupStepMeta } from "./shared";
import { FormField } from "./FormField";
import { desktopInfo } from "@/lib/desktop/bridge";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  MonitorDown,
  RotateCcw,
} from "lucide-react";

type Step = SetupStepMeta;

export function isStepComplete(step: Step, status: SetupStatus): boolean {
  if (step.id === "paths") return status.core;
  if (step.id === "github") return status.github;
  if (step.id === "datadog") return status.datadog;
  if (step.id === "calendar") return status.calendar;
  if (step.id === "jira") return status.jira;
  if (step.id === "bi") return status.bi;
  return true;
}


export function WelcomeStep({
  allowLan,
  onAllowLanChange,
  chamberUiPassword,
  onChamberUiPasswordChange,
  hasExistingPassword,
  goals,
  onGoalsChange,
}: {
  allowLan: boolean;
  onAllowLanChange: (v: boolean) => void;
  chamberUiPassword: string;
  onChamberUiPasswordChange: (v: string) => void;
  hasExistingPassword: boolean;
  goals: GoalId[];
  onGoalsChange: (next: GoalId[]) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", marginBottom: "8px" }}>
        Welcome to DevHub
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "14px", lineHeight: 1.6, marginBottom: "16px" }}>
        Your personal developer dashboard. Tell us what you want it for and we&apos;ll only ask
        about the parts you need.
      </p>

      {/*
        Asked first because it decides how long the rest of setup is. Someone
        who wants notes and tasks was previously walked through Datadog, Jira
        and cloud infrastructure before reaching anything they cared about.
      */}
      <div style={{ marginBottom: "24px" }}>
        <GoalPicker selected={goals} onChange={onGoalsChange} />
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          padding: "12px 14px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          marginBottom: "20px",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={allowLan}
          onChange={(e) => onAllowLanChange(e.target.checked)}
          style={{ marginTop: "3px" }}
        />
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
            Allow access from other devices on my network
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5, marginTop: "4px" }}>
            When enabled, DevHub keeps localhost working and exposes selected ports on your non-Tailscale LAN IP.
            Uncheck to restrict to this machine only (<code style={{ fontSize: "11px" }}>127.0.0.1</code>). Writes{" "}
            <code style={{ fontSize: "11px" }}>DEVHUB_BIND_HOST</code>,{" "}
            <code style={{ fontSize: "11px" }}>DEVHUB_LAN_PROXY_HOST</code>, and peer host settings in{" "}
            <code style={{ fontSize: "11px" }}>.env.local</code> - restart the dev server after changing.
          </div>
        </div>
      </label>
      {allowLan && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            marginBottom: "20px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
            OpenChamber UI password
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5, marginTop: "4px", marginBottom: "10px" }}>
            Required before exposing OpenChamber through the LAN proxy. Saved as <code style={{ fontSize: "11px" }}>OPENCHAMBER_UI_PASSWORD</code>.
            {hasExistingPassword && " A password is already configured; leave blank to keep it."}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={chamberUiPassword}
              onChange={(e) => onChamberUiPasswordChange(e.target.value)}
              placeholder={hasExistingPassword ? "•••••••• (unchanged)" : "Enter or generate a password"}
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "13px",
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
            <button
              type="button"
              onClick={() => {
                const bytes = new Uint8Array(18);
                crypto.getRandomValues(bytes);
                const pw = btoa(String.fromCharCode(...bytes))
                  .replace(/[+/=]/g, "")
                  .slice(0, 24);
                onChamberUiPasswordChange(pw);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Generate
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <FeatureCard
          title="Core paths"
          description="Auto-inferred from your devhub checkout (optional to customize)"
          badge="Auto"
        />
        <FeatureCard
          title="GitHub"
          description="Recommended: authenticate GitHub CLI to unlock repo features"
          badge="Recommended"
        />
        <FeatureCard
          title="Datadog"
          description="Recommended: enable observability and troubleshooting skills"
          badge="Recommended"
        />
        <FeatureCard
          title="Google Calendar"
          description="Recommended: see today's events at a glance"
          badge="Recommended"
        />
        <FeatureCard
          title="Jira Cloud"
          description="Optional: track your active tickets and priorities"
          badge="Optional"
        />
      </div>
      <p style={{ color: "var(--text-subtle)", fontSize: "12px", marginTop: "20px" }}>
        Core paths are inferred automatically from your repo. GitHub, Datadog, and Calendar are recommended, and Jira remains optional.
      </p>
    </div>
  );
}


export function GitHubStep({
  configured,
  checking,
  onCheckConnection,
  error,
}: {
  configured: boolean;
  checking: boolean;
  onCheckConnection: () => void;
  error: string;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        GitHub
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
        DevHub uses your local GitHub CLI session for repo workflows. Authenticate via{" "}
        <code style={{ fontSize: "11px" }}>gh auth login</code>, then check connection below.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          borderRadius: "8px",
          background: configured ? "var(--accent-dim)" : "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}
      >
        {configured ? <CheckCircle2 size={18}  className="text-accent" /> : <Circle size={18} />}
        <span style={{ fontSize: "13px", color: configured ? "var(--accent)" : "var(--text-subtle)", fontWeight: 500 }}>
          {configured ? "GitHub CLI is connected" : "GitHub CLI is not connected yet"}
        </span>
      </div>
      <button
        type="button"
        onClick={onCheckConnection}
        disabled={checking}
        className="btn btn-primary mt-3.5"
      >
        {checking ? "Checking..." : "Check connection"}
      </button>
      {error && (
        <FieldError>{error}</FieldError>
      )}
    </div>
  );
}

/**
 * Infra step. Read-only — the actual sign-in / cloud / database / shell controls
 * live on /ops (provided by an infra plugin when installed). This step just surfaces
 * whether the dashboard process has a working AWS session and links out for the flow.
 */

export function InfraStep({
  configured,
  awsProfile,
  account,
  checking,
  onCheckConnection,
  capiRepoPath,
  onCapiRepoPathChange,
}: {
  configured: boolean;
  awsProfile: string | null;
  account: string | null;
  checking: boolean;
  onCheckConnection: () => void;
  capiRepoPath: string;
  onCapiRepoPathChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Infrastructure
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
        Optional infrastructure helpers, surfaced on the Ops page when an infra plugin is
        installed: AWS sign-in, service lookup, Kubernetes context setup, database connection
        strings, a script runner, and remote-shell commands. Skip this step if you don&apos;t need them.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          borderRadius: "8px",
          background: configured ? "var(--accent-dim)" : "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}
      >
        {configured ? <CheckCircle2 size={18}  className="text-accent" /> : <Circle size={18} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "13px",
              color: configured ? "var(--accent)" : "var(--text-subtle)",
              fontWeight: 500,
            }}
          >
            {account
              ? `AWS session active${awsProfile ? ` (${awsProfile})` : ""}`
              : configured
                ? `AWS profile found${awsProfile ? ` (${awsProfile})` : ""}`
                : "No AWS profile found"}
          </div>
          {configured && account && (
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", fontFamily: "monospace" }}>
              Account: {account}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: "16px" }}>
        <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>
          Script repo path <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>(optional - enables script discovery)</span>
        </label>
        <p style={{ fontSize: "11px", color: "var(--text-subtle)", marginBottom: "8px", lineHeight: 1.5 }}>
          Absolute path to a local script repo. Enables the Scripts panel on the Ops page to discover
          and run <code>scripts/**/main.ts</code> and <code>mongo/**/*.js</code>.
        </p>
        <input
          type="text"
          value={capiRepoPath}
          onChange={(e) => onCapiRepoPathChange(e.target.value)}
          placeholder="e.g. ~/dev/scripts"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "13px",
            fontFamily: "monospace",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
        <Link
          href="/ops"
          className="btn btn-primary"
        >
          Open Ops page <ExternalLink size={12} />
        </Link>
        <button
          type="button"
          onClick={onCheckConnection}
          disabled={checking}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: checking ? "var(--text-muted)" : "var(--text)",
            cursor: checking ? "default" : "pointer",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {checking ? "Checking…" : "Check connection"}
        </button>
      </div>
      <p style={{ fontSize: "11px", color: "var(--text-subtle)", marginTop: "12px", lineHeight: 1.5 }}>
        Sign in from <strong>Ops → AWS Profile</strong>, then return here and click{" "}
        <em>Check connection</em>. Requires{" "}
        <code style={{ fontSize: "11px" }}>aws</code>,{" "}
        <code style={{ fontSize: "11px" }}>gimme-aws-creds</code>, and{" "}
        <code style={{ fontSize: "11px" }}>tailscale</code> on PATH.
      </p>
    </div>
  );
}


export interface PathsForm {
  repoRoot: string;
  notesDir: string;
  reposDir: string;
}

/**
 * Choose where your code lives.
 *
 * This step used to be called "Core paths" and led with a field labelled
 * "Repo root" whose own hint said "the folder that contains your
 * repositories" — two different things under one name. It saved to
 * `REPO_ROOT`, which is the DevHub checkout, so following the hint pointed
 * DevHub at the wrong directory entirely.
 *
 * They are now separate. The code folder is the question a new user can
 * actually answer, and it is the only one on this step by default. The DevHub
 * checkout is an advanced setting that most installed users do not have and
 * should never be asked about.
 */
export function PathsStep({
  form,
  setForm,
  checks,
  defaults,
  error,
  desktop = false,
  hasCheckout = true,
  onBrowse,
}: {
  form: PathsForm;
  setForm: (f: PathsForm) => void;
  checks: { repoRoot: PathCheck | null; notesDir: PathCheck | null; reposDir: PathCheck | null };
  defaults: PathsForm;
  error: string;
  desktop?: boolean;
  hasCheckout?: boolean;
  onBrowse?: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const reposCheck = checks.reposDir;

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Choose your code folder
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "20px", lineHeight: 1.5 }}>
        The folder your projects live in. DevHub looks one level inside it for Git repositories —
        it never writes anything there.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <PathField
          label="Code folder"
          value={form.reposDir}
          onChange={(v) => setForm({ ...form, reposDir: v })}
          placeholder={defaults.reposDir}
          check={reposCheck}
          onUseDefault={() => setForm({ ...form, reposDir: defaults.reposDir })}
          hint="For example ~/Developer or ~/code. Leave it empty if you're only here for notes and tasks."
          onBrowse={onBrowse}
        />

        <PathField
          label="Notes directory"
          value={form.notesDir}
          onChange={(v) => setForm({ ...form, notesDir: v })}
          placeholder={defaults.notesDir}
          check={checks.notesDir}
          onUseDefault={() => setForm({ ...form, notesDir: defaults.notesDir })}
          hint={
            desktop
              ? "Where DevHub stores your notes. Kept outside the app so updates never touch it."
              : "Where DevHub stores notes and learnings. Defaults to notes/ inside this repo."
          }
        />
      </div>

      {/*
        The checkout path is hidden behind a disclosure and only offered when
        one plausibly exists. An installed app has no checkout, and presenting
        an empty required-looking field for something the user cannot provide
        is how a setup screen teaches people that it is broken.
      */}
      {(hasCheckout || !desktop) && (
        <div style={{ marginTop: "20px" }}>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {showAdvanced ? "Hide" : "Show"} advanced settings
          </button>

          {showAdvanced && (
            <div style={{ marginTop: "14px" }}>
              <PathField
                label="DevHub checkout (optional)"
                value={form.repoRoot}
                onChange={(v) => setForm({ ...form, repoRoot: v })}
                placeholder={defaults.repoRoot}
                check={checks.repoRoot}
                onUseDefault={() => setForm({ ...form, repoRoot: defaults.repoRoot })}
                hint="Only needed for syncing and shipping DevHub itself. Leave empty unless you have a Git clone of DevHub."
              />
            </div>
          )}
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}


export function PathField({
  label,
  value,
  onChange,
  placeholder,
  check,
  onUseDefault,
  hint,
  onBrowse,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  check: PathCheck | null;
  onUseDefault: () => void;
  hint: string;
  /**
   * Native folder picker, when the shell provides one.
   *
   * Absent in browser mode, and the typed input stays either way — the picker
   * is an affordance on top of the field, never a replacement for it. That
   * keeps one code path working in both runtimes instead of two that diverge.
   */
  onBrowse?: () => void;
}) {
  const status = check?.ok === true ? "ok" : check?.ok === false ? "err" : "idle";
  const statusColor =
    status === "ok" ? "var(--success)" : status === "err" ? "var(--danger)" : "var(--text-muted)";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "6px",
        }}
      >
        <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
          {label}
        </label>
        {value !== placeholder && placeholder && (
          <button
            type="button"
            onClick={onUseDefault}
            style={{
              fontSize: "11px",
              color: "var(--accent)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Use default
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 12px",
            borderRadius: "8px",
            border: `1px solid ${status === "err" ? "var(--danger)" : "var(--border)"}`,
            background: "var(--bg-elevated)",
            color: "var(--text)",
            fontSize: "13px",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "monospace",
          }}
          onFocus={(e) => {
            if (status !== "err") e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = status === "err" ? "var(--danger)" : "var(--border)";
          }}
        />
        {onBrowse && (
          <button
            type="button"
            onClick={onBrowse}
            className="btn"
            style={{ flexShrink: 0, fontSize: "12px", whiteSpace: "nowrap" }}
          >
            Browse…
          </button>
        )}
      </div>
      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: 1.4 }}>
        {hint}
      </p>
      {check && (
        <p style={{ fontSize: "11px", color: statusColor, marginTop: "4px", lineHeight: 1.4 }}>
          {status === "ok" ? "✓ " : status === "err" ? "✗ " : ""}
          {check.message}
        </p>
      )}
    </div>
  );
}


export function DatadogStep({
  form,
  setForm,
  showSecrets,
  toggleSecret,
  configured,
  hasApiKey,
  hasApplicationKey,
  hasEmail,
  hasScheduleId,
  checking,
  onCheckConnection,
  error,
}: {
  form: { apiKey: string; applicationKey: string; email: string; scheduleId: string };
  setForm: (f: { apiKey: string; applicationKey: string; email: string; scheduleId: string }) => void;
  showSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  configured: boolean;
  hasApiKey: boolean;
  hasApplicationKey: boolean;
  hasEmail: boolean;
  hasScheduleId: boolean;
  checking: boolean;
  onCheckConnection: () => void;
  error: string;
}) {
  const checkLine = (done: boolean, text: string, primary = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: primary ? 0 : "26px" }}>
      {done ? (
        <CheckCircle2 size={primary ? 18 : 16}  className="text-accent" />
      ) : (
        <Circle size={primary ? 18 : 16} />
      )}
      <span
        style={{
          fontSize: primary ? "13px" : "12px",
          color: done ? "var(--accent)" : "var(--text-subtle)",
          fontWeight: primary ? 500 : 400,
        }}
      >
        {text}
      </span>
    </div>
  );

  const statusRow = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 16px",
        borderRadius: "8px",
        marginTop: "16px",
        background: configured ? "var(--accent-dim)" : "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      {checkLine(
        configured,
        configured ? "Datadog API credentials saved" : "Needs Datadog API credentials",
        true,
      )}
      {checkLine(hasApiKey, hasApiKey ? "API key saved" : "No API key yet")}
      {checkLine(
        hasEmail,
        hasEmail ? "Work email set - on-call detection can match you" : "No work email yet - on-call matching is disabled",
      )}
      {checkLine(
        hasApplicationKey,
        hasApplicationKey
          ? "Application key saved - DevHub can call the Events / On-Call APIs"
          : "No application key yet - deep links work; counts + on-call detection need it",
      )}
      {checkLine(
        true,
        hasScheduleId
          ? "On-call schedule pinned by ID (override)"
          : "On-call schedules auto-discovered from your email",
      )}
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Datadog
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
        Datadog treats these as two different keys: the <strong style={{ fontWeight: 600 }}>API key</strong> is
        org-wide (ingest / agents / many integrations). The <strong style={{ fontWeight: 600 }}>application key</strong>{" "}
        is user-scoped and is what their <strong style={{ fontWeight: 600 }}>REST read APIs</strong> (including Events
        search) expect <strong style={{ fontWeight: 600 }}>together</strong> with the API key - an API key alone does
        not grant that read path. Skills only need the API key; DevHub&apos;s 24h counts need both.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {!hasApiKey ? (
          <FormField
            label="API Key"
            value={form.apiKey}
            onChange={(v) => setForm({ ...form, apiKey: v })}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            secret={!showSecrets["datadog-api-key"]}
            onToggleSecret={() => toggleSecret("datadog-api-key")}
            hint="From Datadog Organization Settings → API Keys."
          />
        ) : (
          <FormField
            label="Replace API key"
            value={form.apiKey}
            onChange={(v) => setForm({ ...form, apiKey: v })}
            placeholder="Paste a new key to replace"
            secret={!showSecrets["datadog-api-key"]}
            onToggleSecret={() => toggleSecret("datadog-api-key")}
            hint="From Datadog Organization Settings → API Keys."
          />
        )}
        <FormField
          label="Work email (optional - for on-call match)"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="you@company.com"
          hint="DevHub matches this against the Datadog on-call schedule. Shared with the ops integration (BI_OPS_USER_EMAIL)."
        />
        <FormField
          label={hasApplicationKey ? "Replace application key" : "Application key (for counts + on-call)"}
          value={form.applicationKey}
          onChange={(v) => setForm({ ...form, applicationKey: v })}
          placeholder={hasApplicationKey ? "Paste a new key to replace" : "Organization Settings → Application Keys"}
          secret={!showSecrets["datadog-app-key"]}
          onToggleSecret={() => toggleSecret("datadog-app-key")}
          hint="Used with your API key for the Events search + On-Call read APIs, only on this machine."
        />
        <FormField
          label="On-call schedule ID (optional - advanced override)"
          value={form.scheduleId}
          onChange={(v) => setForm({ ...form, scheduleId: v })}
          placeholder="Leave blank to auto-discover from your email"
          hint="DevHub finds your on-call schedules automatically via your work email. Only pin an ID (or comma-separated IDs) to scope detection in a large org. Saved as DATADOG_ONCALL_SCHEDULE_ID."
        />
      </div>
      {statusRow}
      <button
        type="button"
        onClick={onCheckConnection}
        disabled={checking}
        className="btn btn-primary mt-3.5"
      >
        {checking ? "Checking..." : "Check connection"}
      </button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}


export function CalendarStep({
  form,
  setForm,
  configured,
  banner,
  connectBusy,
  canConnectOAuth,
  onConnectGoogle,
  checking,
  onCheckConnection,
  error,
}: {
  form: { clientId: string; clientSecret: string };
  setForm: (f: { clientId: string; clientSecret: string }) => void;
  configured: boolean;
  banner: string;
  connectBusy: boolean;
  canConnectOAuth: boolean;
  onConnectGoogle: () => void;
  checking: boolean;
  onCheckConnection: () => void;
  error: string;
}) {
  const signInButton = (marginTop: string) => (
    <button
      type="button"
      onClick={onConnectGoogle}
      disabled={!canConnectOAuth || connectBusy}
      className="btn btn-primary"
      style={{ marginTop }}
    >
      {connectBusy ? "Starting…" : "Sign in with Google"}
    </button>
  );

  const checkConnectionButton = (marginTop: string) => (
    <button
      type="button"
      onClick={onCheckConnection}
      disabled={checking}
      className="btn btn-primary"
      style={{ marginTop }}
    >
      {checking ? "Checking..." : "Check connection"}
    </button>
  );

  if (configured) {
    return (
      <div>
        <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "8px" }}>
          Google Calendar
        </h2>
        {banner ? (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              background: "var(--accent-dim)",
              color: "var(--accent)",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          >
            {banner}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            borderRadius: "8px",
            background: "var(--accent-dim)",
            border: "1px solid var(--border)",
            marginTop: "12px",
          }}
        >
          <CheckCircle2 size={18}  className="text-accent" />
          <span style={{ fontSize: "13px", color: "var(--accent)", fontWeight: 500 }}>
            Calendar is connected
          </span>
        </div>
        <p style={{ color: "var(--text-subtle)", fontSize: "12px", marginTop: "16px", lineHeight: 1.5 }}>
          Client credentials and refresh token live in <code style={{ fontSize: "11px" }}>.env.local</code>. Use Sign
          in again if Google revoked access or you need a fresh consent screen. To remove Calendar from DevHub, delete
          the Google entries in <code style={{ fontSize: "11px" }}>.env.local</code>.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginTop: "16px" }}>
          {signInButton("0")}
          {checkConnectionButton("0")}
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Google Calendar
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "14px", lineHeight: 1.55 }}>
        DevHub reads your calendar so the briefing knows what your day looks like. It only ever
        asks for read-only access, and everything stays on this machine.
      </p>

      <div style={{ marginBottom: "18px" }}>
        <GoogleSetupSteps />
      </div>

      {banner ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "var(--accent-dim)",
            color: "var(--accent)",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          {banner}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "8px" }}>
        <FormField
          label="Client ID"
          value={form.clientId}
          onChange={(v) => setForm({ ...form, clientId: v })}
          placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
          secret={false}
        />
        <FormField
          label="Client Secret"
          value={form.clientSecret}
          onChange={(v) => setForm({ ...form, clientSecret: v })}
          placeholder="GOCSPX-xxxxxxxxxxxx"
          secret={false}
        />
      </div>

      {signInButton("12px")}

      <p style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "8px", lineHeight: 1.45 }}>
        If your dev server uses a non-default port or host, set{" "}
        <code style={{ fontSize: "11px" }}>GOOGLE_OAUTH_REDIRECT_URI</code> in{" "}
        <code style={{ fontSize: "11px" }}>.env.local</code> to the same redirect URL you registered in Google Cloud.
      </p>

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}


export function JiraStep({
  form,
  setForm,
  showSecrets,
  toggleSecret,
  configured,
  checking,
  onCheckConnection,
  error,
}: {
  form: { domain: string; email: string; apiToken: string };
  setForm: (f: { domain: string; email: string; apiToken: string }) => void;
  showSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  configured: boolean;
  checking: boolean;
  onCheckConnection: () => void;
  error: string;
}) {
  const statusRow = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "12px 16px",
        borderRadius: "8px",
        marginTop: configured ? "12px" : "16px",
        background: configured ? "var(--accent-dim)" : "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      {configured ? (
        <CheckCircle2 size={18}  className="text-accent" />
      ) : (
        <Circle size={18} />
      )}
      <span
        style={{
          fontSize: "13px",
          color: configured ? "var(--accent)" : "var(--text-subtle)",
          fontWeight: 500,
        }}
      >
        {configured ? "Jira is connected" : "Jira is not connected yet"}
      </span>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Jira Cloud
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "20px", lineHeight: 1.5 }}>
        Connect Jira to see your active tickets on the dashboard.
        Generate an API token at{" "}
        <a
          href="https://id.atlassian.com/manage-profile/security/api-tokens"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          Atlassian Security Settings
          <ExternalLink size={10} style={{ display: "inline", marginLeft: "2px", verticalAlign: "middle" }} />
        </a>.
      </p>

      {!configured && (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FormField
          label="Domain"
          value={form.domain}
          onChange={(v) => setForm({ ...form, domain: v })}
          placeholder="yourcompany.atlassian.net"
          secret={false}
        />
        <FormField
          label="Email"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="you@company.com"
          secret={false}
        />
        <FormField
          label="API Token"
          value={form.apiToken}
          onChange={(v) => setForm({ ...form, apiToken: v })}
          placeholder="ATTxxxxxxxxxxxx"
          secret={!showSecrets["jira-token"]}
          onToggleSecret={() => toggleSecret("jira-token")}
        />
      </div>
      )}

      {statusRow}
      <button
        type="button"
        onClick={onCheckConnection}
        disabled={checking}
        className="btn btn-primary mt-3.5"
      >
        {checking ? "Checking..." : "Check connection"}
      </button>

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}


export function AgentCliStep({
  cli,
  onCliChange,
  opencodeModel,
  onOpencodeModelChange,
  cursorModel,
  onCursorModelChange,
  cursorAgentInstalled,
}: {
  cli: "opencode" | "cursor";
  onCliChange: (v: "opencode" | "cursor") => void;
  opencodeModel: string;
  onOpencodeModelChange: (v: string) => void;
  cursorModel: string;
  onCursorModelChange: (v: string) => void;
  cursorAgentInstalled: boolean;
}) {
  const options: Array<{ value: "opencode" | "cursor"; title: string; description: string }> = [
    {
      value: "opencode",
      title: "OpenCode",
      description: "opencode run — uses the shared opencode.json model unless overridden below.",
    },
    ...(cursorAgentInstalled
      ? [
          {
            value: "cursor" as const,
            title: "Cursor CLI",
            description: "cursor-agent print mode, pointed at the model below.",
          },
        ]
      : []),
  ];

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Agent CLI
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
        Which CLI runs one-shot terminal jobs — PR review, DX audits, capability labs, and repo
        upstart. Saved to <code style={{ fontSize: "11px" }}>.env.local</code> as{" "}
        <code style={{ fontSize: "11px" }}>DEVHUB_AGENT_*</code>, so the 1Password{" "}
        <code style={{ fontSize: "11px" }}>devhub</code> item can populate it like other managed
        config. Both CLIs get your skills and the notes MCP from the sync engine.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        {options.map((option) => (
          <label
            key={option.value}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "12px 14px",
              borderRadius: "8px",
              border: `1px solid ${cli === option.value ? "var(--accent)" : "var(--border)"}`,
              background: "var(--bg-elevated)",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="setup-agent-cli"
              value={option.value}
              checked={cli === option.value}
              onChange={() => onCliChange(option.value)}
              style={{ marginTop: "3px" }}
            />
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
                {option.title}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5, marginTop: "2px" }}>
                {option.description}
              </div>
            </div>
          </label>
        ))}
      </div>
      {!cursorAgentInstalled && (
        <TipCard>
          Cursor CLI not detected. Install <code style={{ fontSize: "11px" }}>cursor-agent</code>{" "}
          (<code style={{ fontSize: "11px" }}>curl https://cursor.com/install -fsS | bash</code>)
          and revisit this step to unlock the Cursor option.
        </TipCard>
      )}
      <div style={{ marginTop: "16px" }}>
        {cli === "opencode" ? (
          <FormField
            label="OpenCode model override (optional)"
            value={opencodeModel}
            onChange={onOpencodeModelChange}
            placeholder="provider/model, e.g. cursor-acp/grok-4.3 — blank uses opencode.json"
            hint="Passed as opencode run --model. Leave blank to keep the shared opencode.json default."
          />
        ) : (
          <FormField
            label="Cursor model"
            value={cursorModel}
            onChange={onCursorModelChange}
            placeholder="cursor-grok-4.5-high"
            hint="Passed as cursor-agent --model. Verify the slug with cursor-agent --help or the /model picker."
          />
        )}
      </div>
    </div>
  );
}

export function DoneStep({ saveResult }: { saveResult: { ok: boolean; message: string } | null }) {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "var(--accent-dim)",
            marginBottom: "16px",
          }}
        >
          <CheckCircle2 size={28} className="text-accent" />
        </div>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", marginBottom: "8px" }}>
          You&apos;re all set!
        </h2>
        <p style={{ color: "var(--text-subtle)", fontSize: "14px", lineHeight: 1.6 }}>
          Your DevHub is configured and ready to go.
        </p>
      </div>

      {saveResult?.ok && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            background: "var(--success-dim)",
            border: "1px solid var(--success)",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <RotateCcw size={14}  className="text-success" />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--success)" }}>Restart required</span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5 }}>
            {saveResult.message}
            <br />
            <span className="text-text-muted">
              In your terminal: stop the dashboard (Ctrl+C) and re-run{" "}
              <code style={{ color: "var(--accent)", fontSize: "11px" }}>npm run dev</code> or{" "}
              <code style={{ color: "var(--accent)", fontSize: "11px" }}>npm run start</code>.
            </span>
          </p>
        </div>
      )}

      <div style={{ marginBottom: "16px" }}>
        <InstallAppCard />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <TipCard>You can revisit this setup anytime from the sidebar Settings link.</TipCard>
        <TipCard>
          Use ⌘K for the command palette, ⌘⇧O for the notes panel, and ⌘⇧T for the tasks panel from any page.
        </TipCard>
        <TipCard>
          Press ? for shortcuts when DevHub has focus. OpenChamber in an iframe won&apos;t receive those keys - use{" "}
          <strong>Chamber</strong> → &quot;Shortcuts&quot; or open OpenChamber in a new tab.
        </TipCard>
      </div>
    </div>
  );
}


export function InstallAppCard() {
  const [info, setInfo] = useState<{ version: string; appData: string } | null>(null);

  useEffect(() => {
    void desktopInfo().then((i) => {
      if (i) setInfo({ version: i.version, appData: i.appData });
    });
  }, []);

  /**
   * Status, not an action.
   *
   * This card used to offer "Install the desktop app", which built an Electron
   * bundle from the user's checkout — asking somebody who is already using the
   * app to build the app. Building an installer is a developer command
   * (`npm run desktop:build`), not an onboarding step.
   *
   * So there are exactly two honest things to say here: which version you are
   * running, or where to download one.
   */
  if (info) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "14px 16px",
          background: "var(--bg-elevated)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <MonitorDown size={15} className="text-success" />
          <span style={{ fontSize: "13px", fontWeight: 600 }}>
            Desktop app {info.version}
          </span>
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5, margin: 0 }}>
          Updates arrive in the app — you&rsquo;ll see a banner when one is ready, and you choose
          when to restart. Your data lives in{" "}
          <code style={{ fontSize: "11px" }}>{info.appData}</code> and is never replaced by an
          update.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "14px 16px",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <MonitorDown size={15} />
        <span style={{ fontSize: "13px", fontWeight: 600 }}>Prefer a desktop app?</span>
      </div>
      <p style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5, margin: "0 0 10px" }}>
        DevHub ships as a signed desktop app that runs without a terminal, a checkout, or Node
        installed. It keeps your notes and settings outside the app, so updates never touch them.
      </p>
      <a
        className="btn"
        href="https://github.com/jmcelreavey/devhub/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: "12px" }}
      >
        Download <ExternalLink size={12} />
      </a>
    </div>
  );
}

