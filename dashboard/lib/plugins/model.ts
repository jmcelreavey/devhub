/** JSON shapes shared by the plugin API and the Plugins page. No Node imports. */

export type PluginOperationKind = "install" | "enable" | "disable" | "remove";

export type PluginOperationState =
  | "validating_url"
  | "checking_access"
  | "cloning"
  | "validating"
  | "preparing_preview"
  | "ready"
  | "needs_access"
  | "invalid"
  | "applying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "needs_attention";

export interface PluginStep {
  id: string;
  label: string;
  state: "pending" | "running" | "complete" | "failed" | "skipped";
}

export interface AssetPreview {
  name: string;
  description: string;
  path: string;
  /** Catalog precedence only. A target-name collision is `conflictTargets`. */
  status: "add" | "core" | "plugin";
  statusLabel: string;
  supportingFiles?: number;
  executable?: boolean;
  readonly?: boolean;
  /** Canonical frontmatter summary for an agent, e.g. ["mode: subagent", "readonly: true"]. */
  frontmatter?: string[];
  /** Targets whose destination already holds a same-named item DevHub did not install. */
  conflictTargets: string[];
}

export interface RequirementPreview {
  command: string;
  available: boolean;
  installHint: string | null;
}

export interface TargetPreview {
  id: string;
  label: string;
  pathLabel: string;
  selectedByDefault: boolean;
  conflict: string | null;
}

export interface PreviewIssue {
  code: string;
  message: string;
  field?: string;
}

/** Inert names and paths a plugin declares for things this installer cannot apply. */
export interface InventoryGroup {
  kind: string;
  entries: string[];
  note: string | null;
  /** Entries left out of `entries` to keep the review short. */
  more: number;
}

export interface PluginPreview {
  operationId: string;
  revision: number;
  planDigest: string;
  expiresAt: string;
  plugin: { name: string; version: string; devhubApi: "1" } | null;
  source: {
    url: string | null;
    owner: string | null;
    repo: string | null;
    /** Default branch the download followed, e.g. "main". */
    ref: string | null;
    sha: string | null;
    shortSha: string | null;
    visibility: "public" | "private" | null;
    managed: boolean;
    /** Where DevHub keeps the download, in the home-relative form people recognise. */
    destination: string | null;
  };
  contributions: {
    skills: AssetPreview[];
    agents: AssetPreview[];
  };
  declaredIgnored: string[];
  unsupported: string[];
  inventory: InventoryGroup[];
  requirements: RequirementPreview[];
  requirementsMet: boolean;
  targets: TargetPreview[];
  conflicts: PreviewIssue[];
  blockers: PreviewIssue[];
  registryRevision: string;
  canApply: boolean;
  heading: string | null;
  body: string | null;
}

export interface PluginOperationError {
  code: string;
  message: string;
  retryable: boolean;
  /** The condition things were left in, one plain sentence each. */
  consequences: string[];
  /** Locations the person needs to look at, home-relative. */
  paths: string[];
}

export interface TargetProgress {
  id: string;
  label: string;
  state: "waiting" | "running" | "complete" | "failed";
  done: number;
  total: number;
}

/** One problem found while reviewing: a manifest field, or a file path. */
export interface ReviewIssue {
  /** "devhub-plugin.json" for manifest problems, otherwise the repository-relative path. */
  file: string;
  /** Dotted manifest field, e.g. "contributes.skills"; empty for a file-level problem. */
  field: string;
  message: string;
}

export interface PluginOperationView {
  id: string;
  kind: PluginOperationKind;
  state: PluginOperationState;
  /** Label of the step in progress; shown to the person. */
  phase: string;
  steps: PluginStep[];
  cancellable: boolean;
  message: string | null;
  startedAt: string;
  /** What this is about: "owner/repo" for a download, the plugin name for a lifecycle change. */
  subject: string | null;
  /** The normalised repository address, when there is one. Never carries credentials. */
  sourceUrl: string | null;
  /** Registration this operation changes, for disable, remove and enable. */
  pluginId: string | null;
  preview: PluginPreview | null;
  result: PluginOperationResult | null;
  error: PluginOperationError | null;
  access: AccessView | null;
  issues: ReviewIssue[];
  /** Real copy counts per tool while a plugin is being enabled. */
  progress: TargetProgress[];
}

export interface PluginOperationResult {
  name: string;
  skillCount: number;
  agentCount: number;
  targets: string[];
  /** Installed copies that were left in place because they changed. */
  kept: string[];
  /** "4 skills and 1 agent added" */
  summary: string;
  /** "Synced to Claude Code and Codex", or why nothing was copied. */
  syncSummary: string;
}

export interface AccessView {
  owner: string;
  repo: string;
  ghStatus: string;
  gitStatus: string;
  runtimeLabel: string;
  login: string | null;
  ghAvailable: boolean;
  brewHint: boolean;
  commands: string[];
  gitCommands: string[];
  signedInDenied: boolean;
}

export interface PluginListItem {
  id: string;
  name: string;
  state: "enabled" | "disabled" | "needs_attention" | "local";
  stateLabel: string;
  /** "owner/repo" for a download, a home-relative folder for a registered folder. */
  sourceLabel: string;
  ref: string | null;
  shortSha: string | null;
  skills: number;
  agents: number;
  managed: boolean;
  attention: string | null;
}

export interface PluginDetail extends PluginListItem {
  version: string | null;
  sha: string | null;
  locationLabel: string;
  /** Absolute folder, for the Copy path action. Never put in diagnostics. */
  path: string;
  /** Home-relative form of the folder, for reading. */
  pathDisplay: string;
  githubUrl: string | null;
  syncedTo: string[];
  localNote: string | null;
  dashboardNote: string | null;
  /** The last thing done to this plugin, e.g. { label: "Enabled", at: "2026-10-08T19:00:00.000Z" }. */
  lastOperation: { label: string; at: string } | null;
  canDisable: boolean;
  canRemove: boolean;
  canEnable: boolean;
}

export interface PluginDiagnostic {
  operationId: string;
  operation: string;
  phase: string;
  errorCode: string | null;
  appVersion: string;
  runtime: string;
  distro: string | null;
  source: string | null;
  ref: string | null;
  sha: string | null;
  gitAvailable: boolean;
  ghAvailable: boolean;
  authMethod: string | null;
  exitCode: number | null;
  timedOut: boolean;
}
