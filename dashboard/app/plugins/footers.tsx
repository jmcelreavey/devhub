"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { PluginDetail, PluginOperationView } from "@/lib/plugins/model";
import { PLUGIN_GUIDE_HREF } from "./views";

function Busy({ on }: { on: boolean }) {
  // Spinning is for an action the person just triggered, which is what every button here is.
  return on ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null;
}

const GHOST = "btn btn-ghost text-xs";
const PRIMARY = "btn btn-primary text-xs";

export function AddFooter(props: { submitting: boolean; onCancel: () => void; onReview: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={GHOST} onClick={props.onCancel}>Cancel</button>
      <button type="button" className={PRIMARY} disabled={props.submitting} onClick={props.onReview}>
        <Busy on={props.submitting} /> Review plugin
      </button>
    </div>
  );
}

/** Cancel is the default-focused control; the destructive action never is. */
export function ConfirmFooter(props: {
  kind: "disable" | "remove";
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={GHOST} autoFocus onClick={props.onCancel}>Cancel</button>
      <button
        type="button"
        className={props.kind === "remove" ? "btn btn-danger-ghost text-xs" : PRIMARY}
        disabled={props.submitting}
        onClick={props.onConfirm}
      >
        <Busy on={props.submitting} /> {props.kind === "disable" ? "Disable plugin" : "Remove plugin"}
      </button>
    </div>
  );
}

export function DetailFooter(props: {
  detail: PluginDetail | null;
  submitting: boolean;
  onClose: () => void;
  onAskDisable: () => void;
  onAskRemove: () => void;
  onEnable: () => void;
}) {
  const detail = props.detail;
  if (!detail) {
    return <div className="flex justify-end"><button type="button" className={GHOST} onClick={props.onClose}>Close</button></div>;
  }
  const name = encodeURIComponent(detail.name);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {detail.skills > 0 ? <Link className={GHOST} href={`/skills?plugin=${name}`}>View skills</Link> : null}
        {detail.agents > 0 ? <Link className={GHOST} href={`/skills?tab=agents&plugin=${name}`}>View agents</Link> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {detail.canEnable ? <button type="button" className={PRIMARY} disabled={props.submitting} onClick={props.onEnable}><Busy on={props.submitting} /> Enable…</button> : null}
        {detail.canDisable ? <button type="button" className={GHOST} onClick={props.onAskDisable}>Disable…</button> : null}
        {detail.canRemove ? <button type="button" className={GHOST} onClick={props.onAskRemove}>Remove…</button> : null}
        {!detail.canEnable && !detail.canDisable && !detail.canRemove ? <button type="button" className={GHOST} onClick={props.onClose}>Close</button> : null}
      </div>
    </div>
  );
}

export interface OperationHandlers {
  submitting: boolean;
  /** Close the window; cancels a review that is still being prepared. */
  onClose: () => void;
  onEditUrl: () => void;
  onBack: () => void;
  onCheckAgain: () => void;
  onCopyDiagnostics: () => void;
  onConfirm: () => void;
  onRecheck: () => void;
  onRetry: () => void;
  onReviewAgain: () => void;
  onViewExisting: () => void;
  selectedCount: number;
}

export function OperationFooter(props: { operation: PluginOperationView } & OperationHandlers) {
  const { operation: op, submitting } = props;
  const busy = <Busy on={submitting} />;
  const sourceUrl = op.sourceUrl;

  if (op.state === "needs_access") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={GHOST} onClick={props.onEditUrl}>Edit URL</button>
          <button type="button" className={GHOST} onClick={props.onCopyDiagnostics}>Copy diagnostics</button>
          {op.access?.signedInDenied && sourceUrl ? (
            <a className={GHOST} href={sourceUrl} target="_blank" rel="noreferrer noopener">Open repository on GitHub</a>
          ) : null}
        </div>
        <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onCheckAgain}>{busy} Check again</button>
      </div>
    );
  }

  if (op.state === "invalid") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {sourceUrl ? <a className={GHOST} href={sourceUrl} target="_blank" rel="noreferrer noopener">Open repository</a> : null}
          <button type="button" className={GHOST} onClick={props.onCopyDiagnostics}>Copy diagnostics</button>
          <button type="button" className={GHOST} onClick={props.onEditUrl}>Edit URL</button>
        </div>
        <button type="button" className={PRIMARY} onClick={props.onClose}>Close</button>
      </div>
    );
  }

  if (op.state === "failed" || op.state === "needs_attention" || op.state === "expired") {
    const stale = op.state === "expired" || op.error?.code === "PREVIEW_STALE" || op.error?.code === "TARGET_CONFLICT" || op.error?.code === "CLEANED";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={GHOST} onClick={props.onCopyDiagnostics}>Copy diagnostics</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={GHOST} onClick={props.onClose}>Close</button>
          {op.error?.code === "INTERRUPTED" ? (
            <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onRetry}>{busy} Retry cleanup</button>
          ) : stale ? (
            <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onReviewAgain}>{busy} Review again</button>
          ) : op.error?.retryable ? (
            <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onRetry}>{busy} Try again</button>
          ) : null}
        </div>
      </div>
    );
  }

  if (op.state === "succeeded") {
    const result = op.result;
    const installing = op.kind === "install" || op.kind === "enable";
    const name = result ? encodeURIComponent(result.name) : "";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {installing && result && result.skillCount > 0 ? <Link className={GHOST} href={`/skills?plugin=${name}`}>View skills</Link> : null}
          {installing && result && result.agentCount > 0 ? <Link className={GHOST} href={`/skills?tab=agents&plugin=${name}`}>View agents</Link> : null}
        </div>
        <button type="button" className={PRIMARY} onClick={props.onClose}>Done</button>
      </div>
    );
  }

  if (op.state === "cancelled" || op.state === "applying") {
    return <div className="flex justify-end"><button type="button" className={GHOST} onClick={props.onClose}>Close</button></div>;
  }

  if (op.state === "ready" && op.preview) {
    if (op.kind === "disable" || op.kind === "remove") return <ConfirmFooter kind={op.kind} submitting={submitting} onCancel={props.onClose} onConfirm={props.onConfirm} />;
    const preview = op.preview;
    const guide = <Link className={GHOST} href={PLUGIN_GUIDE_HREF}>Open plugin guide</Link>;
    if (preview.blockers.some((item) => item.code === "UNSUPPORTED")) {
      return <div className="flex flex-wrap items-center justify-between gap-2">{guide}<button type="button" className={PRIMARY} onClick={props.onClose}>Close</button></div>;
    }
    if (preview.blockers.some((item) => item.code === "NAME_CONFLICT")) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={GHOST} onClick={props.onViewExisting}>View existing plugin</button>
          <button type="button" className={PRIMARY} onClick={props.onClose}>Close</button>
        </div>
      );
    }
    if (preview.blockers.length > 0) {
      return <div className="flex flex-wrap items-center justify-between gap-2">{guide}<button type="button" className={PRIMARY} onClick={props.onClose}>Close</button></div>;
    }
    if (!preview.requirementsMet) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={GHOST} onClick={props.onBack}>Back</button>
          <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onRecheck}>{busy} Re-check requirements</button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={GHOST} onClick={props.onBack}>Back</button>
        <button type="button" className={PRIMARY} disabled={submitting} onClick={props.onConfirm}>
          {busy} {props.selectedCount === 0 ? "Enable in DevHub" : "Enable and sync"}
        </button>
      </div>
    );
  }

  // Still preparing: the one control is the cancel decision, same as Escape.
  return <div className="flex justify-end"><button type="button" className={GHOST} onClick={props.onClose}>Cancel</button></div>;
}
