"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { FieldError } from "@/components/ui/FieldError";
import { StatusDot } from "@/components/ui/StatusDot";
import { CANCELLING, NO_CODE_HAS_RUN, PHASE_COPY, formatElapsed, joinAnd, plural } from "@/lib/plugins/copy";
import type {
  AccessView,
  AssetPreview,
  InventoryGroup,
  PluginDetail,
  PluginListItem,
  PluginOperationView,
  PluginPreview,
} from "@/lib/plugins/model";
import { asFailure, getJson } from "./api";

/** Accent text keeps its own token: the primary fill is not always readable as text. */
const ACCENT_TEXT = { color: "var(--accent-text, var(--accent))" } as const;

export const PLUGIN_GUIDE_HREF = "/docs/contributing/creating-plugins";

export function countsLine(skills: number, agents: number): string {
  if (skills === 0 && agents === 0) return "No skills or agents";
  return [skills > 0 ? plural(skills, "skill") : null, agents > 0 ? plural(agents, "agent") : null].filter(Boolean).join(" · ");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ─── Plugin list ─── */

function StateMark({ plugin }: { plugin: PluginListItem }) {
  if (plugin.state === "enabled") {
    return <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-success"><StatusDot ok /> Enabled</span>;
  }
  if (plugin.state === "needs_attention") {
    return <span className="shrink-0 text-xs text-warning"><span aria-hidden>⚠ </span>Needs attention</span>;
  }
  if (plugin.state === "disabled") {
    return <span className="shrink-0 text-xs text-text-muted"><span aria-hidden>○ </span>Disabled</span>;
  }
  return <span className="shrink-0 text-xs text-text-muted">Local folder</span>;
}

export function PluginList(props: {
  plugins: PluginListItem[];
  onDetails: (id: string) => void;
  firstDetailsRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <ul className="card divide-y divide-border" aria-label="Plugins">
      {props.plugins.map((plugin, index) => (
        <li key={plugin.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-semibold text-text">{plugin.name}</p>
            <StateMark plugin={plugin} />
          </div>
          <p className="mt-1 break-words text-xs text-text-subtle">
            {[plugin.sourceLabel, plugin.ref, plugin.shortSha].filter(Boolean).join(" · ")}
          </p>
          {plugin.attention ? <p className="mt-1 text-xs text-warning">{plugin.attention}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-subtle">{countsLine(plugin.skills, plugin.agents)}</p>
            <button
              type="button"
              ref={index === 0 ? props.firstDetailsRef : undefined}
              className="btn btn-ghost text-xs"
              aria-label={`Details, ${plugin.name}`}
              onClick={() => props.onDetails(plugin.id)}
            >
              Details
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─── Plugin details ─── */

function DetailRow({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[9rem_1fr_auto] sm:items-baseline sm:gap-x-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-text">{children}</dd>
      {action ? <dd className="justify-self-start sm:justify-self-end">{action}</dd> : <dd className="hidden sm:block" />}
    </div>
  );
}

export function DetailBody({ detail, onCopyDiagnostics }: { detail: PluginDetail; onCopyDiagnostics: () => void }) {
  return (
    <div className="text-sm">
      {detail.attention ? (
        <div className="tone-panel tone-panel--warning mb-3" role="status">
          <p className="font-semibold">{detail.attention}</p>
          <button type="button" className="btn btn-ghost mt-2 text-xs" onClick={onCopyDiagnostics}>Copy diagnostics</button>
        </div>
      ) : null}
      <dl className="divide-y divide-border-muted text-xs">
        <DetailRow
          label="Source"
          action={detail.githubUrl ? (
            <a className="btn btn-ghost text-xs" href={detail.githubUrl} target="_blank" rel="noreferrer noopener">Open on GitHub</a>
          ) : undefined}
        >
          {detail.sourceLabel}
        </DetailRow>
        <DetailRow label="Version">{detail.version ?? "Unknown"}</DetailRow>
        {detail.managed ? (
          <>
            <DetailRow
              label="Installed commit"
              action={detail.sha ? <CopyButton text={detail.sha} label="commit SHA" showLabel /> : undefined}
            >
              <span className="font-mono">{[detail.ref, detail.shortSha].filter(Boolean).join(" · ") || "Unknown"}</span>
            </DetailRow>
            <DetailRow label="Tracking">{detail.ref ? `Default branch (${detail.ref})` : "Default branch"}</DetailRow>
          </>
        ) : null}
        <DetailRow label="Location" action={<CopyButton text={detail.path} label="path" showLabel />}>
          {detail.locationLabel}
          <span className="mt-0.5 block break-all font-mono text-text-subtle">{detail.pathDisplay}</span>
        </DetailRow>
        <DetailRow label="Contributions">{countsLine(detail.skills, detail.agents)}</DetailRow>
        {detail.managed ? (
          <DetailRow label="Synced to">{detail.syncedTo.length ? joinAnd(detail.syncedTo) : "Not copied to your AI tools"}</DetailRow>
        ) : null}
        {detail.lastOperation ? (
          <DetailRow label="Last operation">{detail.lastOperation.label} {formatDate(detail.lastOperation.at)}</DetailRow>
        ) : null}
      </dl>
      {detail.state === "disabled" ? (
        <p className="mt-3 text-xs text-text-muted">This plugin is kept on this computer and isn’t included in future syncs.</p>
      ) : null}
      {detail.localNote ? <div className="tone-panel tone-panel--muted mt-3 text-xs">{detail.localNote}</div> : null}
      {detail.dashboardNote ? <div className="tone-panel tone-panel--muted mt-3 text-xs">{detail.dashboardNote}</div> : null}
    </div>
  );
}

/* ─── Add from GitHub ─── */

export function AddBody({
  url,
  error,
  storageLine,
  inputRef,
  onChange,
  onBlur,
  onSubmit,
}: {
  url: string;
  error: string | null;
  storageLine: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
}) {
  const helpId = useId();
  const errorId = useId();
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} noValidate>
      <label htmlFor="plugin-github-url" className="text-sm font-semibold text-text">GitHub repository</label>
      <input
        id="plugin-github-url"
        ref={inputRef}
        className="input mt-2 w-full"
        placeholder="https://github.com/your-team/devhub-tools"
        value={url}
        autoComplete="off"
        spellCheck={false}
        inputMode="url"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <p id={helpId} className="mt-3 text-xs text-text-subtle">
        Public and private repositories are supported. Private repositories use your existing GitHub access.
      </p>
      {storageLine ? <p className="mt-2 text-xs text-text-subtle">{storageLine}</p> : null}
    </form>
  );
}

/* ─── Preparation, enabling, removing ─── */

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span>{formatElapsed(now - Date.parse(since))}</span>;
}

const STEP_STATUS: Record<string, string> = {
  complete: "Done: ",
  skipped: "Skipped: ",
  running: "In progress: ",
  failed: "Failed: ",
  pending: "Not started: ",
};

function stepMark(state: string): string {
  if (state === "complete" || state === "skipped") return "✓";
  if (state === "running") return "→";
  if (state === "failed") return "✕";
  return "○";
}

export function StepList({ steps }: { steps: PluginOperationView["steps"] }) {
  return (
    <ol className="text-sm">
      {steps.map((item) => (
        <li key={item.id} className={`flex gap-2 py-0.5 ${item.state === "running" ? "font-semibold text-text" : item.state === "pending" ? "text-text-muted" : "text-text"}`}>
          <span aria-hidden className="w-4 shrink-0 text-center">{stepMark(item.state)}</span>
          <span><span className="sr-only">{STEP_STATUS[item.state]}</span>{item.label}</span>
        </li>
      ))}
    </ol>
  );
}

const PREPARING = new Set(["validating_url", "checking_access", "cloning", "validating", "preparing_preview"]);

export function isPreparing(operation: PluginOperationView): boolean {
  return PREPARING.has(operation.state);
}

/** Review preparation (6.2). The bar is indeterminate on purpose: Git's phase is not total progress. */
export function PrepareBody({ operation }: { operation: PluginOperationView }) {
  const copy = PHASE_COPY[operation.state];
  const cancelling = operation.phase === CANCELLING;
  return (
    <div>
      <StepList steps={operation.steps} />
      <div className="mt-4" aria-hidden={false}>
        <div className="skeleton" style={{ height: 4, borderRadius: 999 }} role="progressbar" aria-label={copy?.active.replace("…", "") ?? "Working"} aria-valuetext="In progress" />
        <p className="mt-2 flex items-baseline justify-between gap-3 text-sm text-text">
          <span>{cancelling ? CANCELLING : copy?.active ?? operation.phase}</span>
          <span className="text-xs text-text-subtle" aria-hidden><Elapsed since={operation.startedAt} /></span>
        </p>
        {!cancelling && copy ? <p className="mt-1 text-xs text-text-subtle">{copy.supporting}</p> : null}
      </div>
      <p className="mt-4 text-xs text-text-subtle">{NO_CODE_HAS_RUN}</p>
    </div>
  );
}

/** Enabling, disabling or removing: real step state, and real per-tool counts. */
export function ApplyingBody({ operation }: { operation: PluginOperationView }) {
  return (
    <div>
      <StepList steps={operation.steps} />
      {operation.progress.length > 0 ? (
        <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
          {operation.progress.map((row) => (
            <div key={row.id} className="contents">
              <dt className="text-text">{row.label}</dt>
              <dd className="text-text-muted">
                {row.state === "waiting"
                  ? "Waiting"
                  : row.state === "failed"
                    ? `${row.done} of ${plural(row.total, "item")} copied, then stopped`
                    : `${row.done} of ${plural(row.total, "item")} copied`}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {operation.kind === "remove" ? <p className="mt-4 text-xs text-text-subtle">The downloaded repository will be kept.</p> : null}
      <p className="mt-4 text-xs text-text-subtle">You can close this window. Progress stays in Plugins.</p>
    </div>
  );
}

/* ─── Needs access ─── */

function CommandBlock({ commands }: { commands: string[] }) {
  const text = commands.join("\n");
  return (
    <div className="mt-3">
      <pre className="overflow-x-auto rounded-md border border-border-muted bg-bg-surface p-3 text-xs" style={{ fontFamily: "var(--font-mono)" }}>{text}</pre>
      <div className="mt-1"><CopyButton text={text} label="commands" showLabel /></div>
    </div>
  );
}

export function AccessBody(props: {
  access: AccessView;
  tab: "gh" | "git";
  onTab: (tab: "gh" | "git") => void;
}) {
  const { access } = props;
  const wsl = access.runtimeLabel.endsWith("(WSL)");
  const mac = access.runtimeLabel === "This Mac";
  const distro = wsl ? access.runtimeLabel.replace(/ \(WSL\)$/, "") : access.runtimeLabel;
  const terminal = wsl ? `Open ${distro} from the Windows Start menu.` : mac ? "Open Terminal on this Mac." : "Open a terminal on this computer.";
  return (
    <div className="text-sm">
      <p className="font-mono text-xs text-text-muted">{access.owner}/{access.repo}</p>
      <p className="mt-2">It may be private, unavailable, or the address may be wrong.</p>
      {access.signedInDenied && access.login ? (
        <p className="mt-2">{access.login} is signed in, but Git couldn’t access this repository. Check the URL, repository membership and any organisation SSO requirement.</p>
      ) : null}
      <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-muted">GitHub CLI</dt><dd>{access.ghStatus}</dd>
        <dt className="text-text-muted">Git access</dt><dd>{access.gitStatus}</dd>
        <dt className="text-text-muted">Runs on</dt><dd>{access.runtimeLabel}</dd>
      </dl>
      {!access.ghAvailable ? (
        <div className="tone-panel tone-panel--warning mt-3 text-xs">
          <p>GitHub CLI isn’t available to DevHub. Installed DevHub builds include it; try reopening DevHub. For a checkout installation, install GitHub CLI and restart the service.</p>
          {access.brewHint ? <p className="mt-2 font-mono">brew install gh</p> : null}
          <a className="btn btn-ghost mt-2 text-xs" href="https://cli.github.com/" target="_blank" rel="noreferrer noopener">GitHub CLI installation guide</a>
        </div>
      ) : null}
      <div className="hub-tabs mt-4" role="tablist" aria-label="Ways to give DevHub access">
        <button type="button" role="tab" aria-selected={props.tab === "gh"} className={`hub-tab ${props.tab === "gh" ? "active" : ""}`} onClick={() => props.onTab("gh")}>GitHub CLI</button>
        <button type="button" role="tab" aria-selected={props.tab === "git"} className={`hub-tab ${props.tab === "git" ? "active" : ""}`} onClick={() => props.onTab("git")}>Existing Git credentials</button>
      </div>
      {props.tab === "gh" ? (
        <div className="mt-3 text-xs" role="tabpanel">
          <p className="text-sm font-semibold text-text">{wsl ? `Sign in inside ${distro}` : "Sign in with GitHub CLI"}</p>
          <ol className="ml-4 mt-2 list-decimal space-y-1">
            <li>{terminal}</li>
            <li>{wsl ? `Run these commands inside ${distro}, not in PowerShell.` : "Run these commands."}</li>
            <li>{wsl ? "Complete sign-in in your browser, then return here and choose Check again." : "Complete the browser sign-in, then return here and choose Check again."}</li>
          </ol>
          <CommandBlock commands={access.commands} />
          <p className="mt-2 text-text-muted">Use a GitHub account that can open this repository.</p>
          {wsl ? <p className="mt-2 text-text-muted">DevHub runs in {distro}. A GitHub CLI login made only in Windows isn’t automatically available there.</p> : null}
          <p className="mt-2 text-text-muted">GitHub CLI manages your sign-in.</p>
        </div>
      ) : (
        <div className="mt-3 text-xs" role="tabpanel">
          <p className="text-sm font-semibold text-text">{wsl ? "Use Git Credential Manager from Windows" : "Use your existing Git credentials"}</p>
          {wsl ? (
            <>
              <p className="mt-2">Git inside WSL can use Git Credential Manager installed with Git for Windows.</p>
              <ol className="ml-4 mt-2 list-decimal space-y-1">
                <li>Install Git for Windows with Git Credential Manager, if it isn’t already installed.</li>
                <li>Open {distro} and configure its Git helper using the command below.</li>
                <li>Run the repository access check, complete any Windows sign-in prompt, then choose Check again.</li>
              </ol>
              <CommandBlock commands={access.gitCommands} />
              <p className="mt-2 text-text-muted">This changes Git’s credential helper in this WSL distribution. Use your organisation’s configured helper if it differs. The executable path may be different on your computer.</p>
            </>
          ) : (
            <>
              <p className="mt-2">If Git already accesses this repository through Keychain or another credential helper, DevHub can use that helper.</p>
              <ol className="ml-4 mt-2 list-decimal space-y-1">
                <li>{terminal}</li>
                <li>Run the access check below. Complete any sign-in shown by your credential helper.</li>
                <li>Return here and choose Check again.</li>
              </ol>
              <CommandBlock commands={access.gitCommands} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Invalid plugin ─── */

export function InvalidBody({ operation }: { operation: PluginOperationView }) {
  const source = operation.preview?.source;
  const slug = operation.subject ?? (source?.owner && source.repo ? `${source.owner}/${source.repo}` : null);
  // A missing manifest is a one-line answer; listing "was not found" under it adds nothing.
  const listed = operation.error?.code === "MISSING_MANIFEST" ? [] : operation.issues;
  const files = [...new Set(listed.map((issue) => issue.file))];
  return (
    <div className="text-sm" role="alert">
      {slug ? <p className="font-mono text-xs text-text-muted">{[slug, source?.shortSha].filter(Boolean).join(" · ")}</p> : null}
      {operation.preview?.body ? <p className="mt-2">{operation.preview.body}</p> : null}
      {operation.error && !operation.preview?.body && operation.error.message !== operation.message ? <p className="mt-2">{operation.error.message}</p> : null}
      {files.map((file) => (
        <div key={file} className="mt-3 text-xs">
          <p className="break-all font-mono text-text">{file}</p>
          <ul className="ml-3 mt-1 space-y-0.5 text-text-muted">
            {listed.filter((issue) => issue.file === file).map((issue) => (
              <li key={`${issue.field}:${issue.message}`} className="break-words">
                {issue.field ? <span className="font-mono">{issue.field}: </span> : null}{issue.message}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-3">Nothing has been enabled.</p>
    </div>
  );
}

/* ─── Review ─── */

function InventoryBlock({ groups }: { groups: InventoryGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-text">What it declares</p>
      <p className="mt-1 text-xs text-text-subtle">These are names and paths from the plugin. Nothing here has been opened or run.</p>
      <div className="mt-2 space-y-3">
        {groups.map((group) => (
          <section key={group.kind} className="rounded-md border border-border-muted p-3" aria-label={group.kind}>
            <h3 className="text-xs font-semibold text-text">{group.kind}</h3>
            <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
              {group.entries.map((entry) => <li key={entry} className="break-all font-mono">{entry}</li>)}
              {group.more > 0 ? <li>and {group.more} more</li> : null}
            </ul>
            {group.note ? <p className="mt-1 text-xs text-text-subtle">{group.note}</p> : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function assetStatus(asset: AssetPreview, labels: Map<string, string>): { text: string; tone: "badge-muted" | "badge-warning" | "badge-success" } {
  if (asset.conflictTargets.length > 0) {
    const where = asset.conflictTargets.map((id) => labels.get(id) ?? id);
    return { text: `Conflicts with a local copy in ${joinAnd(where)}`, tone: "badge-warning" };
  }
  return { text: asset.statusLabel, tone: asset.status === "add" ? "badge-success" : "badge-muted" };
}

function AssetList({ title, assets, labels }: { title: string; assets: AssetPreview[]; labels: Map<string, string> }) {
  if (assets.length === 0) return null;
  return (
    <details className="mt-3" open={assets.length <= 8}>
      <summary className="cursor-pointer text-xs font-semibold text-text">{title} ({assets.length})</summary>
      <ul className="mt-2 divide-y divide-border-muted rounded-md border border-border-muted">
        {assets.map((asset) => {
          const status = assetStatus(asset, labels);
          const meta = [
            asset.path,
            asset.supportingFiles ? plural(asset.supportingFiles, "supporting file") : null,
            asset.executable ? "includes executable files" : null,
            ...(asset.frontmatter ?? []),
          ].filter(Boolean).join(" · ");
          return (
            <li key={asset.path} className="px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="break-all font-mono text-sm font-semibold text-text">{asset.name}</span>
                <span className={`badge ${status.tone}`}>{status.text}</span>
              </div>
              {asset.description ? <p className="mt-0.5 break-words text-xs text-text-muted">{asset.description}</p> : null}
              <p className="mt-0.5 break-all font-mono text-xs text-text-subtle">{meta}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function PreviewBody(props: {
  operation: PluginOperationView;
  preview: PluginPreview;
  selected: string[];
  onSelect: (ids: string[]) => void;
  syncHeading: string;
  syncNote: string | null;
  runtimeLabel: string;
}) {
  const { preview } = props;
  const unsupported = preview.blockers.some((item) => item.code === "UNSUPPORTED");
  const nameBlocked = preview.blockers.find((item) => item.code === "NAME_CONFLICT");
  const otherBlockers = preview.blockers.filter((item) => item.code !== "UNSUPPORTED" && item.code !== "NAME_CONFLICT");
  const labels = new Map(preview.targets.map((target) => [target.id, target.label]));
  const source = preview.source;
  const slug = source.owner && source.repo ? `${source.owner}/${source.repo}` : props.operation.subject;
  const line = [slug, preview.plugin?.version, source.ref, source.shortSha].filter(Boolean).join(" · ");
  const blocked = unsupported || Boolean(nameBlocked) || otherBlockers.length > 0;

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="break-all font-mono text-xs text-text-muted">{line}</p>
        {source.visibility ? <span className="badge badge-muted">{source.visibility === "public" ? "Public" : "Private"}</span> : null}
        {source.sha ? <CopyButton text={source.sha} label="commit SHA" showLabel /> : null}
      </div>
      <details className="mt-1 text-xs text-text-muted">
        <summary className="cursor-pointer">Managed by DevHub</summary>
        <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
          {source.url ? <><dt>Repository</dt><dd className="break-all font-mono">{source.url}</dd></> : null}
          {source.destination ? <><dt>Stored at</dt><dd className="break-all font-mono">{source.destination}</dd></> : null}
        </dl>
      </details>

      {unsupported ? (
        <>
          <div className="tone-panel tone-panel--warning mt-4" role="status">
            <p className="font-semibold">This plugin needs features this installer can’t apply</p>
            <p className="mt-1 text-xs">{preview.body}</p>
          </div>
          <InventoryBlock groups={preview.inventory} />
          <p className="mt-4 text-xs text-text-subtle">Nothing has been enabled. {NO_CODE_HAS_RUN}</p>
        </>
      ) : nameBlocked ? (
        <div className="tone-panel tone-panel--warning mt-4" role="status">
          <p className="font-semibold">{nameBlocked.message}</p>
        </div>
      ) : (
        <>
          {otherBlockers.map((item) => (
            <div key={item.code} className="tone-panel tone-panel--warning mt-4" role="status"><p className="text-xs">{item.message}</p></div>
          ))}
          <p className="mt-4 text-xs font-semibold text-text">Adds to DevHub</p>
          <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-text-muted">Skills</dt><dd>{preview.contributions.skills.length}</dd>
            <dt className="text-text-muted">Agents</dt><dd>{preview.contributions.agents.length}</dd>
          </dl>
          <AssetList title="Skills" assets={preview.contributions.skills} labels={labels} />
          <AssetList title="Agents" assets={preview.contributions.agents} labels={labels} />
          {preview.contributions.agents.some((agent) => agent.readonly) ? (
            <p className="mt-2 text-xs text-text-subtle">A read-only agent declaration is guidance for the target tool, not an operating-system sandbox.</p>
          ) : null}

          {!blocked ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold text-text">{props.syncHeading}</legend>
              {props.syncNote ? <p className="mt-1 text-xs text-text-subtle">{props.syncNote}</p> : null}
              <div className="mt-2 flex flex-col gap-1">
                {preview.targets.map((target) => (
                  <label key={target.id} className="flex items-start gap-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={props.selected.includes(target.id)}
                      disabled={Boolean(target.conflict)}
                      onChange={(event) => props.onSelect(event.target.checked
                        ? [...props.selected, target.id]
                        : props.selected.filter((id) => id !== target.id))}
                    />
                    <span>
                      <span className="text-sm text-text">{target.label}</span>
                      <span className="block break-all font-mono text-text-subtle">{target.pathLabel}</span>
                      {target.conflict ? <span className="block text-warning">{target.conflict}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              {props.selected.length === 0 && preview.canApply ? (
                <p className="mt-2 text-xs text-text-subtle">The plugin will appear in DevHub. It won’t be copied to your AI tools yet.</p>
              ) : null}
            </fieldset>
          ) : null}

          <div className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-text">Requirements</h3>
              {preview.requirementsMet ? <span className="text-xs text-text-muted">{preview.requirements.length === 0 ? "None" : "All available"}</span> : null}
            </div>
            {preview.requirementsMet && preview.requirements.length > 0 ? <p className="mt-1 text-xs text-text-subtle">All requirements are available.</p> : null}
            {preview.requirements.filter((item) => !item.available).map((item) => (
              <div key={item.command} className="tone-panel tone-panel--warning mt-2">
                <p className="text-xs font-semibold">Missing: {item.command}</p>
                <p className="mt-1 text-xs">This plugin needs {item.command} on the service PATH.</p>
                <p className="mt-2 text-xs font-semibold">Install hint from the plugin author</p>
                {item.installHint ? (
                  <>
                    <pre className="mt-1 overflow-x-auto text-xs" style={{ fontFamily: "var(--font-mono)" }}>{item.installHint}</pre>
                    <p className="mt-1 text-xs">Review this command before running it. DevHub hasn’t run it.</p>
                    <div className="mt-1"><CopyButton text={item.installHint} label="hint" showLabel /></div>
                  </>
                ) : (
                  <p className="mt-1 text-xs">The plugin author hasn’t provided installation instructions.</p>
                )}
                <p className="mt-2 text-xs text-text-muted">Run this on: {props.runtimeLabel}</p>
              </div>
            ))}
          </div>

          <section className="mt-5" aria-labelledby="plugin-trust">
            <h3 id="plugin-trust" className="text-sm font-semibold text-text">Trust this source</h3>
            <p className="mt-1">Plugins can change how your AI tools behave and may include commands that run with your user account. Only enable code and instructions you trust.</p>
            <p className="mt-2 text-xs text-text-subtle">What’s listed here is what the plugin declares. It isn’t a complete list of everything its skills and agents may ask your tools to do.</p>
            <p className="mt-2 text-xs text-text-subtle">Downloaded for review. {NO_CODE_HAS_RUN}</p>
          </section>
        </>
      )}
    </div>
  );
}

/* ─── Finished ─── */

export function SuccessBody({ operation }: { operation: PluginOperationView }) {
  const result = operation.result;
  if (!result) return null;
  const install = operation.kind === "install" || operation.kind === "enable";
  const copied = result.targets.length > 0;
  return (
    <div className="text-sm">
      {install ? (
        <ul className="space-y-1">
          <li className="flex gap-2"><span aria-hidden className="text-success">✓</span><span>{result.summary}</span></li>
          {copied ? (
            <li className="flex gap-2"><span aria-hidden className="text-success">✓</span><span>{result.syncSummary}</span></li>
          ) : (
            <li className="text-text-muted">{result.syncSummary}</li>
          )}
        </ul>
      ) : (
        <p>{result.summary}</p>
      )}
      {install && copied ? <p className="mt-3 text-xs text-text-subtle">Start a new session in your AI tool if the new items don’t appear yet.</p> : null}
      {result.kept.length > 0 ? (
        <div className="mt-3">
          <ul className="space-y-0.5 text-xs">
            {result.kept.map((file) => <li key={file} className="break-all font-mono">{file}</li>)}
          </ul>
          <div className="mt-1"><CopyButton text={result.kept.join("\n")} label="paths" showLabel /></div>
        </div>
      ) : null}
    </div>
  );
}

/** Safe diagnostics, fetched only when asked for. */
function DiagnosticsDetails({ operationId }: { operationId: string }) {
  const [text, setText] = useState<string | null>(null);
  const load = (open: boolean) => {
    if (!open || text !== null) return;
    getJson<Record<string, unknown>>(`/api/plugins/operations/${encodeURIComponent(operationId)}/diagnostics`)
      .then((value) => setText(JSON.stringify(value, null, 2)))
      .catch((err: unknown) => setText(asFailure(err).message));
  };
  return (
    <details className="mt-3 text-xs" onToggle={(event) => load(event.currentTarget.open)}>
      <summary className="cursor-pointer text-text-muted">Details</summary>
      <pre className="mt-2 overflow-x-auto rounded-md border border-border-muted bg-bg-surface p-3" style={{ fontFamily: "var(--font-mono)" }}>{text ?? "Loading…"}</pre>
    </details>
  );
}

export function FailureBody({ operation, diagnosticsText }: { operation: PluginOperationView; diagnosticsText: string | null }) {
  const error = operation.error;
  return (
    <div className="text-sm" role="alert">
      {error ? <p>{error.message}</p> : operation.message ? <p>{operation.message}</p> : null}
      {error && error.consequences.length > 0 ? (
        <ul className="mt-3 space-y-0.5">{error.consequences.map((line) => <li key={line}>{line}</li>)}</ul>
      ) : null}
      {operation.state === "expired" ? <p className="mt-3">{operation.error?.message ?? "The plugin or its targets changed. Review the changes again."}</p> : null}
      {error && error.paths.length > 0 ? (
        <div className="mt-3">
          <ul className="space-y-0.5 text-xs">{error.paths.map((file) => <li key={file} className="break-all font-mono">{file}</li>)}</ul>
          <div className="mt-1"><CopyButton text={error.paths.join("\n")} label="paths" showLabel /></div>
        </div>
      ) : null}
      <DiagnosticsDetails operationId={operation.id} />
      {diagnosticsText ? <DiagnosticsFallback text={diagnosticsText} /> : null}
    </div>
  );
}

/** Shown under a body whose Copy diagnostics button could not reach the clipboard. */
export function DiagnosticsFallback({ text }: { text: string }) {
  return (
    <>
      <p className="mt-3 text-xs" role="alert">Couldn’t copy diagnostics. Select and copy the text below.</p>
      <textarea className="input mt-2 w-full text-xs" style={{ fontFamily: "var(--font-mono)" }} readOnly rows={8} value={text} aria-label="Diagnostics" />
    </>
  );
}

export function GuideLink({ children, className }: { children: ReactNode; className?: string }) {
  return <Link href={PLUGIN_GUIDE_HREF} className={className} style={className ? undefined : ACCENT_TEXT}>{children}</Link>;
}

export { ACCENT_TEXT };
