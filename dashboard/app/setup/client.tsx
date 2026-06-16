"use client";

import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import Link from "next/link";
import { mutate as mutateSWR } from "swr";
import { FieldError } from "@/components/FieldError";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  GitBranch,
  Loader2,
  MonitorDown,
  RotateCcw,
  SkipForward,
  Sparkles,
  TicketCheck,
} from "lucide-react";

interface SetupStatus {
  core: boolean;
  github: boolean;
  datadog: boolean;
  calendar: boolean;
  jira: boolean;
  bi: boolean;
  /** When false, dashboard binds to localhost only. */
  allowLanNetwork: boolean;
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
  /** Saved Web client ID when ID+secret exist in `.env.local` but refresh token is missing. */
  calendarClientIdPreview: string | null;
  /** Saved client secret for the same case (local setup only). */
  calendarClientSecretPreview: string | null;
  jiraVars: { hasDomain: boolean; hasEmail: boolean; hasApiToken: boolean };
  biVars: { awsProfile: string | null; account: string | null; capiRepoPath: string | null };
}

interface PathCheck {
  ok: boolean;
  resolved: string;
  message: string;
  isGitRepo?: boolean;
  hasNotesIndex?: boolean;
}

interface Step {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  configured: boolean;
  optional: boolean;
}

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome",
    icon: <Sparkles size={18} />,
    description: "Let's configure your DevHub integrations",
    configured: true,
    optional: false,
  },
  {
    id: "paths",
    title: "Core paths",
    icon: <FolderOpen size={18} />,
    description: "Where DevHub stores notes and finds the repo",
    configured: false,
    optional: true,
  },
  {
    id: "github",
    title: "GitHub",
    icon: <GitBranch size={18} />,
    description: "Connect GitHub CLI auth for repo features (recommended)",
    configured: false,
    optional: true,
  },
  {
    id: "datadog",
    title: "Datadog",
    icon: <Activity size={18} />,
    description: "Add your Datadog API key for observability and troubleshooting skills",
    configured: false,
    optional: true,
  },
  {
    id: "calendar",
    title: "Google Calendar",
    icon: <CalendarDays size={18} />,
    description: "See today's events and week overview on your dashboard",
    configured: false,
    optional: true,
  },
  {
    id: "jira",
    title: "Jira Cloud",
    icon: <TicketCheck size={18} />,
    description: "Track your tickets and priorities from the dashboard",
    configured: false,
    optional: true,
  },
  {
    id: "bi",
    title: "BI Infra",
    icon: <Cloud size={18} />,
    description: "AWS profile + infra tooling for BI engineers (optional)",
    configured: false,
    optional: true,
  },
  {
    id: "done",
    title: "All Set",
    icon: <CheckCircle2 size={18} />,
    description: "Your DevHub is ready to go",
    configured: true,
    optional: false,
  },
];

const SECRET_FIELD_MASK = "••••••••";

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [pathsForm, setPathsForm] = useState({ repoRoot: "", notesDir: "" });
  const [pathChecks, setPathChecks] = useState<{ repoRoot: PathCheck | null; notesDir: PathCheck | null }>({
    repoRoot: null,
    notesDir: null,
  });
  const [datadogForm, setDatadogForm] = useState({ apiKey: "", applicationKey: "", email: "", scheduleId: "" });
  const [calendarForm, setCalendarForm] = useState({ clientId: "", clientSecret: "" });
  const [jiraForm, setJiraForm] = useState({ domain: "", email: "", apiToken: "" });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [checkConnectionBusy, setCheckConnectionBusy] = useState<
    null | "github" | "datadog" | "jira" | "calendar"
  >(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [allowLan, setAllowLan] = useState(true);
  const [calendarConnectBusy, setCalendarConnectBusy] = useState(false);
  const [calendarBanner, setCalendarBanner] = useState("");
  const [biChecking, setBiChecking] = useState(false);
  const [biForm, setBiForm] = useState({ capiRepoPath: "" });

  const loadSetupStatus = useCallback(async (): Promise<SetupStatus | null> => {
    try {
      const r = await fetch("/api/setup/status");
      const data = (await r.json()) as SetupStatus;
      setStatus(data);
      void mutateSWR("/api/setup/status", data, { revalidate: false });
      setAllowLan(data.allowLanNetwork !== false);
      setPathsForm({
        repoRoot: data.coreVars.repoRoot || data.coreDefaults.repoRoot,
        notesDir: data.coreVars.notesDir || data.coreDefaults.notesDir,
      });
      if (data.calendar) {
        setCalendarForm({
          clientId: SECRET_FIELD_MASK,
          clientSecret: SECRET_FIELD_MASK,
        });
      } else if (
        data.calendarVars.hasClientId &&
        data.calendarVars.hasClientSecret &&
        data.calendarClientIdPreview
      ) {
        setCalendarForm({
          clientId: data.calendarClientIdPreview,
          clientSecret: data.calendarClientSecretPreview ?? "",
        });
      }
      if (data.jira) {
        setJiraForm({
          domain: SECRET_FIELD_MASK,
          email: SECRET_FIELD_MASK,
          apiToken: SECRET_FIELD_MASK,
        });
      }
      // Email + schedule id are not secrets — prefill them either way so the
      // step shows what's configured (the email is what gates Datadog).
      setDatadogForm((prev) => ({
        apiKey: data.datadogVars.hasApiKey ? SECRET_FIELD_MASK : prev.apiKey === SECRET_FIELD_MASK ? "" : prev.apiKey,
        applicationKey: data.datadogVars.hasApplicationKey ? SECRET_FIELD_MASK : "",
        email: data.datadogVars.email,
        scheduleId: data.datadogVars.scheduleId,
      }));
      if (data.biVars.capiRepoPath) {
        setBiForm({ capiRepoPath: data.biVars.capiRepoPath });
      }
      return data;
    } catch {
      setError("Failed to load setup status");
      return null;
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadSetupStatus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadSetupStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(() => {
      const u = new URL(window.location.href);
      let qsChanged = false;

      if (u.searchParams.has("calendar_connected")) {
        startTransition(() => setCalendarBanner("Google Calendar is connected."));
        queueMicrotask(() => {
          void loadSetupStatus();
        });
        u.searchParams.delete("calendar_connected");
        qsChanged = true;
      }

      const calendarErrCode = u.searchParams.get("calendar_error");
      if (calendarErrCode) {
        const detailRaw = u.searchParams.get("calendar_error_detail") ?? "";
        let detail = detailRaw;
        try {
          detail = decodeURIComponent(detailRaw);
        } catch {
          /* ignore */
        }
        startTransition(() => {
          switch (calendarErrCode) {
            case "missing_credentials":
              setError("Add Client ID and Client Secret below and save, or reconnect after saving.");
              break;
            case "missing_code":
              setError("Google sign-in did not finish. Try connecting again.");
              break;
            case "oauth_failed":
              setError(
                detail.includes("refresh token")
                  ? `Google OAuth: ${detail}. Try disconnecting Calendar in Google Account permissions and reconnect.`
                  : `Google OAuth failed: ${detail || "Try again."}`,
              );
              break;
            default:
              try {
                setError(decodeURIComponent(calendarErrCode));
              } catch {
                setError(calendarErrCode);
              }
          }
        });
        u.searchParams.delete("calendar_error");
        u.searchParams.delete("calendar_error_detail");
        qsChanged = true;
      }

      if (qsChanged) {
        const qs = u.searchParams.toString();
        window.history.replaceState({}, "", qs ? `/setup?${qs}` : "/setup");
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [loadSetupStatus]);

  // Validate core paths whenever they change. Debounced so we don't hammer the
  // API while the user is still typing.
  useEffect(() => {
    if (!pathsForm.repoRoot && !pathsForm.notesDir) return;
    const id = setTimeout(() => {
      fetch("/api/setup/validate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pathsForm),
      })
        .then((r) => r.json())
        .then((data: { repoRoot: PathCheck | null; notesDir: PathCheck | null }) => {
          setPathChecks(data);
        })
        .catch(() => { /* ignore validation transport errors */ });
    }, 250);
    return () => clearTimeout(id);
  }, [pathsForm]);

  const steps: Step[] = STEPS.map((s) => {
    if (s.id === "paths" && status) return { ...s, configured: status.core };
    if (s.id === "github" && status) return { ...s, configured: status.github };
    if (s.id === "datadog" && status) return { ...s, configured: status.datadog };
    if (s.id === "calendar" && status) return { ...s, configured: status.calendar };
    if (s.id === "jira" && status) return { ...s, configured: status.jira };
    if (s.id === "bi" && status) return { ...s, configured: status.bi };
    return s;
  });

  const goNext = useCallback(() => {
    setSaveResult(null);
    setError("");
    setCurrentStep((i) => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = () => {
    setSaveResult(null);
    setError("");
    setCurrentStep((i) => Math.max(i - 1, 0));
  };

  const checkConnection = useCallback(
    async (kind: "github" | "datadog" | "jira" | "calendar") => {
      setCheckConnectionBusy(kind);
      setError("");
      try {
        if (kind === "datadog") {
          // Test exactly what's in the form. Masked/blank secrets are omitted so
          // the server falls back to the saved env — this lets the check pass
          // before the step is saved, instead of demanding a save first.
          const apiKey = datadogForm.apiKey.trim();
          const applicationKey = datadogForm.applicationKey.trim();
          const r = await fetch("/api/setup/check/datadog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(apiKey && apiKey !== SECRET_FIELD_MASK ? { apiKey } : {}),
              ...(applicationKey && applicationKey !== SECRET_FIELD_MASK ? { applicationKey } : {}),
            }),
          });
          const result = (await r.json()) as { ok: boolean; code?: string; message?: string };
          if (!result.ok) {
            setError(result.message ?? "Datadog connection failed.");
            return;
          }
          await loadSetupStatus();
          return;
        }

        const data = await loadSetupStatus();
        if (!data) {
          setError("Could not load setup status.");
          return;
        }
        if (kind === "github" && !data.github) {
          setError("GitHub is not connected yet. Run `gh auth login` in your terminal, then try again.");
          return;
        }
        if (kind === "jira" && !data.jira) {
          setError(
            "Jira is not connected yet. Enter your site, email, and API token below, save, then check again (or skip this step).",
          );
          return;
        }
        if (kind === "calendar" && !data.calendar) {
          setError(
            "Google Calendar is not connected yet. In Google Cloud: enable the Google Calendar API, create a Web OAuth client with the redirect URI below, enter Client ID and Secret, then use Sign in with Google.",
          );
          return;
        }
      } catch {
        setError("Could not verify connection.");
      } finally {
        setCheckConnectionBusy(null);
      }
    },
    [loadSetupStatus, datadogForm],
  );

  const startGoogleCalendarOAuth = useCallback(async () => {
    if (!status) return;
    setCalendarConnectBusy(true);
    setError("");
    setCalendarBanner("");
    try {
      const id = calendarForm.clientId.trim();
      const sec = calendarForm.clientSecret.trim();
      const typedCreds =
        id &&
        sec &&
        id !== SECRET_FIELD_MASK &&
        sec !== SECRET_FIELD_MASK;

      if (typedCreds) {
        const r = await fetch("/api/setup/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendar: { clientId: id, clientSecret: sec } }),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "Save failed");
      } else if (!status.calendarVars.hasClientId || !status.calendarVars.hasClientSecret) {
        setCalendarConnectBusy(false);
        setError("Enter Client ID and Client Secret, then use Sign in with Google (or Save & Continue first).");
        return;
      }

      window.location.href = "/api/calendar/auth/start";
    } catch (e) {
      setCalendarConnectBusy(false);
      setError(e instanceof Error ? e.message : "Could not start Google sign-in");
    }
  }, [status, calendarForm.clientId, calendarForm.clientSecret]);

  const hasTypedGoogleOAuthCreds =
    !!calendarForm.clientId.trim() &&
    !!calendarForm.clientSecret.trim() &&
    calendarForm.clientId !== SECRET_FIELD_MASK &&
    calendarForm.clientSecret !== SECRET_FIELD_MASK;

  /** Used by OAuth start: allow redirect when creds are in the form or already in `.env.local`. */
  const canStartGoogleCalendarOAuth =
    !!status &&
    (hasTypedGoogleOAuthCreds ||
      (status.calendarVars.hasClientId && status.calendarVars.hasClientSecret));

  /** Pre-OAuth: both fields typed, or saved secret on disk plus client ID in the form (secret field left blank). */
  const canShowSignInWithGoogle =
    !!status &&
    (status.calendar
      ? canStartGoogleCalendarOAuth
      : hasTypedGoogleOAuthCreds ||
        (status.calendarVars.hasClientId &&
          status.calendarVars.hasClientSecret &&
          !!calendarForm.clientId.trim() &&
          calendarForm.clientId !== SECRET_FIELD_MASK));

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      const step = steps[currentStep];
      if (step.id === "paths") {
        body.core = { repoRoot: pathsForm.repoRoot, notesDir: pathsForm.notesDir };
      }
      if (step.id === "datadog") {
        const apiKey = datadogForm.apiKey.trim();
        const applicationKey = datadogForm.applicationKey.trim();
        const email = datadogForm.email.trim();
        const scheduleId = datadogForm.scheduleId.trim();
        const newApiKey = apiKey && apiKey !== SECRET_FIELD_MASK ? apiKey : undefined;

        // Datadog needs the API key to unlock the page; email only improves on-call matching.
        if (!newApiKey && !status?.datadogVars.hasApiKey) {
          throw new Error("Enter a Datadog API key or skip this step.");
        }

        body.datadog = {
          ...(newApiKey ? { apiKey: newApiKey } : {}),
          ...(applicationKey && applicationKey !== SECRET_FIELD_MASK ? { applicationKey } : {}),
          ...(email ? { email } : {}),
          scheduleId,
        };
      }
      if (step.id === "calendar" && !status?.calendar) {
        const cid = calendarForm.clientId.trim();
        const cs = calendarForm.clientSecret.trim();
        body.calendar = {
          ...(cid && cid !== SECRET_FIELD_MASK ? { clientId: cid } : {}),
          ...(cs && cs !== SECRET_FIELD_MASK ? { clientSecret: cs } : {}),
        };
      }
      if (step.id === "jira" && !status?.jira) {
        body.jira = {
          domain: jiraForm.domain,
          email: jiraForm.email,
          apiToken: jiraForm.apiToken,
        };
      }
      if (step.id === "bi") {
        body.bi = { capiRepoPath: biForm.capiRepoPath };
      }

      if (Object.keys(body).length > 0) {
        const r = await fetch("/api/setup/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "Save failed");
        setSaveResult({ ok: true, message: result.message });
        await loadSetupStatus();
      }
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [currentStep, pathsForm, datadogForm, calendarForm, jiraForm, biForm.capiRepoPath, status, steps, goNext, loadSetupStatus]);

  const goToStep = (i: number) => {
    if (i < 0 || i >= steps.length || i === currentStep) return;
    setSaveResult(null);
    setError("");
    setCurrentStep(i);
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm" style={{ color: "var(--text-subtle)" }}>Loading...</div>
      </div>
    );
  }

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;
  const pathsValid =
    step.id !== "paths" ||
    (!!pathChecks.repoRoot?.ok && !!pathChecks.notesDir?.ok);

  return (
    <div className="page-wrapper h-full min-h-0 overflow-y-auto">
      <div className="w-full min-w-0 max-w-full">
        {/* Progress bar */}
        <div
          style={{
            height: "3px",
            background: "var(--bg-elevated)",
            borderRadius: "2px",
            marginBottom: "32px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
              borderRadius: "2px",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Step indicators */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            marginBottom: "32px",
          }}
        >
          {steps.map((s, i) => {
            const complete = i < currentStep || s.configured;
            return (
            <button
              key={s.id}
              type="button"
              onClick={() => goToStep(i)}
              aria-current={i === currentStep ? "step" : undefined}
              title={s.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "none",
                background: i === currentStep ? "var(--accent-dim)" : "transparent",
                color: i === currentStep
                  ? "var(--accent)"
                  : complete
                    ? "var(--success)"
                    : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: i === currentStep ? 600 : 400,
                transition: "all 0.15s ease",
              }}
            >
              {complete ? <CheckCircle2 size={14} /> : i === currentStep ? s.icon : <Circle size={14} style={{ opacity: 0.5 }} />}
              <span className="hidden sm:inline">{s.title}</span>
              {s.optional && !complete && (
                <span className="hidden sm:inline text-[9px] font-normal" style={{ color: "var(--text-subtle)", opacity: 0.8 }}>opt</span>
              )}
            </button>
            );
          })}
        </div>

        {/* Step content card */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "32px",
            minHeight: "320px",
          }}
        >
          {step.id === "welcome" && (
            <WelcomeStep allowLan={allowLan} onAllowLanChange={setAllowLan} />
          )}
          {step.id === "paths" && (
            <PathsStep
              form={pathsForm}
              setForm={setPathsForm}
              checks={pathChecks}
              defaults={status.coreDefaults}
              error={error}
            />
          )}
          {step.id === "github" && (
            <GitHubStep
              configured={status.github}
              checking={checkConnectionBusy === "github"}
              onCheckConnection={() => void checkConnection("github")}
              error={error}
            />
          )}
          {step.id === "datadog" && (
            <DatadogStep
              form={datadogForm}
              setForm={setDatadogForm}
              showSecrets={showSecrets}
              toggleSecret={toggleSecret}
              configured={status.datadog}
              hasApiKey={status.datadogVars.hasApiKey}
              hasApplicationKey={status.datadogVars.hasApplicationKey}
              hasEmail={status.datadogVars.hasEmail}
              hasScheduleId={status.datadogVars.hasScheduleId}
              checking={checkConnectionBusy === "datadog"}
              onCheckConnection={() => void checkConnection("datadog")}
              error={error}
            />
          )}
          {step.id === "calendar" && (
            <CalendarStep
              form={calendarForm}
              setForm={setCalendarForm}
              configured={status.calendar}
              banner={calendarBanner}
              connectBusy={calendarConnectBusy}
              canConnectOAuth={canShowSignInWithGoogle}
              onConnectGoogle={() => void startGoogleCalendarOAuth()}
              checking={checkConnectionBusy === "calendar"}
              onCheckConnection={() => void checkConnection("calendar")}
              error={error}
            />
          )}
          {step.id === "jira" && (
            <JiraStep
              form={jiraForm}
              setForm={setJiraForm}
              showSecrets={showSecrets}
              toggleSecret={toggleSecret}
              configured={status.jira}
              checking={checkConnectionBusy === "jira"}
              onCheckConnection={() => void checkConnection("jira")}
              error={error}
            />
          )}
          {step.id === "bi" && (
            <BiStep
              configured={status.bi}
              awsProfile={status.biVars.awsProfile}
              account={status.biVars.account}
              checking={biChecking}
              onCheckConnection={async () => {
                setBiChecking(true);
                try {
                  await loadSetupStatus();
                } finally {
                  setBiChecking(false);
                }
              }}
              capiRepoPath={biForm.capiRepoPath}
              onCapiRepoPathChange={(v) => setBiForm((prev) => ({ ...prev, capiRepoPath: v }))}
            />
          )}
          {step.id === "done" && <DoneStep saveResult={saveResult} />}

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "28px",
              paddingTop: "20px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              onClick={goBack}
              disabled={currentStep === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: currentStep === 0 ? "var(--text-muted)" : "var(--text)",
                cursor: currentStep === 0 ? "default" : "pointer",
                opacity: currentStep === 0 ? 0.4 : 1,
                fontSize: "13px",
              }}
            >
              <ChevronLeft size={14} /> Back
            </button>

            <div style={{ display: "flex", gap: "8px" }}>
              {step.optional && !isStepComplete(step, status) && (
                <button
                  onClick={goNext}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-subtle)",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  Skip <SkipForward size={14} />
                </button>
              )}

              {step.id === "done" ? (
                <Link
                  href="/"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Go to Dashboard
                </Link>
              ) : step.id === "welcome" ? (
                <button
                  onClick={async () => {
                    setSaving(true);
                    setError("");
                    try {
                      const r = await fetch("/api/setup/save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ network: { allowLan } }),
                      });
                      const result = await r.json();
                      if (!r.ok) throw new Error(result.error || "Save failed");
                      setSaveResult({ ok: true, message: result.message });
                      goNext();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to save network preference");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: saving ? "wait" : "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Saving…" : "Get Started"} <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => (step.configured ? goNext() : void save())}
                  disabled={saving || !pathsValid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: saving ? "wait" : !pathsValid ? "not-allowed" : "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    opacity: saving || !pathsValid ? 0.5 : 1,
                  }}
                >
                  {saving ? "Saving..." : step.configured ? "Next" : "Save & Continue"}
                  {!saving && <ChevronRight size={14} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isStepComplete(step: Step, status: SetupStatus): boolean {
  if (step.id === "paths") return status.core;
  if (step.id === "github") return status.github;
  if (step.id === "datadog") return status.datadog;
  if (step.id === "calendar") return status.calendar;
  if (step.id === "jira") return status.jira;
  if (step.id === "bi") return status.bi;
  return true;
}

function WelcomeStep({
  allowLan,
  onAllowLanChange,
}: {
  allowLan: boolean;
  onAllowLanChange: (v: boolean) => void;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", marginBottom: "8px" }}>
        Welcome to DevHub
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>
        Your personal developer dashboard. Let&apos;s connect your tools to get the most out of it.
      </p>
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
            When enabled, DevHub and OpenChamber bind to all interfaces (default). Uncheck to restrict to this
            machine only (<code style={{ fontSize: "11px" }}>127.0.0.1</code>). Writes{" "}
            <code style={{ fontSize: "11px" }}>DEVHUB_BIND_HOST</code> and{" "}
            <code style={{ fontSize: "11px" }}>OPENCHAMBER_HOST</code> in <code style={{ fontSize: "11px" }}>.env.local</code>
            — restart the dev server after changing.
          </div>
        </div>
      </label>
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

function FeatureCard({ title, description, badge }: { title: string; description: string; badge: string }) {
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

function GitHubStep({
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
        {configured ? <CheckCircle2 size={18} style={{ color: "var(--accent)" }} /> : <Circle size={18} />}
        <span style={{ fontSize: "13px", color: configured ? "var(--accent)" : "var(--text-subtle)", fontWeight: 500 }}>
          {configured ? "GitHub CLI is connected" : "GitHub CLI is not connected yet"}
        </span>
      </div>
      <button
        type="button"
        onClick={onCheckConnection}
        disabled={checking}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "14px",
          padding: "10px 16px",
          borderRadius: "8px",
          border: "none",
          background: checking ? "var(--bg-elevated)" : "var(--accent)",
          color: checking ? "var(--text-muted)" : "#fff",
          cursor: checking ? "default" : "pointer",
          fontSize: "13px",
          fontWeight: 600,
        }}
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
 * BI Infra step. Read-only — the actual sign-in / EKS / mongo / jumpbox
 * controls live on /ops. This step just surfaces whether the dashboard
 * process has a working AWS session and links out for the interactive flow.
 */
function BiStep({
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
        BI Infrastructure
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
        Optional helpers for Business Insider engineers: AWS sign-in via{" "}
        <code style={{ fontSize: "11px" }}>gimme-aws-creds</code>, Tailscale service lookup,
        EKS context setup, MongoDB connection strings, CAPI script runner, and jumpbox SSM commands.
        Skip this step if you don&apos;t work on BI services.
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
        {configured ? <CheckCircle2 size={18} style={{ color: "var(--accent)" }} /> : <Circle size={18} />}
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
          CAPI repo path <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>(optional — enables script discovery)</span>
        </label>
        <p style={{ fontSize: "11px", color: "var(--text-subtle)", marginBottom: "8px", lineHeight: 1.5 }}>
          Absolute path to your local CAPI checkout. Enables the CAPI Scripts panel on the Ops page to discover
          and run <code>scripts/**/main.ts</code> and <code>mongo/**/*.js</code>.
        </p>
        <input
          type="text"
          value={capiRepoPath}
          onChange={(e) => onCapiRepoPathChange(e.target.value)}
          placeholder="e.g. ~/dev/capi"
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
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
          }}
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

function PathsStep({
  form,
  setForm,
  checks,
  defaults,
  error,
}: {
  form: { repoRoot: string; notesDir: string };
  setForm: (f: { repoRoot: string; notesDir: string }) => void;
  checks: { repoRoot: PathCheck | null; notesDir: PathCheck | null };
  defaults: { repoRoot: string; notesDir: string };
  error: string;
}) {
  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>
        Core paths
      </h2>
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "20px", lineHeight: 1.5 }}>
        DevHub infers these paths from your current checkout by default. Customize only if you want to override them.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <PathField
          label="Repo root"
          value={form.repoRoot}
          onChange={(v) => setForm({ ...form, repoRoot: v })}
          placeholder={defaults.repoRoot}
          check={checks.repoRoot}
          onUseDefault={() => setForm({ ...form, repoRoot: defaults.repoRoot })}
          hint="The folder that contains your repositories. Defaults to the directory above DevHub."
        />
        <PathField
          label="Notes directory"
          value={form.notesDir}
          onChange={(v) => setForm({ ...form, notesDir: v })}
          placeholder={defaults.notesDir}
          check={checks.notesDir}
          onUseDefault={() => setForm({ ...form, notesDir: defaults.notesDir })}
          hint="Where DevHub stores notes and learnings. Defaults to notes/ inside this repo."
        />
      </div>

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function PathField({
  label,
  value,
  onChange,
  placeholder,
  check,
  onUseDefault,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  check: PathCheck | null;
  onUseDefault: () => void;
  hint: string;
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
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          width: "100%",
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

function DatadogStep({
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
        <CheckCircle2 size={primary ? 18 : 16} style={{ color: "var(--accent)" }} />
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
        hasEmail ? "Work email set — on-call detection can match you" : "No work email yet — on-call matching is disabled",
      )}
      {checkLine(
        hasApplicationKey,
        hasApplicationKey
          ? "Application key saved — DevHub can call the Events / On-Call APIs"
          : "No application key yet — deep links work; counts + on-call detection need it",
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
        search) expect <strong style={{ fontWeight: 600 }}>together</strong> with the API key — an API key alone does
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
          label="Work email (optional — for on-call match)"
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
          label="On-call schedule ID (optional — advanced override)"
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
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "14px",
          padding: "10px 16px",
          borderRadius: "8px",
          border: "none",
          background: checking ? "var(--bg-elevated)" : "var(--accent)",
          color: checking ? "var(--text-muted)" : "#fff",
          cursor: checking ? "default" : "pointer",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        {checking ? "Checking..." : "Check connection"}
      </button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function CalendarStep({
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
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        marginTop,
        padding: "10px 16px",
        borderRadius: "8px",
        border: "none",
        background:
          !canConnectOAuth || connectBusy ? "var(--bg-elevated)" : "var(--accent)",
        color: !canConnectOAuth || connectBusy ? "var(--text-muted)" : "#fff",
        cursor: !canConnectOAuth || connectBusy ? "default" : "pointer",
        fontSize: "13px",
        fontWeight: 600,
      }}
    >
      {connectBusy ? "Starting…" : "Sign in with Google"}
    </button>
  );

  const checkConnectionButton = (marginTop: string) => (
    <button
      type="button"
      onClick={onCheckConnection}
      disabled={checking}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        marginTop,
        padding: "10px 16px",
        borderRadius: "8px",
        border: "none",
        background: checking ? "var(--bg-elevated)" : "var(--accent)",
        color: checking ? "var(--text-muted)" : "#fff",
        cursor: checking ? "default" : "pointer",
        fontSize: "13px",
        fontWeight: 600,
      }}
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
          <CheckCircle2 size={18} style={{ color: "var(--accent)" }} />
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
      <p style={{ color: "var(--text-subtle)", fontSize: "13px", marginBottom: "12px", lineHeight: 1.55 }}>
        Connect read-only access to your primary calendar for the dashboard. In{" "}
        <a
          href="https://console.cloud.google.com/apis/library"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          APIs and Services → Library
          <ExternalLink size={10} style={{ display: "inline", marginLeft: "2px", verticalAlign: "middle" }} />
        </a>
        , enable <strong>Google Calendar API</strong> for the project. Configure the{" "}
        <a
          href="https://console.cloud.google.com/apis/credentials/consent"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          OAuth consent screen
          <ExternalLink size={10} style={{ display: "inline", marginLeft: "2px", verticalAlign: "middle" }} />
        </a>
        . DevHub requests scope{" "}
        <code style={{ fontSize: "11px", wordBreak: "break-all" }}>
          https://www.googleapis.com/auth/calendar.readonly
        </code>
        . If the app is in <strong>Testing</strong>, add your Google account under test users. Then create credentials in{" "}
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          Credentials
          <ExternalLink size={10} style={{ display: "inline", marginLeft: "2px", verticalAlign: "middle" }} />
        </a>
        : type <strong>Web application</strong>, and under <strong>Authorized redirect URIs</strong> add the full URL
        for this DevHub host, for example{" "}
        <code style={{ fontSize: "11px", wordBreak: "break-all" }}>http://localhost:1337/api/calendar/auth/callback</code>{" "}
        (match scheme, host, and port to where you open the app). Paste the Web client <strong>Client ID</strong> and{" "}
        <strong>Client secret</strong> below, then use Sign in with Google; the refresh token is stored for you in{" "}
        <code style={{ fontSize: "11px" }}>.env.local</code>.
      </p>

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

function JiraStep({
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
        <CheckCircle2 size={18} style={{ color: "var(--accent)" }} />
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
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "14px",
          padding: "10px 16px",
          borderRadius: "8px",
          border: "none",
          background: checking ? "var(--bg-elevated)" : "var(--accent)",
          color: checking ? "var(--text-muted)" : "#fff",
          cursor: checking ? "default" : "pointer",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        {checking ? "Checking..." : "Check connection"}
      </button>

      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function DoneStep({ saveResult }: { saveResult: { ok: boolean; message: string } | null }) {
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
          <Sparkles size={28} style={{ color: "var(--accent)" }} />
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
            borderRadius: "8px",
            background: "rgba(63, 185, 80, 0.1)",
            border: "1px solid rgba(63, 185, 80, 0.3)",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <RotateCcw size={14} style={{ color: "var(--success)" }} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--success)" }}>Restart required</span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-subtle)", lineHeight: 1.5 }}>
            {saveResult.message}
            <br />
            <span style={{ color: "var(--text-muted)" }}>
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
          Press ? for shortcuts when DevHub has focus. OpenChamber in an iframe won&apos;t receive those keys — use{" "}
          <strong>Chamber</strong> → &quot;Shortcuts&quot; or open OpenChamber in a new tab.
        </TipCard>
      </div>
    </div>
  );
}

function TipCard({ children }: { children: React.ReactNode }) {
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

function InstallAppCard() {
  const [state, setState] = useState<"idle" | "building" | "done" | "error">("idle");
  const [log, setLog] = useState("");
  const [destPath, setDestPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const build = useCallback(async () => {
    setState("building");
    setLog("");
    setDestPath(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/setup/install-app", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let outcome: "done" | "error" | null = null;
      let buffer = "";
      // Process complete lines only, so control markers can't split across chunks.
      const flush = (final: boolean) => {
        const parts = buffer.split("\n");
        buffer = final ? "" : (parts.pop() ?? "");
        for (const line of parts) {
          const installed = line.match(/^\[devhub:installed\]\s*(.*)$/);
          if (installed) {
            outcome = "done";
            setDestPath(installed[1].trim());
            continue;
          }
          const errored = line.match(/^\[devhub:error\]\s*(.*)$/);
          if (errored) {
            outcome = "error";
            setErrorMsg(errored[1].trim());
            continue;
          }
          setLog((prev) => prev + line + "\n");
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        flush(false);
      }
      flush(true);
      setState(outcome === "done" ? "done" : "error");
      if (outcome === null) setErrorMsg("Build ended without a result.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  const building = state === "building";

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <MonitorDown size={20} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
            DevHub Desktop App
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-subtle)" }}>
            Builds and installs the native launcher on this machine only. No sign-in, no sudo.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void build()}
          disabled={building}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            borderRadius: "8px",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: building ? "wait" : "pointer",
            opacity: building ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          {building && <Loader2 size={14} className="animate-spin" />}
          {building ? "Building…" : state === "done" ? "Rebuild" : "Build & Install"}
        </button>
      </div>

      {(building || state === "done" || state === "error") && log && (
        <pre
          ref={logRef}
          style={{
            marginTop: "12px",
            maxHeight: "180px",
            overflowY: "auto",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text-subtle)",
            fontSize: "11px",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {log}
        </pre>
      )}

      {state === "done" && destPath && (
        <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
          <CheckCircle2 size={14} style={{ color: "var(--success)", flexShrink: 0 }} />
          <span style={{ fontSize: "12px", color: "var(--success)" }}>
            Installed to <code style={{ fontSize: "11px" }}>{destPath}</code>
          </span>
        </div>
      )}

      {state === "error" && errorMsg && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--danger)" }}>
          {errorMsg}
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  secret,
  onToggleSecret,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
  onToggleSecret?: () => void;
  hint?: string;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            width: "100%",
            padding: onToggleSecret ? "8px 36px 8px 12px" : "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text)",
            fontSize: "13px",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "monospace",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />
        {onToggleSecret && (
          <button
            onClick={onToggleSecret}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-subtle)",
              padding: "2px",
            }}
          >
            {secret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {hint && (
        <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", lineHeight: 1.4 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
