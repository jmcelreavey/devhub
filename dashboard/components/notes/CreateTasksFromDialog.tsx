"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";
import { EffortSelect } from "@/components/agents/EffortSelect";
import { ModelSelect, ProviderSelect } from "@/components/agents/ProviderModelSelects";
import { effortOptionsForModel, resolveCursorModelEffort } from "@/lib/ai/effort";
import type { AgentCliConfig, AiProviderId } from "@/lib/agent/cli-config";
import { useLive } from "@/lib/hooks/use-fetch";
import { useStoredState } from "@/lib/hooks/use-stored-state";
import type { WorkItemTitleOptions } from "@/lib/notes/work-item-titles";
import { KIND_ICON, SharedEntityChips } from "@/components/EntityLinkChips";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ModalShell } from "@/components/shell/ModalShell";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { parseImageMarkdownLine, toNoteAssetApiUrl } from "@shared/notes-assets/markdown.ts";
import { JIRA_KEY_RE } from "@/lib/utils";
import {
  buildCreateTasksFromPrompt,
  createTasksPlanUrl,
  type PlanWorkItem,
} from "@/lib/notes/create-tasks-from";
import { defaultHrefForRef, entityKey, mergeEntityRefs, parseEntityLinksFromMarkdown, type EntityRef } from "@/lib/entity-note";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;
const TITLE_PROVIDERS = [
  { id: "cursor-cli", label: "Cursor CLI", available: "cursorAgentInstalled" },
  { id: "chatgpt-cli", label: "ChatGPT CLI", available: "chatgptCliInstalled" },
  { id: "antigravity-cli", label: "Antigravity CLI", available: "antigravityCliInstalled" },
  { id: "opencode", label: "OpenCode", available: "opencodeInstalled" },
  { id: "api", label: "AI API", available: "apiConfigured" },
] as const;

interface TitlePreferences {
  provider: AiProviderId | "";
  model: string;
  effort: string;
}

const DEFAULT_TITLE_PREFERENCES: TitlePreferences = { provider: "", model: "", effort: "" };

function parseTitlePreferences(raw: string): TitlePreferences | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("provider" in value) || !("model" in value) || !("effort" in value)) return;
    if (value.provider !== "" && !TITLE_PROVIDERS.some((provider) => provider.id === value.provider)) return;
    if (typeof value.model !== "string" || value.model.length > 256 || /[\r\n\0]/.test(value.model)) return;
    if (typeof value.effort !== "string" || !/^[A-Za-z0-9_-]{0,32}$/.test(value.effort)) return;
    return {
      provider: value.provider as TitlePreferences["provider"],
      model: value.provider ? value.model : "",
      effort: value.provider ? value.effort : "",
    };
  } catch {
    return undefined;
  }
}

function imageSrc(url: string): string {
  return url.startsWith("/") ? url : toNoteAssetApiUrl(url);
}

function descriptionWithoutImages(description: string): string {
  return description.split("\n").filter((line) => !parseImageMarkdownLine(line)).join("\n").trim();
}

function projectOf(key: string | undefined, fallback = "PTF"): string {
  if (!key) return fallback;
  const prefix = key.split("-")[0]?.toUpperCase();
  return prefix && PROJECT_KEY_RE.test(prefix) ? prefix : fallback;
}

interface PlanPreview {
  title: string;
  workItems: PlanWorkItem[];
  warning?: string;
}

async function loadPlanPreview(
  notePath: string,
  signal: AbortSignal,
  refineTitles = false,
  options: WorkItemTitleOptions = {},
): Promise<PlanPreview> {
  const response = await fetch("/api/notes/create-tasks/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notePath, refineTitles, ...options }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Couldn’t load the work items");
  }
  return response.json() as Promise<PlanPreview>;
}

interface Props {
  open: boolean;
  notePath: string;
  /** Latest markdown supplies entity links; the saved note is the preview source. */
  noteMarkdown?: string | null;
  onClose: () => void;
}

function PlanLinkField({ label, refs, action, onAdd, onRemove }: {
  label: string;
  refs: EntityRef[];
  action: string;
  onAdd: () => void;
  onRemove: (ref: EntityRef) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-medium text-text-subtle">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {refs.length > 0 ? (
          <ul className="entity-link-chips min-w-0" aria-label={label}>
            {refs.map((ref) => {
              const Icon = KIND_ICON[ref.kind];
              const text = ref.label || ref.id;
              const href = ref.href ?? defaultHrefForRef(ref);
              const external = !!href && /^https?:\/\//i.test(href);
              return (
                <li key={entityKey(ref)} className="entity-link-chip-item min-w-0 max-w-full">
                  <a
                    href={href ?? undefined}
                    className="entity-link-chip max-w-full"
                    data-kind={ref.kind}
                    title={text}
                    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    <Icon size={12} aria-hidden />
                    <span className="truncate">{text}</span>
                  </a>
                  <button type="button" className="entity-link-chip-remove" aria-label={`Remove ${text} link`} onClick={() => onRemove(ref)}>
                    <X size={12} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <button type="button" className="btn btn-ghost text-xs" onClick={onAdd}>
          <Plus size={14} aria-hidden />
          {action}
        </button>
      </div>
    </fieldset>
  );
}

export function CreateTasksFromDialog({ open, ...props }: Props) {
  return open ? <CreateTasksFromForm key={props.notePath} {...props} /> : null;
}

function CreateTasksFromForm({ notePath, noteMarkdown, onClose }: Omit<Props, "open">) {
  const linkedFromEditor = useMemo(() => {
    if (!noteMarkdown) return { jira: [] as EntityRef[], repos: [] as EntityRef[] };
    const links = parseEntityLinksFromMarkdown(noteMarkdown);
    return {
      jira: links.filter((l) => l.kind === "jira"),
      repos: links.filter((l) => l.kind === "repo"),
    };
  }, [noteMarkdown]);

  const [parent, setParent] = useState<EntityRef | null>(() => linkedFromEditor.jira[0] ?? null);
  const parentKey = parent?.id.toUpperCase() ?? "";
  const [projectKey, setProjectKey] = useState(() => projectOf(linkedFromEditor.jira[0]?.id));
  const [epicSummary, setEpicSummary] = useState<string | null>(null);
  const [repos, setRepos] = useState(() => linkedFromEditor.repos);
  const [linkKind, setLinkKind] = useState<"jira" | "repo" | null>(null);
  const [instructions, setInstructions] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [workItems, setWorkItems] = useState<PlanWorkItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refining, setRefining] = useState(false);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const refinementController = useRef<AbortController | null>(null);
  const [titlePreferences, setTitlePreferences] = useStoredState<TitlePreferences>(
    "devhub:title-suggestions", DEFAULT_TITLE_PREFERENCES, parseTitlePreferences, JSON.stringify,
  );
  const { data: aiConfig, error: aiConfigError, isLoading: aiConfigLoading, mutate: retryAiConfig } = useLive<
    AgentCliConfig & { resolvedProvider: AiProviderId | null }
  >("/api/agent-cli", { refreshInterval: 0 });
  const defaultProvider = aiConfig?.resolvedProvider ?? aiConfig?.provider;
  const defaultProviderLabel = TITLE_PROVIDERS.find((provider) => provider.id === defaultProvider)?.label;
  const configuredModel = titlePreferences.provider === "cursor-cli" ? aiConfig?.cursorModel
    : titlePreferences.provider === "opencode" ? aiConfig?.opencodeModel
    : titlePreferences.provider === "antigravity-cli" ? aiConfig?.antigravityModel : "";
  const titleModels = useMemo(
    () => titlePreferences.provider ? aiConfig?.models?.[titlePreferences.provider] ?? [] : [],
    [aiConfig?.models, titlePreferences.provider],
  );
  const suggestionModel = titlePreferences.model.trim() || configuredModel || "";
  const effortOptions = effortOptionsForModel({
    provider: titlePreferences.provider,
    model: suggestionModel,
    availableModels: titleModels,
  });
  const suggestionEffort = effortOptions?.some((option) => option.id === titlePreferences.effort) ? titlePreferences.effort : "";

  useEffect(() => {
    if (!titlePreferences.provider || titleModels.length === 0) return;
    let model = titlePreferences.model.trim();
    let effort = titlePreferences.effort;
    if (model && !titleModels.includes(model)) {
      const migrated = titlePreferences.provider === "cursor-cli"
        ? resolveCursorModelEffort(model, effort, titleModels)
        : "";
      model = titleModels.includes(migrated) ? migrated : "";
      effort = "";
    }
    const availableEfforts = effortOptionsForModel({
      provider: titlePreferences.provider,
      model: model || configuredModel || "",
      availableModels: titleModels,
    });
    if (effort && !availableEfforts?.some((option) => option.id === effort)) effort = "";
    if (model !== titlePreferences.model || effort !== titlePreferences.effort) {
      setTitlePreferences({ ...titlePreferences, model, effort });
    }
  }, [configuredModel, setTitlePreferences, titleModels, titlePreferences]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadPreview() {
      try {
        const result = await loadPlanPreview(notePath, AbortSignal.any([
          controller.signal, AbortSignal.timeout(15_000),
        ]));
        if (controller.signal.aborted) return;
        setPreview(result);
        setWorkItems(result.workItems);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewError(error instanceof Error ? error.message : "Couldn't load the note");
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }
    void loadPreview();
    return () => {
      controller.abort();
      refinementController.current?.abort();
    };
  }, [notePath, attempt]);

  function retryPreview() {
    setPreviewError(null);
    setPreviewLoading(true);
    setAttempt((value) => value + 1);
  }

  async function refineTitles() {
    if (refining || workItems.length === 0) return;
    const controller = new AbortController();
    refinementController.current = controller;
    const originalSummaries = new Map(workItems.map((item) => [item.id, item.summary]));
    setRefining(true);
    setRefinementError(null);
    try {
      const result = await loadPlanPreview(notePath, controller.signal, true, {
        provider: titlePreferences.provider || undefined,
        model: titlePreferences.model.trim() || undefined,
        effort: suggestionEffort || undefined,
      });
      if (controller.signal.aborted) return;
      if (result.warning) {
        setRefinementError(result.warning);
        return;
      }
      const suggestions = new Map(result.workItems.map((item) => [item.id, item.summary]));
      // Suggestions must not overwrite edits or restore removed work items.
      setWorkItems((items) => items.map((item) => {
        const summary = suggestions.get(item.id);
        return summary && item.summary === originalSummaries.get(item.id) ? { ...item, summary } : item;
      }));
      setPreview((current) => current ? { ...current, warning: undefined } : current);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRefinementError(error instanceof Error ? error.message : "Couldn’t suggest titles. You can edit them below.");
      }
    } finally {
      if (!controller.signal.aborted) setRefining(false);
    }
  }

  const parentValid = !parentKey.trim() || JIRA_KEY_RE.test(parentKey.trim().toUpperCase());
  const projectValid = PROJECT_KEY_RE.test(projectKey.trim().toUpperCase());
  const titlesValid = workItems.every((item) => item.summary.trim().length > 0 && item.summary.trim().length <= 255);
  const parentTitle = epicSummary ?? preview?.title ?? "";

  const promptInput = () => ({
    origin: window.location.origin,
    notePath,
    parentKey: parentKey.trim() || undefined,
    projectKey: projectKey.trim() || undefined,
    epicSummary: parentTitle.trim() || undefined,
    repos: repos.map((repo) => repo.id),
    instructions: instructions.trim() || undefined,
    workItems: workItems.map((item) => ({ ...item, summary: item.summary.trim() })),
  });

  return (
    <>
      <ModalShell
        open={!agentOpen && linkKind === null}
        onClose={onClose}
        title="Create tasks from plan"
        description="Review the work items and links, then choose an agent to create the tickets and tasks."
        maxWidth="max-w-2xl"
        dismissOnBackdrop={false}
        dismissOnEscape={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!parentValid || !projectValid || !titlesValid || previewLoading || !!previewError || !preview || workItems.length === 0}
              onClick={() => {
                refinementController.current?.abort();
                setRefining(false);
                setAgentOpen(true);
              }}
            >
              Choose agent…
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <PlanLinkField
              label="Parent Jira ticket (optional)"
              refs={parent ? [parent] : []}
              action={parent ? "Change parent ticket…" : "Choose parent ticket…"}
              onAdd={() => setLinkKind("jira")}
              onRemove={() => setParent(null)}
            />
            <p className="mt-1 text-xs text-text-subtle">
              {parent ? "Each work item becomes a sub-task of this ticket." : "Choose an existing ticket, or create a new parent below."}
            </p>
          </div>

          {!parent ? <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">Project</span>
              <input
                className="input mt-1 w-full font-mono"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-subtle">New parent ticket title</span>
              <input
                className="input mt-1 w-full"
                value={parentTitle}
                onChange={(e) => setEpicSummary(e.target.value)}
                placeholder={preview?.title ?? "Parent ticket title"}
                maxLength={255}
              />
            </label>
          </div> : null}

          <PlanLinkField
            label="Repositories"
            refs={repos}
            action="Add repositories…"
            onAdd={() => setLinkKind("repo")}
            onRemove={(ref) => setRepos((current) => current.filter((repo) => entityKey(repo) !== entityKey(ref)))}
          />

          <label className="block">
            <span className="text-xs font-medium text-text-subtle">Instructions (optional)</span>
            <textarea
              className="input mt-1 w-full text-sm"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Any extra context for the tickets. Only the work items you keep below will be created."
            />
          </label>

          <section aria-label="Work items" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">
                  {previewLoading ? "Loading work items…" : `Work items (${workItems.length})`}
                </h3>
                <p className="mt-1 text-xs text-text-subtle">
                  Edit titles or remove items before launching. Original issue details stay attached.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  disabled={previewLoading || !!previewError || workItems.length === 0 || refining}
                  onClick={() => void refineTitles()}
                >
                  {refining ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
                  {refining ? "Suggesting titles…" : "Suggest titles"}
                </button>
                {refining ? <button type="button" className="btn btn-ghost text-xs" onClick={() => {
                  refinementController.current?.abort();
                  setRefining(false);
                }}>Stop</button> : null}
              </div>
            </div>
            <details className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Title suggestion model</summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-text-subtle">Remembered for title suggestions. The ticket-creation agent has its own model.</p>
                {aiConfigLoading ? <SkeletonRows count={1} height={16} /> : null}
                {aiConfigError ? <FetchError bare message="Couldn’t check available providers." onRetry={() => void retryAiConfig()} /> : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ProviderSelect
                    label="Suggestion provider"
                    value={titlePreferences.provider}
                    defaultOption={`Use Setup default${defaultProviderLabel ? ` (${defaultProviderLabel})` : ""}`}
                    disabled={refining}
                    options={TITLE_PROVIDERS.map((provider) => ({
                      id: provider.id,
                      label: `${provider.label}${aiConfig?.[provider.available] === false ? " (unavailable)" : ""}`,
                      disabled: aiConfig?.[provider.available] === false,
                    }))}
                    onChange={(provider) => {
                      setTitlePreferences({ provider: provider as TitlePreferences["provider"], model: "", effort: "" });
                    }}
                  />
                  <ModelSelect
                    label="Suggestion model"
                    value={titlePreferences.model}
                    models={titleModels}
                    defaultOption={configuredModel ? `Provider default (${configuredModel})` : "Provider default"}
                    disabled={refining || !titlePreferences.provider}
                    onChange={(model) => setTitlePreferences({ ...titlePreferences, model, effort: "" })}
                  />
                  {titlePreferences.provider && (titlePreferences.provider !== "api" || suggestionModel) ? (
                    <EffortSelect
                      provider={titlePreferences.provider}
                      model={suggestionModel}
                      availableModels={titleModels}
                      label="Suggestion effort"
                      value={suggestionEffort}
                      disabled={refining}
                      remember={false}
                      onChange={(effort) => setTitlePreferences({ ...titlePreferences, effort })}
                    />
                  ) : null}
                </div>
                <p className="text-xs text-text-subtle">Models come from the provider’s live catalog. Leave it on Provider default to use your Setup choice.</p>
              </div>
            </details>
            {refining ? <p role="status" className="text-xs text-text-subtle">You can edit or launch while suggestions load.</p> : null}
            {refinementError ? <FetchError bare message={refinementError} onRetry={() => void refineTitles()} /> : null}
            {previewError ? (
              <FetchError bare message={previewError} onRetry={retryPreview} />
            ) : previewLoading ? (
              <div role="status" aria-label="Loading work items">
                <SkeletonRows count={3} height={64} />
              </div>
            ) : (
              <>
                {preview?.warning ? (
                  <p role="status" className="tone-panel tone-panel--warning p-3 text-sm">{preview.warning}</p>
                ) : null}
                {workItems.length === 0 ? (
                  <p className="text-sm text-text-subtle">
                    {preview?.workItems.length
                      ? "All work items removed. No tickets will be created."
                      : "No work items found. Add bullets, a checklist, or PR sections to the note and reopen this dialog."}
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {workItems.map((item, index) => (
                      <li key={item.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start gap-2">
                          <label className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs text-text-subtle">Ticket {index + 1} title</span>
                            <textarea
                              className="input w-full min-h-14 resize-y text-sm [field-sizing:content]"
                              rows={2}
                              value={item.summary}
                              maxLength={255}
                              aria-invalid={!item.summary.trim()}
                              onChange={(event) => {
                                const summary = event.target.value.replace(/[\r\n]+/g, " ");
                                setWorkItems((items) => items.map((current) => current.id === item.id ? { ...current, summary } : current));
                              }}
                            />
                            {!item.summary.trim() ? <span className="mt-1 block text-xs text-danger">Enter a ticket title.</span> : null}
                          </label>
                          <button
                            type="button"
                            className="btn btn-ghost mt-5 shrink-0"
                            aria-label={`Remove ticket ${index + 1}`}
                            title="Remove this work item"
                            onClick={() => setWorkItems((items) => items.filter((current) => current.id !== item.id))}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                        <details className="mt-2 text-xs text-text-subtle">
                          <summary className="cursor-pointer">Original issue details</summary>
                          <p className="mt-2 whitespace-pre-wrap">{item.title}</p>
                          {item.description && item.description !== item.title ? (
                            <p className="mt-2 whitespace-pre-wrap">{descriptionWithoutImages(item.description)}</p>
                          ) : null}
                          {item.images?.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.images.map((url) => (
                                // eslint-disable-next-line @next/next/no-img-element -- note media is served by the local API
                                <img key={url} src={imageSrc(url)} alt="" loading="lazy" decoding="async" className="h-24 w-auto rounded border border-border" />
                              ))}
                            </div>
                          ) : null}
                          {item.repoHint ? <p className="mt-2">Repo: {item.repoHint}</p> : null}
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      </ModalShell>

      <EntityLinkDialog
        requireExplicitDismissal
        open={linkKind !== null}
        onClose={() => setLinkKind(null)}
        title={linkKind === "jira" ? "Choose parent Jira ticket" : "Add repositories"}
        description={linkKind === "jira" ? "Find the ticket these sub-tasks belong to." : "Find the repositories for these tasks."}
        defaultKind={linkKind ?? "repo"}
        allowedKinds={linkKind ? [linkKind] : undefined}
        multiple={linkKind !== "jira"}
        existing={linkKind === "repo" ? repos : undefined}
        onSave={async (refs) => {
          if (linkKind === "jira") {
            setParent(refs[0]);
            setProjectKey(projectOf(refs[0].id));
          } else {
            setRepos((current) => mergeEntityRefs(current, refs));
          }
        }}
      />

      <SkillAgentDialog
        requireExplicitDismissal
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        onLaunched={onClose}
        title="Choose an agent"
        description={parentKey
          ? `Create ${workItems.length} reviewed sub-tasks under ${parentKey}, with linked DevHub tasks.`
          : `Create a parent ticket and ${workItems.length} reviewed child tickets, with linked DevHub tasks.`}
        kind="agent"
        worktree={false}
        cancelLabel="Back to review"
        launchButtonLabel="Launch agent"
        promptDisclosureLabel="Review agent instructions"
        banner={<SharedEntityChips refs={[...(parent ? [parent] : []), ...repos]} label="Links for these tasks" />}
        getPrompt={() => buildCreateTasksFromPrompt(promptInput())}
        summary={`Create tasks from ${notePath}`}
        reason={`Create Jira + DevHub tasks from note ${notePath}`}
        resolveCwd={async () => {
          const res = await fetch(createTasksPlanUrl(promptInput()), { cache: "no-store" });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Couldn't load the plan preview");
          }
          return undefined;
        }}
      />
    </>
  );
}
