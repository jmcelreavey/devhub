"use client";

import { AgentCapacityPanel } from "@/components/agents/AgentCapacityPanel";
import { EffortSelect, rememberEffort, rememberedEffortFor } from "@/components/agents/EffortSelect";
import { extraTaskInstructions, taskAutoLaunchOptions, useTaskAutoLaunch } from "./task-auto-launch";
import { startAuto } from "@/app/storyboard/board-actions";
import { storyboardHrefForTask } from "@/lib/storyboard/orchestration";
import { ModelSelect, ProviderSelect } from "@/components/agents/ProviderModelSelects";
import { effortOptionsForModel } from "@/lib/ai/effort";
import { WorkingFolderField } from "@/components/agents/WorkingFolderField";
import { ProviderError } from "@/components/agents/ProviderError";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ModalShell } from "@/components/shell/ModalShell";
import { AGENT_HANDOFF_EVENT,agentsHref,handoffPrompt,requestAgentConversation,type AgentHandoff } from "@/lib/agent-handoff";

/** One row of GET /api/agent/connection. */
interface LaunchAgent { id: string; name: string; ready: boolean; models: string[]; thinking?: Record<string, { id: string; label?: string }[]>; error?: string }
/** The assistant assigned to review an implementation before commit. Blank provider = the implementer reviews its own diff. */
interface ReviewChoice { provider: string; model: string; effort: string }
import { useToast } from "@/lib/hooks/use-toast";
import { TierInline } from "@/components/storyboard/TierInline";
import { withStepTier, type ModelTier, type ModelTierSettings, type TierStep } from "@/lib/storyboard/model-tiers-shared";
import { MODEL_TIERS_KEY, saveModelTiers } from "@/lib/storyboard/use-model-tiers";
import { Bot, RotateCw } from "lucide-react";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import { useEffect,useId,useRef,useState,type FormEvent,type ReactNode } from "react";

export interface LaunchIntent extends AgentHandoff { requestId: string }

export function AgentLaunchSheet() {
  const [intent, setIntent] = useState<LaunchIntent>();
  const token = useRef<string | undefined>(undefined);
  const router = useRouter();
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<AgentHandoff>).detail;
      if (!detail?.title) return;
      token.current = crypto.randomUUID();
      setIntent({ ...detail, requestId: token.current });
    };
    const navigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href?.startsWith("/") && !href.startsWith("//")) router.push(href);
    };
    window.addEventListener(AGENT_HANDOFF_EVENT, open);
    window.addEventListener("devhub:navigate", navigate);
    return () => { window.removeEventListener(AGENT_HANDOFF_EVENT, open); window.removeEventListener("devhub:navigate", navigate); };
  }, [router]);
  if (!intent) return null;
  return <AgentLaunchForm key={intent.requestId} intent={intent} current={() => token.current === intent.requestId} close={() => { token.current = undefined; setIntent(undefined); }} />;
}

interface AgentLaunchFormProps {
  intent: LaunchIntent;
  current: () => boolean;
  close: () => void;
  banner?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  resolveCwd?: () => Promise<string | undefined>;
  beforeStart?: () => Promise<void>;
  onStarted?: () => void;
  onProviderChange?: (id: string) => void;
  description?: string;
  cancelLabel?: string;
  launchButtonLabel?: string;
  promptDisclosureLabel?: string;
  showWorktreeOption?: boolean;
  requireExplicitDismissal?: boolean;
  /** A task step with a model tier: preselect the step's saved tier, with an inline control to pick another. */
  tierStep?: TierStep;
  allowAuto?: boolean;
  /** Run on auto starts checked for this launch (the "Start on auto" entry point). */
  autoByDefault?: boolean;
}

function rememberedModelFor(assistant: LaunchAgent | undefined, context: string): string {
  const saved = localStorage.getItem(`devhub:agent-model:${context}:${assistant?.id}`);
  return saved && assistant?.models.includes(saved) ? saved : "";
}

export function AgentLaunchForm({
  intent, current, close, banner, disabled, disabledReason, resolveCwd, beforeStart, onStarted, onProviderChange,
  description = "Choose an agent and review the handoff. The conversation continues in Agents.",
  cancelLabel = "Cancel", launchButtonLabel = "Start chat", promptDisclosureLabel, showWorktreeOption = true,
  requireExplicitDismissal = false, tierStep, allowAuto = false, autoByDefault = false,
}: AgentLaunchFormProps) {
  const formId = useId();
  const router = useRouter();
  const { openHref, canOpen } = useWorkspaceTabs();
  const pathname = usePathname();
  const initialPath = useRef(pathname);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptDirty = useRef(false);
  const generatedPrompt = useRef(intent.prompt ?? "");
  const [progress, setProgress] = useState("");
  // Parent re-renders can bring a new prompt. Don't clobber text the user already changed.
  useEffect(() => {
    if (!promptDirty.current && promptRef.current && intent.prompt != null) {
      promptRef.current.value = intent.prompt;
      generatedPrompt.current = intent.prompt;
    }
  }, [intent.prompt]);
  const [cwd, setCwd] = useState(intent.cwd || "");
  const [repoName, setRepoName] = useState(intent.repoName || "");
  const [assistants, setAssistants] = useState<LaunchAgent[]>();
  const [assistantId, setAssistantId] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [tierSettings, setTierSettings] = useState<ModelTierSettings>();
  const [tier, setTier] = useState<ModelTier>();
  const [tierCustomized, setTierCustomized] = useState(false);
  const [saveTier, setSaveTier] = useState(false);
  const [worktree, setWorktree] = useState(intent.worktree ?? intent.kind !== "review");
  const isImplement = intent.stage === "implement";
  const canAuto = allowAuto && isImplement && !!intent.taskId && !!intent.taskDate && !intent.parentRunId && !intent.resumeSessionId && !intent.kind;
  const { profile, profileError, runOnAuto, setRunOnAuto } = useTaskAutoLaunch(canAuto, autoByDefault);
  const [pauseAfterPlan, setPauseAfterPlan] = useState(true);
  const [skipPlan, setSkipPlan] = useState(false);
  // Who reviews the finished diff. Hidden until the saved choice loads, so a failed read never blocks a launch.
  const [review, setReview] = useState<ReviewChoice>();
  const savedReview = useRef<ReviewChoice>({ provider: "", model: "", effort: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The limit refused this start: show which agents hold it, with a way to clear stale ones.
  const [atLimit, setAtLimit] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const toast = useToast();
  useEffect(() => {
    let disposed = false;
    // Loaded alongside the agents so the saved tier's agent and model are the first selection, not a correction.
    const tiersPromise: Promise<ModelTierSettings | null> = tierStep
      ? fetch(MODEL_TIERS_KEY).then((response) => (response.ok ? response.json() : null)).then((body: { settings?: ModelTierSettings } | null) => body?.settings ?? null).catch(() => null)
      : Promise.resolve(null);
    void fetch("/api/agent/connection", { signal: AbortSignal.timeout(15_000) }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.connected) throw new Error(data.error || "Paseo isn't running. Check Agents → Connection.");
      if (disposed) return;
      setError("");
      const rows: LaunchAgent[] = data.agents ?? [];
      const loadedTiers = await tiersPromise;
      if (disposed) return;
      setAssistants(rows);
      const stepTier = tierStep && loadedTiers ? loadedTiers.steps[tierStep] : undefined;
      const tierChoice = stepTier && loadedTiers ? loadedTiers.tiers[stepTier] : undefined;
      if (stepTier && loadedTiers) {
        setTierSettings(loadedTiers);
        setTier(stepTier);
      }
      const preferred = intent.provider === "chatgpt" ? "codex" : intent.provider;
      const saved = localStorage.getItem(`devhub:agent-choice:${intent.stage || intent.kind || "agent"}`);
      const selected = rows.find((a) => a.id === preferred)
        ?? (tierChoice?.provider ? rows.find((a) => a.id === tierChoice.provider && a.ready) : undefined)
        ?? rows.find((a) => a.id === saved && a.ready)
        ?? rows.find((a) => a.id === data.defaultAgentId && a.ready)
        ?? rows.find((a) => a.ready)
        ?? rows[0];
      setAssistantId(selected?.id || "");
      const tierModel = tierChoice?.model && (!tierChoice.provider || tierChoice.provider === selected?.id) && selected?.models.includes(tierChoice.model) ? tierChoice.model : "";
      const nextModel = tierModel || (tierChoice?.provider === selected?.id && tierChoice?.provider ? "" : rememberedModelFor(selected, intent.stage || intent.kind || "agent"));
      setModel(nextModel);
      setEffort(rememberedEffortFor(
        selected?.id || "",
        nextModel,
        nextModel ? selected?.thinking?.[nextModel] : undefined,
        selected?.models,
      ));
      if (!intent.cwd && !intent.repoName) setCwd(data.defaultCwd || "");
    }).catch((err: unknown) => {
      if (!disposed) setError(err instanceof Error && err.name === "TimeoutError"
        ? "Loading agents took too long. Retry the connection."
        : err instanceof Error ? err.message : "Could not load agents.");
    });
    return () => { disposed = true; };
  }, [intent.provider, intent.cwd, intent.repoName, intent.kind, intent.stage, connectionAttempt, tierStep]);

  /** Switch the launch to another tier's agent and model. Agent and Model stay editable afterwards. */
  function chooseTier(next: ModelTier) {
    setTierCustomized(false);
    setTier(next);
    const choice = tierSettings?.tiers[next];
    if (!choice || !assistants) return;
    const agent = choice.provider ? assistants.find((row) => row.id === choice.provider && row.ready) : assistants.find((row) => row.id === assistantId);
    if (!agent) return;
    const nextModel = choice.model && agent.models.includes(choice.model) ? choice.model : "";
    setAssistantId(agent.id);
    setModel(nextModel);
    setEffort(rememberedEffortFor(agent.id, nextModel, nextModel ? agent.thinking?.[nextModel] : undefined, agent.models));
    onProviderChange?.(agent.id);
  }

  useEffect(() => {
    if (!isImplement) return;
    let disposed = false;
    void fetch("/api/tasks/implement/review-settings").then(async (response) => {
      const data = await response.json();
      if (!response.ok || disposed) return;
      savedReview.current = { provider: data.provider ?? "", model: data.model ?? "", effort: data.effort ?? "" };
      setReview(savedReview.current);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [isImplement]);

  async function saveReviewChoice() {
    if (!isImplement || !review) return;
    if (review.provider === savedReview.current.provider && review.model === savedReview.current.model && review.effort === savedReview.current.effort) return;
    const response = await fetch("/api/tasks/implement/review-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(review) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not save the review assistant.");
    savedReview.current = review;
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setAtLimit(false); setProgress("Starting…");
    const locationAtStart = window.location.href;
    // The form can unmount during preflight when the user continues in the background.
    const prompt = promptRef.current?.value ?? intent.prompt ?? "";
    const generatedAtStart = generatedPrompt.current;
    try {
      if (disabled) throw new Error(disabledReason || "This task is not ready to start.");
      if (!runOnAuto && !prompt.trim()) throw new Error("Enter instructions for the agent.");
      await beforeStart?.();
      const [folder] = await Promise.all([
        (async () => cwd.trim() || (await resolveCwd?.()))(),
        // Remember the reviewer whichever way it launches; skipping it on auto meant the sheet kept reopening on a stale choice.
        saveReviewChoice(),
      ]);
      if (!folder) throw new Error("Pick a working folder.");
      // Reopen on what was actually launched, even when the effort came from a tier rather than the dropdown.
      if (assistantId) rememberEffort(assistantId, model, effort);
      if (runOnAuto && intent.taskId && intent.taskDate) {
        const result = await startAuto({ taskId: intent.taskId, date: intent.taskDate }, {
          ...taskAutoLaunchOptions({
            choice: { provider: assistantId, model, effort }, review, tier: tierCustomized ? undefined : tier, settings: tierSettings,
            instructions: extraTaskInstructions(prompt, generatedAtStart), worktree, skipPlan,
          }),
          cwd: folder, repoName: repoName || intent.repoName, pauseAfterPlan,
        }, profile);
        if (!result.ok) throw new Error(result.error ?? "Couldn't start the task on auto");
        const summary = result.summary;
        if (summary?.status === "needs-you") toast.info("On auto, but it needs you: which repo should it run in?");
        else if (summary?.status === "paused") toast.error(`On auto, but planning didn't start: ${summary.lastError ?? "unknown error"}`);
        else toast.success(result.runId ? "On auto: planning started" : "Already on auto");
        if (tierStep && tier && tierSettings && saveTier && tier !== tierSettings.steps[tierStep]) {
          void saveModelTiers(withStepTier(tierSettings, tierStep, tier)).then((ok) => ok ? toast.success("Tier saved as the default.") : toast.error("Couldn't save the tier default."));
        }
        onStarted?.();
        if (current() && window.location.href === locationAtStart) {
          router.push(storyboardHrefForTask(intent.taskId));
          close();
        }
        return;
      }
      const response = await fetch("/api/agent/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        provider: assistantId, model: model || undefined, ...(effort ? { effort } : {}), prompt: handoffPrompt(prompt, intent.context, intent.notePath), defer: false,
        cwd: folder, title: (intent.runTitle || intent.title).slice(0, 80), worktree, requestId: intent.requestId,
        taskId: intent.taskId, taskDate: intent.taskDate, action: intent.stage || intent.kind || "agent",
        repoName: repoName || intent.repoName, notePath: intent.notePath, prUrl: intent.prUrl, headSha: intent.headSha,
        parentRunId: intent.parentRunId, resumeSessionId: intent.resumeSessionId,
        ...(tierStep && tier ? { tier } : {}),
      }) });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "capacity") {
          if (current()) setAtLimit(true);
          throw new Error("All of DevHub's agent slots are in use. Clear a stale agent below, or wait for one to finish, then start again.");
        }
        throw new Error(data.error || "Could not start the chat.");
      }
      if (data.run?.state === "failed") {
        throw new Error(data.run.error || "Paseo could not start this session. Choose another model or check Agents → Connection.");
      }
      const href = agentsHref(data.run.conversationId, data.run.id);
      const pendingText = data.run.conversationId ? "Your agent is ready in Agents Activity." : "Your agent is starting in Agents Activity.";
      if (tierStep && tier && tierSettings && saveTier && tier !== tierSettings.steps[tierStep]) {
        void saveModelTiers(withStepTier(tierSettings, tierStep, tier)).then((ok) => (ok ? toast.success("Tier saved as the default.") : toast.error("Couldn't save the tier default.")));
      }
      localStorage.setItem(`devhub:agent-choice:${intent.stage || intent.kind || "agent"}`, assistantId);
      localStorage.setItem(`devhub:agent-model:${intent.stage || intent.kind || "agent"}:${assistantId}`, model);
      if (data.run.state !== "failed") onStarted?.();
      if (current() && window.location.href === locationAtStart && pathname === initialPath.current) {
        // Navigate before closing: closing unmounts the form.
        if (intent.stage === "plan" || intent.stage === "implement") {
          if (canOpen) openHref(href, { newTab: true });
          else toast.info(pendingText);
        } else {
          if (data.run.conversationId) requestAgentConversation(data.run.conversationId);
          router.push(href);
        }
        close();
      } else toast.info(pendingText);
    } catch (err) { if (current()) setError(err instanceof Error ? err.message : "Could not start the chat. Check Activity before retrying."); }
    finally { setBusy(false); setProgress(""); }
  }

  const selected = assistants?.find((a) => a.id === assistantId);
  const reviewAssistant = assistants?.find((a) => a.id === review?.provider);
  const modelThinking = model ? selected?.thinking?.[model] : undefined;
  const mainEffort = effortOptionsForModel({
    provider: assistantId,
    model,
    thinkingOptions: modelThinking,
    availableModels: selected?.models,
  });
  const reviewThinking = review?.model ? reviewAssistant?.thinking?.[review.model] : undefined;
  const reviewEffort = review?.provider ? effortOptionsForModel({
    provider: review.provider,
    model: review.model,
    thinkingOptions: reviewThinking,
    availableModels: reviewAssistant?.models,
  }) : null;
  const promptField = (
    <>
    <label className="block text-sm">
      {intent.context ? "What would you like the agent to do?" : "Task"}
      <textarea ref={promptRef} className="input mt-1 w-full" rows={5} maxLength={32000} defaultValue={intent.prompt ?? ""} onChange={() => { promptDirty.current = true; }} required={!runOnAuto && !promptDisclosureLabel} />
    </label>
    {runOnAuto && <p className="mt-1 text-xs text-text-muted">Only your added instructions go to auto. DevHub keeps its built-in planning and implementation briefs.</p>}
    </>
  );
  return (
    <ModalShell
      open
      onClose={close}
      title={intent.title}
      description={description}
      icon={<Bot size={16} />}
      maxWidth="max-w-2xl"
      dismissOnBackdrop={false}
      dismissOnEscape={!requireExplicitDismissal}
      footer={
        <div className="space-y-3">
          {canAuto && <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={runOnAuto} disabled={busy || profile === undefined} onChange={(event) => setRunOnAuto(event.target.checked)} />Run on auto</label>
            {profileError && <p className="text-xs text-text-muted">Couldn’t load the task profile. Refresh before starting on auto.</p>}
            {runOnAuto && <div className="space-y-2 pl-5 text-text-muted">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={skipPlan} disabled={busy} onChange={(event) => setSkipPlan(event.target.checked)} />Skip planning and implement straight away</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={pauseAfterPlan && !skipPlan} disabled={busy || skipPlan} onChange={(event) => setPauseAfterPlan(event.target.checked)} />Pause after planning</label>
              <p className="text-xs">Plan and implement use your launch model and effort. Review uses your chosen reviewer, or the saved Review tier.</p>
              {review && !review.provider && <p className="text-xs">{"On auto, “Same agent” isn't used: review runs separately on the saved Review tier."}</p>}
              {!worktree && <p className="text-xs">{"On auto, running in your checkout isn't guaranteed: unsafe checkouts use an isolated worktree."}</p>}
            </div>}
          </div>}
          {progress ? <p className="text-sm text-text-muted" role="status">{progress}</p> : null}
          <div className="flex items-center justify-end gap-3">
            <button type="button" className="btn btn-ghost" onClick={close}>{busy ? "Continue in background" : cancelLabel}</button>
            <button type="submit" form={formId} className="btn btn-primary gap-2" disabled={disabled || busy || !selected?.ready}>
              {busy && <RotateCw size={14} className="animate-spin" aria-hidden />}
              {busy ? "Starting…" : runOnAuto ? "Start on auto" : launchButtonLabel}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {banner}
        {tierStep && tierSettings && tier ? <TierInline step={tierStep} settings={tierSettings} tier={tier} onTier={chooseTier} save={saveTier} onSave={setSaveTier} /> : null}
        {!assistants && !error && <div role="status" aria-label="Loading agents"><SkeletonRows count={2} height={40} /></div>}
        {assistants && assistants.length > 0 && (
          <div className={mainEffort ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
            <ProviderSelect
              label="Agent"
              value={assistantId}
              options={assistants.map((assistant) => ({
                id: assistant.id,
                label: `${assistant.name}${assistant.ready ? "" : " — not ready"}`,
                disabled: !assistant.ready,
                title: assistant.error,
              }))}
              onChange={(id) => {
                setTierCustomized(true);
                const assistant = assistants.find((row) => row.id === id);
                const nextModel = rememberedModelFor(assistant, intent.stage || intent.kind || "agent");
                setAssistantId(id);
                setModel(nextModel);
                setEffort(rememberedEffortFor(
                  id,
                  nextModel,
                  nextModel ? assistant?.thinking?.[nextModel] : undefined,
                  assistant?.models,
                ));
                onProviderChange?.(id);
              }}
            />
            <ModelSelect
              label="Model"
              value={model}
              models={selected?.models ?? []}
              disabled={!selected?.ready}
              onChange={(next) => {
                setTierCustomized(true);
                setModel(next);
                setEffort(rememberedEffortFor(
                  assistantId,
                  next,
                  selected?.thinking?.[next],
                  selected?.models,
                ));
              }}
            />
            <EffortSelect
              provider={assistantId}
              model={model}
              thinkingOptions={modelThinking}
              availableModels={selected?.models}
              value={effort}
              onChange={setEffort}
            />
          </div>
        )}
        {assistants && (assistants.length === 0 || (selected && !selected.ready)) && (
          <div className="tone-panel tone-panel--warning space-y-2 p-3 text-sm">
            <p role="status">{selected ? selected.error || `${selected.name} isn’t ready. Choose another agent or check the connection.` : "No agents are available. Check your connection to add one."}</p>
            <Link href="/agents?view=connection" className="underline" onClick={close}>Check Agents → Connection</Link>
          </div>
        )}
        {isImplement && assistants && review && (
          <div className="space-y-1">
            <div className={reviewEffort ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
              <ProviderSelect
                label="Review with"
                value={review.provider}
                defaultOption="Same agent (default)"
                options={[
                  ...(review.provider && !reviewAssistant ? [{
                    id: review.provider,
                    label: `${review.provider} — not available`,
                    disabled: true,
                  }] : []),
                  ...assistants.map((assistant) => ({
                    id: assistant.id,
                    label: `${assistant.name}${assistant.ready ? "" : " — not ready"}`,
                    disabled: !assistant.ready,
                    title: assistant.error,
                  })),
                ]}
                onChange={(provider) => {
                  const assistant = assistants.find((row) => row.id === provider);
                  setReview({
                    provider,
                    model: "",
                    effort: rememberedEffortFor(provider, "", undefined, assistant?.models),
                  });
                }}
              />
              <ModelSelect
                label="Review model"
                value={review.model}
                models={reviewAssistant?.models ?? []}
                disabled={!review.provider}
                onChange={(next) => setReview({
                  ...review,
                  model: next,
                  effort: rememberedEffortFor(
                    review.provider,
                    next,
                    reviewAssistant?.thinking?.[next],
                    reviewAssistant?.models,
                  ),
                })}
              />
              {review.provider && (
                <EffortSelect
                  provider={review.provider}
                  model={review.model}
                  thinkingOptions={reviewThinking}
                  availableModels={reviewAssistant?.models}
                  value={review.effort}
                  label="Review effort"
                  disabled={!review.provider}
                  onChange={(next) => setReview({ ...review, effort: next })}
                />
              )}
            </div>
            <p className="text-xs text-text-muted">{review.provider ? "That assistant reviews the finished diff before you're asked to commit. It reads the code and writes the review note; it doesn't change anything." : "The implementing agent reviews its own diff before you're asked to commit."}</p>
          </div>
        )}
        <WorkingFolderField
          cwd={cwd}
          repoName={intent.repoName}
          onChange={(next) => { setCwd(next.path); setRepoName(next.name); }}
        />
        {promptDisclosureLabel ? (
          <details>
            <summary className="cursor-pointer text-sm">{promptDisclosureLabel}</summary>
            <div className="mt-3">{promptField}</div>
          </details>
        ) : promptField}
        {intent.context && <details open><summary className="text-sm cursor-pointer">Captured terminal context · {intent.context.length.toLocaleString()} characters</summary><pre className="text-xs whitespace-pre-wrap break-words max-h-48 overflow-auto bg-bg-surface p-3 mt-2 rounded">{intent.context}</pre></details>}
        {showWorktreeOption && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />Use an isolated worktree</label>}
        {error && (
          <div className="tone-panel tone-panel--warning space-y-2 p-3 text-sm">
            {atLimit ? <p role="alert">{error}</p> : <ProviderError provider={selected?.name} error={error} />}
            {!assistants && <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-ghost text-xs" onClick={() => { setError(""); setConnectionAttempt((value) => value + 1); }}>Retry connection</button>
              <Link href="/agents?view=connection" className="underline" onClick={close}>Check Agents → Connection</Link>
            </div>}
          </div>
        )}
        {atLimit && <AgentCapacityPanel onFreed={() => { setAtLimit(false); setError(""); }} />}
        {disabled && disabledReason && <p className="text-sm text-text-muted">{disabledReason}</p>}
      </form>
    </ModalShell>
  );
}
