"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ModalShell } from "@/components/shell/ModalShell";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { CANCELLING, PHASE_COPY, joinAnd } from "@/lib/plugins/copy";
import { parseGitHubRepoUrl } from "@/lib/plugins/github-url";
import type {
  PluginDetail,
  PluginDiagnostic,
  PluginListItem,
  PluginOperationView,
} from "@/lib/plugins/model";
import { asFailure, getJson, postJson } from "./api";
import { AddFooter, ConfirmFooter, DetailFooter, OperationFooter } from "./footers";
import {
  AccessBody,
  AddBody,
  ApplyingBody,
  DetailBody,
  DiagnosticsFallback,
  FailureBody,
  GuideLink,
  InvalidBody,
  PluginList,
  PrepareBody,
  PreviewBody,
  SuccessBody,
  isPreparing,
} from "./views";

const SETTLED = new Set(["ready", "needs_access", "invalid", "succeeded", "failed", "cancelled", "expired", "needs_attention"]);
/** States where there is a decision or a result to read, so the heading takes focus. */
const DECISION = new Set(["ready", "needs_access", "invalid", "succeeded", "failed", "expired", "needs_attention"]);

interface ListBody {
  ok: boolean;
  plugins: PluginListItem[];
  operations?: PluginOperationView[];
  diagnostic: string | null;
  malformed: boolean;
  storageLine: string;
  syncHeading: string;
  syncNote: string | null;
  runtimeLabel: string;
  settingsFile: string;
}

type Dialog = "add" | "op" | "detail" | "disable" | "remove" | null;

function titleFor(dialog: Dialog, operation: PluginOperationView | null, detail: PluginDetail | null): string {
  if (dialog === "add") return "Add a plugin from GitHub";
  if (dialog === "detail") return detail?.name ?? "Plugin";
  if (dialog === "disable") return detail ? `Disable ${detail.name}?` : "Disable plugin?";
  if (dialog === "remove") return detail ? `Remove ${detail.name} from DevHub?` : "Remove plugin from DevHub?";
  if (!operation) return "Reviewing plugin";
  const name = operation.preview?.plugin?.name ?? operation.subject ?? "plugin";
  switch (operation.state) {
    case "needs_access": return "We couldn’t access this repository";
    case "invalid": return operation.message || "This repository isn’t a valid DevHub plugin";
    case "ready": return operation.kind === "disable" ? `Disable ${name}?` : operation.kind === "remove" ? `Remove ${name} from DevHub?` : `Review ${name}`;
    case "applying":
      return operation.kind === "remove" ? `Removing ${name}` : operation.kind === "disable" ? `Disabling ${name}` : `Enabling ${name}`;
    case "succeeded":
      return operation.kind === "remove" ? "Plugin removed" : operation.kind === "disable" ? `${name} is disabled` : `${name} is enabled`;
    case "failed":
    case "needs_attention": return operation.message || "Something went wrong";
    case "expired": return "Review expired";
    case "cancelled": return "Cancelled";
    default: return "Reviewing plugin";
  }
}

/** One short line for the screen reader, changing only when the phase does. */
function announcementFor(operation: PluginOperationView | null): string {
  if (!operation) return "";
  if (isPreparing(operation)) return (PHASE_COPY[operation.state]?.active ?? operation.phase).replace("…", "");
  if (operation.state === "ready") return "Review ready";
  if (operation.state === "applying") return operation.phase;
  if (operation.state === "succeeded") return operation.message ?? "Done";
  if (operation.state === "cancelled") return operation.message ?? "Cancelled";
  return "";
}

export function PluginsPage() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const operationParam = params.get("operation");
  const pluginParam = params.get("plugin");
  const addOpen = params.get("add") === "1";

  const [hiddenOp, setHiddenOp] = useState<string | null>(null);
  const opHidden = Boolean(operationParam) && hiddenOp === operationParam;
  const listState = useLive<ListBody>("/api/plugins", { refreshInterval: 0 });
  const detailState = useLive<PluginDetail>(
    pluginParam ? `/api/plugins/${encodeURIComponent(pluginParam)}` : null,
    { refreshInterval: 0 },
  );
  // One second while the progress is on screen, five while it sits behind the page.
  const opState = useLive<PluginOperationView>(
    operationParam ? `/api/plugins/operations/${encodeURIComponent(operationParam)}` : null,
    {
      refreshInterval: (latest?: PluginOperationView) => (latest && SETTLED.has(latest.state) ? 0 : opHidden ? 5000 : 1000),
      dedupingInterval: 0,
    },
  );

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlTouched, setUrlTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"disable" | "remove" | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const [diagnosticsText, setDiagnosticsText] = useState<string | null>(null);
  const [accessTab, setAccessTab] = useState<"gh" | "git">("gh");
  const [actionError, setActionError] = useState<string | null>(null);
  const toasted = useRef<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstDetailsRef = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);
  const reviewSequence = useRef(0);

  const list = listState.data ?? null;
  const loading = listState.isLoading && !list;
  const loadError = Boolean(listState.error) && !list;
  const detail = detailState.data ?? null;
  const detailError = detailState.error instanceof Error ? detailState.error.message : null;
  const fetched = opState.data ?? null;
  const operation = useMemo(() => {
    if (!fetched) return null;
    if (cancellingId === fetched.id && !SETTLED.has(fetched.state)) return { ...fetched, phase: CANCELLING, cancellable: false };
    return fetched;
  }, [fetched, cancellingId]);
  const preview = operation?.preview ?? null;
  const selectionKey = preview ? `${preview.operationId}:${preview.revision}` : "";
  const selected = selection.key === selectionKey
    ? selection.ids
    : (preview?.targets.filter((target) => target.selectedByDefault && !target.conflict).map((target) => target.id) ?? []);
  const dialog: Dialog = pluginParam && confirmKind
    ? confirmKind
    : operationParam && !opHidden ? "op" : addOpen ? "add" : pluginParam ? "detail" : null;

  const writeQuery = useCallback((next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  // A finished change gets one short confirmation, then the list is re-read.
  useEffect(() => {
    if (!operation || operation.state !== "succeeded" || toasted.current === operation.id) return;
    toasted.current = operation.id;
    const name = operation.result?.name ?? "Plugin";
    if (operation.kind === "disable") toast.success(`${name} disabled.`);
    else if (operation.kind === "remove") toast.success(operation.message ?? `${name} removed from DevHub. Downloaded files were kept.`);
    else toast.success(`${name} enabled.`);
    if (operation.kind === "remove") focusAfterClose.current = true;
    void listState.mutate();
  }, [operation, toast, listState]);

  useEffect(() => {
    if (dialog !== "add") return;
    const frame = requestAnimationFrame(() => urlRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [dialog]);

  // The row that opened the dialog may be gone after a removal; hand focus to the next row, or to Add.
  useEffect(() => {
    if (dialog !== null || !focusAfterClose.current) return;
    focusAfterClose.current = false;
    const frame = requestAnimationFrame(() => (firstDetailsRef.current ?? addButtonRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [dialog, list]);

  function resetTransient() {
    setConfirmKind(null);
    setCancellingId(null);
    setHiddenOp(null);
    setDiagnosticsText(null);
    setActionError(null);
  }

  function openAdd() {
    setUrlError(null);
    setUrlTouched(false);
    resetTransient();
    writeQuery({ add: "1", plugin: null, operation: null });
  }

  function openDetail(id: string) {
    resetTransient();
    writeQuery({ plugin: id, add: null, operation: null });
  }

  async function cancelCurrent(view: PluginOperationView) {
    setCancellingId(view.id);
    try {
      const cancelled = await postJson<PluginOperationView>(`/api/plugins/operations/${view.id}/cancel`);
      await opState.mutate(cancelled, { revalidate: false });
      return cancelled;
    } catch (err) {
      setCancellingId(null);
      setActionError(asFailure(err).message);
      await opState.mutate();
      return null;
    }
  }

  async function closeDialog() {
    reviewSequence.current += 1;
    if (confirmKind) {
      setConfirmKind(null);
      return;
    }
    const view = operation;
    if (dialog === "op" && view?.state === "applying" && operationParam) {
      setHiddenOp(operationParam);
      return;
    }
    if (dialog === "op" && view?.cancellable) {
      const cancelled = await cancelCurrent(view);
      if (!cancelled || !SETTLED.has(cancelled.state)) return;
    }
    resetTransient();
    writeQuery({ add: null, plugin: null, operation: null });
  }

  function backToAdd() {
    resetTransient();
    setUrlError(null);
    writeQuery({ add: "1", plugin: null, operation: null });
  }

  async function viewExisting() {
    const name = operation?.preview?.plugin?.name;
    if (!name) return;
    if (operation?.cancellable) await cancelCurrent(operation);
    openDetail(name);
  }

  async function editUrl() {
    if (operation?.sourceUrl) setUrl(operation.sourceUrl);
    if (operation?.cancellable) await cancelCurrent(operation);
    backToAdd();
  }

  async function startReview(address: string) {
    const sequence = ++reviewSequence.current;
    const started = await postJson<{ operationId: string }>("/api/plugins/prepare", { url: address }, crypto.randomUUID());
    if (sequence !== reviewSequence.current) {
      await postJson(`/api/plugins/operations/${started.operationId}/cancel`);
      return;
    }
    resetTransient();
    writeQuery({ add: null, plugin: null, operation: started.operationId });
  }

  async function reviewPlugin() {
    if (submitting) return;
    const parsed = parseGitHubRepoUrl(url);
    setUrlTouched(true);
    if (!parsed.ok) {
      setUrlError(parsed.message);
      urlRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await startReview(parsed.repo.url);
    } catch (err) {
      setUrlError(asFailure(err).message);
      urlRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  /** Check again, Try again and Review again all start a fresh review of the same address. */
  async function reviewSameSource() {
    const address = operation?.sourceUrl;
    if (!address) {
      backToAdd();
      return;
    }
    setSubmitting(true);
    try {
      await startReview(address);
    } catch (err) {
      setActionError(asFailure(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCurrent() {
    if (!operation || !operation.preview || submitting) return;
    const reviewed = operation.preview;
    setSubmitting(true);
    setActionError(null);
    await opState.mutate({ ...operation, state: "applying", cancellable: false, phase: ["disable", "remove"].includes(operation.kind) ? operation.steps[0]?.label ?? "Updating plugin settings" : "Verify reviewed files" }, { revalidate: false });
    try {
      const view = await postJson<PluginOperationView>(
        `/api/plugins/operations/${operation.id}/confirm`,
        { revision: reviewed.revision, planDigest: reviewed.planDigest, selectedTargets: ["disable", "remove"].includes(operation.kind) ? [] : selected, accepted: true },
        crypto.randomUUID(),
      );
      await opState.mutate(view, { revalidate: false });
    } catch (err) {
      const failure = asFailure(err);
      await opState.mutate();
      setActionError(failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function recheck() {
    if (!operation) return;
    setSubmitting(true);
    try {
      await opState.mutate(await postJson<PluginOperationView>(`/api/plugins/operations/${operation.id}/recheck`), { revalidate: false });
    } catch (err) {
      setActionError(asFailure(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyDiagnostics(id: string) {
    try {
      const diagnostic = await getJson<PluginDiagnostic>(`/api/plugins/operations/${encodeURIComponent(id)}/diagnostics`);
      const text = JSON.stringify(diagnostic, null, 2);
      try {
        await copyTextToClipboard(text);
        setDiagnosticsText(null);
        toast.success("Diagnostics copied.");
      } catch {
        setDiagnosticsText(text);
      }
    } catch (err) {
      setDiagnosticsText(asFailure(err).message);
    }
  }

  /** Display the server's cleanup plan before confirming its digest. */
  async function runLifecycle(kind: "disable" | "remove", pluginId: string) {
    setSubmitting(true);
    try {
      const started = await postJson<{ operationId: string }>(`/api/plugins/${encodeURIComponent(pluginId)}/${kind}-preview`);
      resetTransient();
      writeQuery({ operation: started.operationId, plugin: null, add: null });
    } catch (err) {
      setActionError(asFailure(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function startEnable(pluginId: string) {
    setSubmitting(true);
    try {
      const started = await postJson<{ operationId: string }>(`/api/plugins/${encodeURIComponent(pluginId)}/enable-preview`);
      resetTransient();
      writeQuery({ operation: started.operationId, plugin: null, add: null });
    } catch (err) {
      setActionError(asFailure(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  /** Try again means the same thing the person did last: review the address again, or redo the change. */
  async function retry() {
    if (!operation) return;
    if (operation.error?.code === "INTERRUPTED") {
      setSubmitting(true);
      try {
        await opState.mutate(await postJson<PluginOperationView>(`/api/plugins/operations/${operation.id}/retry-cleanup`), { revalidate: false });
        await listState.mutate();
        setActionError(null);
      } catch (err) { setActionError(asFailure(err).message); }
      finally { setSubmitting(false); }
      return;
    }
    if ((operation.kind === "disable" || operation.kind === "remove") && operation.pluginId) {
      await runLifecycle(operation.kind, operation.pluginId);
    } else if (operation.kind === "enable" && operation.pluginId) {
      await startEnable(operation.pluginId);
    } else {
      await reviewSameSource();
    }
  }

  function backFromReview() {
    if (operation?.kind === "enable" && operation.pluginId) {
      void (operation.cancellable ? cancelCurrent(operation) : Promise.resolve());
      resetTransient();
      writeQuery({ plugin: operation.pluginId, operation: null, add: null });
      return;
    }
    void editUrl();
  }

  const title = titleFor(dialog, operation, detail);
  const subtitle = dialog === "add"
    ? "Paste the repository link. You’ll review what it adds before enabling it."
    : dialog === "detail" ? detail?.stateLabel
    : dialog === "op" && operation && (isPreparing(operation) || operation.state === "needs_access" || operation.state === "invalid")
      ? operation.subject ?? undefined
      : undefined;

  const operationFooter = operation ? (
    <OperationFooter
      operation={operation}
      submitting={submitting}
      selectedCount={selected.length}
      onClose={() => void closeDialog()}
      onEditUrl={() => void editUrl()}
      onBack={backFromReview}
      onCheckAgain={() => void reviewSameSource()}
      onCopyDiagnostics={() => void copyDiagnostics(operation.id)}
      onConfirm={() => void confirmCurrent()}
      onRecheck={() => void recheck()}
      onRetry={() => void retry()}
      onReviewAgain={() => void (operation.kind === "enable" && operation.pluginId ? startEnable(operation.pluginId) : reviewSameSource())}
      onViewExisting={() => void viewExisting()}
    />
  ) : (
    <div className="flex justify-end"><button type="button" className="btn btn-ghost text-xs" onClick={() => void closeDialog()}>Cancel</button></div>
  );

  const footer = dialog === "add"
    ? <AddFooter submitting={submitting} onCancel={() => void closeDialog()} onReview={() => void reviewPlugin()} />
    : dialog === "disable" || dialog === "remove"
      ? <ConfirmFooter kind={dialog} submitting={submitting} onCancel={() => setConfirmKind(null)} onConfirm={() => detail && void runLifecycle(dialog, detail.id)} />
      : dialog === "detail"
        ? (
          <DetailFooter
            detail={detail}
            submitting={submitting}
            onClose={() => void closeDialog()}
            onAskDisable={() => detail && void runLifecycle("disable", detail.id)}
            onAskRemove={() => detail && void runLifecycle("remove", detail.id)}
            onEnable={() => detail && void startEnable(detail.id)}
          />
        )
        : dialog === "op" ? operationFooter : null;

  return (
    <div className="page-wrapper plugins-page">
      <PageHeader
        title="Plugins"
        subtitle="Install shared skills and agents from a GitHub repo."
        actions={<button type="button" ref={addButtonRef} className="btn btn-primary text-xs" onClick={openAdd}>Add from GitHub</button>}
      />

      <div className="max-w-[1040px]">
        {list?.operations?.filter((item) => item.id !== operationParam).map((item) => (
          <div key={item.id} className="card card-body mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{item.subject ?? "Plugin"}: {item.message ?? item.phase}</p>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => { resetTransient(); writeQuery({ operation: item.id, plugin: null, add: null }); }}>View progress</button>
          </div>
        ))}
        {operation && opHidden ? (
          <div className="card card-body mb-4 flex items-center justify-between gap-3" role="status">
            <p className="text-sm text-text">{SETTLED.has(operation.state) ? operation.message ?? "Operation finished" : operation.phase || "Working…"}</p>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setHiddenOp(null)}>{SETTLED.has(operation.state) ? "View result" : "View progress"}</button>
          </div>
        ) : null}

        {loading ? (
          <div role="status" aria-busy="true">
            <p className="sr-only">Loading plugins</p>
            <SkeletonRows count={3} variant="list" />
          </div>
        ) : loadError ? (
          <div className="tone-panel tone-panel--danger" role="alert">
            <p className="text-sm font-semibold">Couldn’t load plugins</p>
            <p className="mt-1 text-xs">Your plugin settings haven’t changed. Try loading them again.</p>
            <button type="button" className="btn btn-ghost mt-3 text-xs" onClick={() => void listState.mutate()}>Try again</button>
          </div>
        ) : (
          <>
            {list?.malformed ? (
              <div className="tone-panel tone-panel--warning mb-4" role="alert">
                <p className="text-sm font-semibold">Plugin settings need attention</p>
                <p className="mt-1 text-xs">DevHub couldn’t read plugins.json safely. No settings have been changed.</p>
                <p className="mt-3 text-xs text-text-muted">Settings file</p>
                <p className="break-all font-mono text-xs">{list.settingsFile}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => void copyDiagnostics("registry")}>Copy diagnostics</button>
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => void listState.mutate()}>Try again</button>
                </div>
                {diagnosticsText && dialog === null ? <DiagnosticsFallback text={diagnosticsText} /> : null}
              </div>
            ) : null}
            {list && list.plugins.length === 0 && !list.malformed ? (
              <EmptyState
                title="No plugins installed"
                subtitle="Paste a GitHub link shared by your team to get started. You’ll review it before enabling it."
                action={<button type="button" className="btn btn-primary text-xs" onClick={openAdd}>Add from GitHub</button>}
              />
            ) : list && list.plugins.length > 0 ? (
              <PluginList plugins={list.plugins} onDetails={openDetail} firstDetailsRef={firstDetailsRef} />
            ) : null}
          </>
        )}

        <p className="mt-6 text-xs"><GuideLink>Create your own plugin</GuideLink></p>
      </div>

      <ModalShell
        open={dialog !== null}
        onClose={() => void closeDialog()}
        title={title}
        description={subtitle}
        wrapTitle
        maxWidth={dialog === "detail" || (dialog === "op" && operation?.state === "ready") ? "max-w-4xl" : "max-w-xl"}
        focusTitle={dialog === "op" && Boolean(operation && DECISION.has(operation.state) && !(operation.state === "ready" && ["disable", "remove"].includes(operation.kind)))}
        focusToken={operation ? `${operation.id}:${operation.state}:${operation.preview?.revision ?? 0}` : dialog ?? ""}
        dismissOnBackdrop={operation?.state !== "applying"}
        footer={<div className="plugin-content">{footer}</div>}
      >
        <div className="plugin-content">
        {actionError ? <p className="tone-panel tone-panel--danger mb-4 text-sm" role="alert">{actionError}</p> : null}
        {dialog === "op" ? <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcementFor(operation)}</p> : null}

        {dialog === "add" ? (
          <AddBody
            url={url}
            error={urlError}
            storageLine={list?.storageLine ?? null}
            inputRef={urlRef}
            onChange={(value) => {
              setUrl(value);
              if (urlError && parseGitHubRepoUrl(value).ok) setUrlError(null);
            }}
            onBlur={() => {
              if (!urlTouched) return;
              const parsed = parseGitHubRepoUrl(url);
              setUrlError(parsed.ok ? null : parsed.message);
            }}
            onSubmit={() => void reviewPlugin()}
          />
        ) : null}

        {dialog === "detail" && detailError ? <p className="text-sm" role="alert">{detailError}</p> : null}
        {dialog === "detail" && !detail && !detailError ? <SkeletonRows count={3} /> : null}
        {dialog === "detail" && detail ? <DetailBody detail={detail} onCopyDiagnostics={() => void copyDiagnostics("registry")} /> : null}
        {dialog === "detail" && diagnosticsText ? <DiagnosticsFallback text={diagnosticsText} /> : null}

        {dialog === "disable" && detail ? (
          <div className="text-sm">
            <p>
              DevHub will stop including this plugin
              {detail.syncedTo.length > 0 ? ` and remove the copies it installed in ${joinAnd(detail.syncedTo)}` : ""}.
            </p>
            <p className="mt-2">The downloaded repository will be kept. Open AI sessions may keep using content already loaded.</p>
          </div>
        ) : null}
        {dialog === "remove" && detail ? (
          <div className="text-sm">
            <p>This disables the plugin and removes its registration. Its downloaded repository will be kept at:</p>
            <p className="mt-2 break-all font-mono text-xs">{detail.pathDisplay}</p>
          </div>
        ) : null}

        {dialog === "op" && operation ? (
          operation.state === "needs_access" && operation.access ? (
            <>
              <AccessBody access={operation.access} tab={accessTab} onTab={setAccessTab} />
              {diagnosticsText ? <DiagnosticsFallback text={diagnosticsText} /> : null}
            </>
          ) : operation.state === "invalid" ? (
            <>
              <InvalidBody operation={operation} />
              {diagnosticsText ? <DiagnosticsFallback text={diagnosticsText} /> : null}
            </>
          ) : operation.state === "ready" && preview && (operation.kind === "disable" || operation.kind === "remove") ? (
            <div className="text-sm">
              <p>{operation.kind === "remove" ? "This disables the plugin and removes its registration." : `DevHub will stop including this plugin${preview.targets.length ? ` and remove the copies it installed in ${joinAnd(preview.targets.map((target) => target.label))}` : ""}.`}</p>
              <p className="mt-3">The downloaded repository will be kept at:</p>
              <p className="mt-2 break-all font-mono text-xs">{preview.source.destination}</p>
              <p className="mt-3">Open AI sessions may keep using content already loaded.</p>
            </div>
          ) : operation.state === "ready" && preview ? (
            <PreviewBody
              operation={operation}
              preview={preview}
              selected={selected}
              onSelect={(ids) => setSelection({ key: selectionKey, ids })}
              syncHeading={list?.syncHeading ?? "Sync to"}
              syncNote={list?.syncNote ?? null}
              runtimeLabel={operation.access?.runtimeLabel ?? list?.runtimeLabel ?? "This computer"}
            />
          ) : operation.state === "succeeded" ? (
            <SuccessBody operation={operation} />
          ) : operation.state === "failed" || operation.state === "needs_attention" || operation.state === "expired" ? (
            <FailureBody operation={operation} diagnosticsText={diagnosticsText} />
          ) : operation.state === "cancelled" ? (
            <p className="text-sm">{operation.message}</p>
          ) : operation.state === "applying" ? (
            <ApplyingBody operation={operation} />
          ) : (
            <PrepareBody operation={operation} />
          )
        ) : dialog === "op" && opState.error ? (
          <div role="alert" className="tone-panel tone-panel--danger text-sm">
            <p>Couldn’t load this operation. Its progress hasn’t been cancelled.</p>
            <button type="button" className="btn btn-ghost mt-3" onClick={() => void opState.mutate()}>Try again</button>
          </div>
        ) : dialog === "op" ? (
          <SkeletonRows count={2} height={24} />
        ) : null}
        </div>
      </ModalShell>
    </div>
  );
}
