"use client";

import { DependencyChecklist } from "@/components/setup/DependencyChecklist";
import { filterStepsByGoals, parseGoals, SETUP_GOALS_KEY, type GoalId } from "@/lib/setup/goals";
import { useState, useEffect, useCallback, startTransition } from "react";
import Link from "next/link";
import { mutate as mutateSWR } from "swr";
import { isDesktop, pickFolder } from "@/lib/desktop/bridge";
import {
  SECRET_FIELD_MASK,
  type PathCheck,
  type SetupStatus,
  type SetupStepMeta,
} from "./shared";
import {
  isStepComplete,
  WelcomeStep,
  GitHubStep,
  InfraStep,
  PathsStep,
  type PathsForm,
  DatadogStep,
  CalendarStep,
  JiraStep,
  AgentCliStep,
  DoneStep,
} from "./steps";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Cloud,
  FolderOpen,
  GitBranch,
  SkipForward,
  Hand,
  TerminalSquare,
  TicketCheck,
  Wrench,
} from "lucide-react";

type Step = SetupStepMeta;

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome",
    icon: <Hand size={18} />,
    description: "Let's configure your DevHub integrations",
    configured: true,
    optional: false,
  },
  {
    id: "tools",
    title: "Tools",
    icon: <Wrench size={18} />,
    description: "What's installed on this machine, and what each one turns on",
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
    title: "Infra",
    icon: <Cloud size={18} />,
    description: "AWS profile + infra tooling (optional)",
    configured: false,
    optional: true,
  },
  {
    id: "agent",
    title: "Agent CLI",
    icon: <TerminalSquare size={18} />,
    description: "Which CLI runs one-shot agent jobs (PR review, DX audits, labs)",
    configured: true,
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

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [pathsForm, setPathsForm] = useState<PathsForm>({ repoRoot: "", notesDir: "", reposDir: "" });
  const [pathChecks, setPathChecks] = useState<{
    repoRoot: PathCheck | null;
    notesDir: PathCheck | null;
    reposDir: PathCheck | null;
  }>({
    repoRoot: null,
    notesDir: null,
    reposDir: null,
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
  const [chamberUiPassword, setChamberUiPassword] = useState("");
  const [calendarConnectBusy, setCalendarConnectBusy] = useState(false);
  const [calendarBanner, setCalendarBanner] = useState("");
  const [biChecking, setBiChecking] = useState(false);
  const [biForm, setBiForm] = useState({ capiRepoPath: "" });
  const [agentForm, setAgentForm] = useState<{
    cli: "opencode" | "cursor";
    opencodeModel: string;
    cursorModel: string;
  }>({ cli: "opencode", opencodeModel: "", cursorModel: "" });

  /**
   * Native folder picker, when there is one.
   *
   * `undefined` in browser mode rather than a no-op function: `PathsStep`
   * renders the Browse button only when a handler exists, so a browser user
   * never sees a button that does nothing. The typed input works in both.
   */
  const browseForCodeFolder = isDesktop()
    ? async () => {
        const picked = await pickFolder("Choose your code folder");
        // null means the dialog was dismissed. Clearing the field on cancel
        // would discard whatever the user had already typed.
        if (picked) setPathsForm((f) => ({ ...f, reposDir: picked }));
      }
    : undefined;

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
        // Not defaulted from coreDefaults: pre-filling a guessed path makes the
        // user confirm a decision they never made. The default shows as
        // placeholder text instead, so an untouched field saves nothing.
        reposDir: data.coreVars.reposDir || "",
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
      if (data.agentVars) {
        setAgentForm({
          cli: data.agentVars.cli,
          opencodeModel: data.agentVars.opencodeModel,
          cursorModel: data.agentVars.cursorModel,
        });
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
              /*
                Google's error codes are precise and completely opaque, and they
                arrive at the END of a seven-step setup - the worst possible
                moment to be told only "redirect_uri_mismatch". Each one below
                has a single, specific cause and a single fix, so say that
                instead of forwarding the raw string.
              */
              if (detail.includes("redirect_uri_mismatch")) {
                setError(
                  "Google rejected the redirect URI. Copy the exact URI from step 6 above into " +
                    "Authorised redirect URIs on your OAuth client - it must match character for character.",
                );
              } else if (detail.includes("access_denied")) {
                setError(
                  "Google blocked the sign-in. While your app is in Testing, add your own Google " +
                    "account under Audience → Test users (step 4), then try again.",
                );
              } else if (detail.includes("invalid_client")) {
                setError(
                  "Google didn't recognise the client ID or secret. Re-copy both from the Credentials " +
                    "page - it's easy to paste the client ID twice.",
                );
              } else if (detail.includes("refresh token")) {
                setError(
                  `Google OAuth: ${detail}. Revoke DevHub's access in your Google Account permissions, then reconnect - ` +
                    "Google only issues a refresh token on the first consent.",
                );
              } else {
                setError(`Google OAuth failed: ${detail || "Try again."}`);
              }
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
    if (!pathsForm.repoRoot && !pathsForm.notesDir && !pathsForm.reposDir) return;
    const id = setTimeout(() => {
      fetch("/api/setup/validate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pathsForm),
      })
        .then((r) => r.json())
        .then((data: { repoRoot: PathCheck | null; notesDir: PathCheck | null; reposDir: PathCheck | null }) => {
          setPathChecks(data);
        })
        .catch(() => { /* ignore validation transport errors */ });
    }, 250);
    return () => clearTimeout(id);
  }, [pathsForm]);

  /*
    Goals narrow which integration steps get offered. Read once on mount (the
    page is client-side already) and only ever used to filter - the step rail
    below still reaches everything, so a wrong answer costs nothing.
  */
  const [goals, setGoals] = useState<GoalId[]>(() => {
    if (typeof window === "undefined") return [];
    return parseGoals(window.localStorage.getItem(SETUP_GOALS_KEY));
  });

  const updateGoals = useCallback((next: GoalId[]) => {
    setGoals(next);
    try {
      window.localStorage.setItem(SETUP_GOALS_KEY, JSON.stringify(next));
    } catch {
      /* private browsing - goals just won't persist */
    }
  }, []);

  const steps: Step[] = filterStepsByGoals(STEPS, goals).map((s) => {
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
        body.core = {
          repoRoot: pathsForm.repoRoot,
          notesDir: pathsForm.notesDir,
          reposDir: pathsForm.reposDir,
        };
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
      if (step.id === "agent") {
        body.agent = agentForm;
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
  }, [currentStep, pathsForm, datadogForm, calendarForm, jiraForm, biForm.capiRepoPath, agentForm, status, steps, goNext, loadSetupStatus]);

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
        <div className="text-sm text-text-subtle">Loading...</div>
      </div>
    );
  }

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;
  /*
    An empty code folder is valid — someone here for notes and tasks has no
    repositories, and blocking them on a path they do not have is how a setup
    wizard becomes a wall. Only a path the user actually typed has to resolve.
    The DevHub checkout is advanced and optional, so it never gates Next.
  */
  const pathsValid =
    step.id !== "paths" ||
    ((!pathsForm.notesDir || !!pathChecks.notesDir?.ok) &&
      (!pathsForm.reposDir || !!pathChecks.reposDir?.ok) &&
      (!pathsForm.repoRoot || !!pathChecks.repoRoot?.ok));

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
              width: "100%",
              transform: `scaleX(${Math.min(1, Math.max(0, progress / 100))})`,
              transformOrigin: "left center",
              background: "var(--accent)",
              borderRadius: "2px",
              transition: "transform 0.3s var(--ease-swift, ease)",
            }}
          />
        </div>

        {/* Step indicators - scroll horizontally on narrow screens rather than
            squishing; the active step always shows its label (see below) so
            mobile users can tell where they are. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            marginBottom: "32px",
            overflowX: "auto",
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
                whiteSpace: "nowrap",
                flexShrink: 0,
                transition: "all 0.15s ease",
              }}
            >
              {complete ? <CheckCircle2 size={14} /> : i === currentStep ? s.icon : <Circle size={14} style={{ opacity: 0.5 }} />}
              {/* Desktop shows every label; mobile shows only the active step's
                  label (icon-only otherwise) so the row stays compact but the
                  current step is always identifiable. */}
              <span className={i === currentStep ? "inline" : "hidden sm:inline"}>{s.title}</span>
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
            <WelcomeStep
              allowLan={allowLan}
              onAllowLanChange={setAllowLan}
              chamberUiPassword={chamberUiPassword}
              onChamberUiPasswordChange={setChamberUiPassword}
              hasExistingPassword={status?.hasOpenchamberUiPassword === true}
              goals={goals}
              onGoalsChange={updateGoals}
            />
          )}
          {step.id === "tools" && (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Tools on this machine
                </h2>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  DevHub drives command-line tools you already use. Missing an optional one just
                  means that feature stays off - nothing breaks.
                </p>
              </div>
              <DependencyChecklist />
            </div>
          )}
          {step.id === "paths" && (
            <PathsStep
              form={pathsForm}
              setForm={setPathsForm}
              checks={pathChecks}
              defaults={status.coreDefaults}
              error={error}
              desktop={status.desktop ?? false}
              hasCheckout={status.hasCheckout ?? true}
              onBrowse={browseForCodeFolder}
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
            <InfraStep
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
          {step.id === "agent" && (
            <AgentCliStep
              cli={agentForm.cli}
              onCliChange={(v) => setAgentForm((prev) => ({ ...prev, cli: v }))}
              opencodeModel={agentForm.opencodeModel}
              onOpencodeModelChange={(v) => setAgentForm((prev) => ({ ...prev, opencodeModel: v }))}
              cursorModel={agentForm.cursorModel}
              onCursorModelChange={(v) => setAgentForm((prev) => ({ ...prev, cursorModel: v }))}
              cursorAgentInstalled={status.agentVars?.cursorAgentInstalled === true}
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
                  className="btn btn-primary"
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
                        body: JSON.stringify({
                          network: {
                            allowLan,
                            // Only send when the user entered/generated one; empty
                            // preserves any existing password.
                            openchamberUiPassword: chamberUiPassword.trim() || undefined,
                          },
                        }),
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
                  className="btn btn-primary"
                >
                  {saving ? "Saving…" : "Get Started"} <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => (step.configured ? goNext() : void save())}
                  disabled={saving || !pathsValid}
                  className="btn btn-primary"
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
