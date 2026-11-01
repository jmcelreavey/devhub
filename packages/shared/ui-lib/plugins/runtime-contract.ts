import { z } from "zod";
import { runtimeAssetSchema as asset, runtimeDigestSchema as digest, runtimeRelativePathSchema as relative } from "./runtime-assets-schema.ts";
import { runtimeThemesSchema } from "./runtime-theme-contract.ts";
import { pageBrowserSchema } from "./runtime-page-contract.ts";
import { aliasPathsOverlap, runtimeAliasSchema } from "./alias-contract.ts";

const homePath = z.string().max(240).regex(/^~\/[a-zA-Z0-9_.-][a-zA-Z0-9_./-]*$/).refine((s) => s.slice(2).split("/").every((p) => p !== "." && p !== ".." && p !== ""), "Use a specific path beneath the home directory");
const command = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const label = z.string().min(1).max(120);
const route = z.string().max(240).regex(/^\/[a-zA-Z0-9_/-]*$/).refine((s) => !s.includes("//"));
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,80}$/).refine((name) => !/^(NODE|DEVHUB|NPM|LD_|DYLD_|PATH$|HOME$|TMP|TEMP|XDG_|BASH|ENV$|SHELL$|PYTHON|RUBY|PERL)/.test(name), "Runtime control variables cannot be requested");
const publicEnvName = envName.refine((name) => !/(?:^|_)(?:[A-Z_]*KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|AUTHORIZATION)(?:_|$)/.test(name), "Credentials must stay in permissions.env");
const settingName = publicEnvName.refine((name) => name === "AWS_PROFILE" || name.endsWith("_USER_EMAIL"), "Unsupported host setting");
const colour = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const tokens = z.object({ bg: colour, text: colour, accent: colour, border: colour }).strict();
const integrationCapability = z.enum(["issue.read", "repo.read", "pr.read", "check.read", "doc.read", "chat.read", "alerts.read", "issue.transitions", "issue.assign-self", "issue.assign", "issue.create", "issue.transition", "pr.create", "pr.update", "pr.publish"]);
const readSource = z.enum(["github.prs", "jira.issues", "datadog.alerts"]);

const slotRoute = z.object({
  path: route, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  confirmation: z.string().min(1).max(500).optional(),
  timeoutSeconds: z.number().int().min(30).max(900).optional(),
}).strict().refine((value) => value.method === "GET" || !!value.confirmation, "Slot writes need a host confirmation");
const legacySetting = z.object({ path: route, method: z.enum(["POST", "DELETE"]).optional(), keys: z.array(settingName).min(1).max(1) }).strict();
const slotSetting = z.object({
  slot: slug, path: route, method: z.enum(["POST", "DELETE"]),
  keys: z.array(envName).min(1).max(20), credentials: z.boolean(), clear: z.boolean(),
}).strict().refine((value) => new Set(value.keys).size === value.keys.length, "Duplicate setting key");
const mcpSetting = z.object({
  server: slug, tool: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/),
  keys: z.array(settingName).min(1).max(1), clear: z.boolean(),
}).strict();
const terminalProposal = z.object({
  server: slug, tool: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/),
  label, summary: label,
}).strict();
const hostApproval = z.union([
  z.object({ path: route, method: z.enum(["POST", "PUT", "PATCH", "DELETE"]) }).strict(),
  z.object({ server: slug, tool: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/) }).strict(),
]);
const backgroundRun = z.union([
  z.object({ path: route, method: z.literal("POST"), runRoute: route }).strict(),
  z.object({ server: slug, tool: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/), runRoute: route }).strict(),
]);
const agentInputKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const agentRunFields = {
  label, action: slug, prompt: z.string().trim().min(1).max(8000),
  inputKeys: z.array(agentInputKey).max(20), titleKey: agentInputKey.optional(),
};
const agentRun = z.union([
  z.object({ ...agentRunFields, server: slug, tool: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/) }).strict(),
  z.object({ ...agentRunFields, path: route, method: z.literal("POST") }).strict(),
]).refine(value => new Set(value.inputKeys).size === value.inputKeys.length && (!value.titleKey || value.inputKeys.includes(value.titleKey)), "Agent input keys must be distinct and include the title key");
export const runtimeSlotSchema = z.object({
  id: slug, location: z.enum(["repo", "setup", "task"]), label,
  routes: z.array(slotRoute).max(20),
}).strict().refine((value) => new Set(value.routes.map((r) => `${r.method} ${r.path}`)).size === value.routes.length, "Duplicate slot route");
export type RuntimeSlot = z.infer<typeof runtimeSlotSchema>;

export const runtimeSchema = z.object({
  api: z.literal("1"),
  transport: z.literal("request-worker"),
  entry: relative.refine((s) => s.endsWith(".mjs"), "Bundle must be an .mjs file"),
  sha256: digest,
  lockfile: asset,
  pages: z.array(z.object({ path: route, label, browser: pageBrowserSchema.optional() }).strict()).max(30),
  nav: z.array(z.object({
    href: z.string().min(1), label: z.string().min(1), icon: z.string().min(1),
    group: z.enum(["workspace", "library", "infra", "system"]), gate: z.string().min(1).optional(),
    desktopOnly: z.boolean().optional(), sidebar: z.boolean().optional(), shortcut: z.string().min(1).optional(),
    section: z.enum(["library", "system", "infra"]).optional(),
  }).strict()).max(30).optional(),
  routes: z.array(z.object({ path: route, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), stream: z.boolean().optional(), timeoutSeconds: z.number().int().min(30).max(900).optional() }).strict()).max(100),
  mcp: z.array(z.object({ name: slug, description: label, timeoutSeconds: z.number().int().min(30).max(900).optional() }).strict()).max(20),
  aliases: z.array(runtimeAliasSchema).max(100).optional(),
  capabilities: z.object({
    reads: z.array(z.object({ path: route, sources: z.array(readSource).min(1).max(3).refine(sources => new Set(sources).size === sources.length, "Duplicate read source") }).strict()).max(10).optional(),
    themes: runtimeThemesSchema.optional(),
    service: z.object({
      id: slug, label, maxRunSeconds: z.number().int().min(30).max(86400),
      tasks: z.array(z.enum(["profile", "read", "context", "handoff", "questions", "answer", "answer-repo", "cancel-run", "reconcile-run", "pickup-create", "pickup-hold", "pickup-finish", "pickup-retire", "pickup-note", "handoff-note-read", "handoff-note", "git-repos", "git-pickup", "git-inspect", "git-push", "jira-connected", "jira-assign-self", "pull-requests", "calendar-week", "quiet-hours", "board-snapshot", "plugin-needs", "workflow-state", "workflow-note", "run-usage", "plan-approve", "task-retry"])).max(32)
        .refine((operations) => new Set(operations).size === operations.length, "Duplicate service task operation").optional(),
    }).strict().optional(),
    slots: z.array(runtimeSlotSchema).max(20).optional(),
    database: z.object({ id: slug.refine((id) => id !== "local", "The local namespace belongs to core"), listTimeoutSeconds: z.number().int().min(3).max(30).optional() }).strict().optional(),
    settings: z.array(z.union([legacySetting, slotSetting, mcpSetting])).max(10).optional(),
    terminalProposals: z.array(terminalProposal).max(10).optional(),
    approvals: z.array(hostApproval).max(20).optional(),
    backgroundRuns: z.array(backgroundRun).max(10).optional(),
    agentRuns: z.array(agentRun).max(10).optional(),
    integrations: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/), label, capabilities: z.array(integrationCapability).min(1).max(20) }).strict()).max(10).optional(),
  }).strict().optional(),
  permissions: z.object({
    env: z.array(envName).max(40),
    publicEnv: z.array(publicEnvName).max(40).optional(),
    network: z.array(z.string().min(1).max(240)).max(40),
    exec: z.boolean(),
    read: z.array(homePath).max(20).optional(),
    write: z.array(homePath).max(20).optional(),
    notes: z.array(z.object({ path: slug, write: z.boolean() }).strict()).max(10)
      .refine(scopes => new Set(scopes.map(scope => scope.path)).size === scopes.length, "Duplicate notes scope").optional(),
    state: z.array(z.object({ id: slug, root: z.enum(["profile", "xdg"]), path: relative, write: z.boolean() }).strict()).max(10)
      .refine(scopes => new Set(scopes.map(scope => scope.id)).size === scopes.length, "Duplicate state scope").optional(),
    commands: z.array(command).max(20).optional(),
  }).strict().refine((permissions) => {
    const publicNames = permissions.publicEnv ?? [];
    return new Set(publicNames).size === publicNames.length && publicNames.every(name => !permissions.env.includes(name));
  }, "Public settings must be unique and separate from credentials"),
  branding: z.object({
    label,
    dark: tokens,
    light: tokens,
    logo: asset.refine((a) => /\.(png|webp)$/.test(a.path), "Use a PNG or WebP logo").optional(),
    font: asset.refine((a) => a.path.endsWith(".woff2"), "Use a WOFF2 font").optional(),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.capabilities?.service?.tasks?.length && !value.permissions.network.includes("127.0.0.1")) {
    ctx.addIssue({ code: "custom", path: ["capabilities", "service", "tasks"], message: "Service task access needs a loopback network grant" });
  }
  const aliases = value.aliases ?? [];
  for (const alias of aliases) {
    const declared = alias.kind === "page"
      ? !alias.path.startsWith("/api/") && value.pages.some(page => page.path === alias.target)
      : value.routes.some(route => route.path === alias.target && route.method === alias.method &&
        (route.stream ? alias.method === "GET" && !!alias.preflight && value.routes.some(check => check.path === alias.preflight && check.method === "GET" && !check.stream) : !alias.preflight));
    if (!declared) ctx.addIssue({ code: "custom", path: ["aliases"], message: "Aliases need a declared page or API target; streaming GETs need a preflight route" });
  }
  for (let index = 0; index < aliases.length; index++) {
    const alias = aliases[index];
    if (aliases.slice(0, index).some(other => (other.kind === "page" ? "GET" : other.method) === (alias.kind === "page" ? "GET" : alias.method) && aliasPathsOverlap(other.path, alias.path))) {
      ctx.addIssue({ code: "custom", path: ["aliases"], message: "Overlapping aliases" });
    }
  }
  for (const [key, names] of [
    ["pages", value.pages.map((p) => p.path)],
    ["routes", value.routes.map((p) => `${p.method} ${p.path}`)],
    ["mcp", value.mcp.map((p) => p.name)],
    ["integrations", (value.capabilities?.integrations ?? []).map((p) => p.id)],
    ["slots", (value.capabilities?.slots ?? []).map((p) => p.id)],
    ["reads", (value.capabilities?.reads ?? []).map((p) => p.path)],
    ["settings", (value.capabilities?.settings ?? []).map((p) => "server" in p ? `MCP ${p.server} ${p.tool}` : `${p.method ?? "POST"} ${p.path}`)],
    ["terminalProposals", (value.capabilities?.terminalProposals ?? []).map((p) => `${p.server} ${p.tool}`)],
    ["agentRuns", (value.capabilities?.agentRuns ?? []).map((p) => "server" in p ? `MCP ${p.server} ${p.tool}` : `${p.method} ${p.path}`)],
    ["approvals", (value.capabilities?.approvals ?? []).map((p) => "server" in p ? `MCP ${p.server} ${p.tool}` : `${p.method} ${p.path}`)],
    ["backgroundRuns", (value.capabilities?.backgroundRuns ?? []).map((p) => "server" in p ? `MCP ${p.server} ${p.tool}` : `${p.method} ${p.path}`)],
  ] as const) {
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate runtime entry" });
  }
  for (const read of value.capabilities?.reads ?? []) {
    if (!value.routes.some(route => route.path === read.path && route.method === "GET" && !route.stream)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "reads"], message: "Host reads need a declared non-streaming GET route" });
    }
  }
  for (const setting of value.capabilities?.settings ?? []) {
    if ("server" in setting) {
      if (!value.mcp.some(server => server.name === setting.server) || setting.keys.some(key => !value.permissions.publicEnv?.includes(key))) {
        ctx.addIssue({ code: "custom", path: ["capabilities", "settings"], message: "MCP settings need a declared server and public environment grant" });
      }
    } else if ("slot" in setting) {
      const slot = value.capabilities?.slots?.find(candidate => candidate.id === setting.slot);
      const reviewed = slot?.routes.some(candidate => candidate.path === setting.path && candidate.method === setting.method);
      const granted = setting.keys.every(key => value.permissions.publicEnv?.includes(key) || setting.credentials && value.permissions.env.includes(key));
      if (!reviewed || !granted) ctx.addIssue({ code: "custom", path: ["capabilities", "settings"], message: "Slot settings need a reviewed write action and matching environment grants" });
    } else if (!value.routes.some(route => route.path === setting.path && route.method === (setting.method ?? "POST") && !route.stream) || setting.keys.some(key => !value.permissions.publicEnv?.includes(key))) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "settings"], message: "Setting writes need a declared non-streaming route and public environment grant" });
    }
  }
  for (const proposal of value.capabilities?.terminalProposals ?? []) {
    if (!value.mcp.some(server => server.name === proposal.server)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "terminalProposals"], message: "Terminal proposals need a declared MCP server" });
    }
  }
  for (const approval of value.capabilities?.approvals ?? []) {
    if ("server" in approval ? !value.mcp.some(server => server.name === approval.server) : !value.routes.some(route => route.path === approval.path && route.method === approval.method)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "approvals"], message: "Host approvals need a declared write route or MCP server" });
    }
  }
  for (const run of value.capabilities?.backgroundRuns ?? []) {
    const approval = value.capabilities?.approvals?.some(candidate => "server" in run
      ? "server" in candidate && candidate.server === run.server && candidate.tool === run.tool
      : "path" in candidate && candidate.path === run.path && candidate.method === run.method);
    if (!approval || !value.routes.some(candidate => candidate.path === run.runRoute && candidate.method === "POST" && candidate.stream)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "backgroundRuns"], message: "Background runs need an approval and a streaming POST route" });
    }
  }
  for (const agent of value.capabilities?.agentRuns ?? []) {
    if ("server" in agent ? !value.mcp.some(server => server.name === agent.server) : !value.routes.some(route => route.path === agent.path && route.method === agent.method && !route.stream)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", "agentRuns"], message: "Agent runs need a declared MCP server or non-streaming write route" });
    }
  }
  for (const page of value.pages) {
    if (page.browser?.navigation?.some(target => !value.pages.some(candidate => candidate.path === target))) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "Browser navigation must target a declared plugin page" });
    }
  }
});

export type RuntimeContribution = z.infer<typeof runtimeSchema>;

/** Conservative comparison: changing executable bytes always requires fresh consent. */
export function permissionChanges(previous: RuntimeContribution, next: RuntimeContribution): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)] as (keyof RuntimeContribution)[]);
  return [...keys].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

export function runtimeInventory(runtime: RuntimeContribution): { kind: string; entries: string[]; note: string | null; more: number }[] {
  const group = (kind: string, entries: string[]) => ({ kind, entries: entries.length ? entries : ["None declared."], note: null, more: 0 });
  const slotContext = { setup: "setup location only", repo: "repo name and resolved path", task: "task ID, creation identity, title, note path, active profile and read-only state" };
  const serviceTasks = { profile: "list task profiles", read: "read tasks in those profiles", context: "read task notes and agent context", handoff: "change task handoff ownership", questions: "read open task questions", answer: "answer unchanged task-note questions in the active profile", "answer-repo": "answer unchanged repository questions and resume the task", "cancel-run": "cancel scoped task agent runs", "reconcile-run": "reconcile scoped task agent runs", "pickup-create": "create a pending pickup task", "pickup-hold": "hold a pickup task", "pickup-finish": "finish a pickup task", "pickup-retire": "retire a pending pickup", "pickup-note": "write a pickup handoff note", "handoff-note-read": "read a handoff note revision", "handoff-note": "replace an unchanged handoff note section", "git-repos": "list local repository origins", "git-pickup": "fetch a branch and create a pickup worktree", "git-inspect": "inspect task checkout changes", "git-push": "commit reviewed changes and push a handoff branch", "jira-connected": "check Jira connection", "jira-assign-self": "assign the picked-up Jira issue to the current user", "pull-requests": "read pull requests and owned repositories", "calendar-week": "read the next seven days of calendar events", "quiet-hours": "read notification quiet hours", "board-snapshot": "read board cards and complete task workflow records in available profiles", "plugin-needs": "read enabled plugin attention items", "workflow-state": "read task workflow state in the active profile", "workflow-note": "append a task note in the active profile", "run-usage": "read scoped task agent run results and usage", "plan-approve": "approve a reviewed task plan in the active profile", "task-retry": "retry a task in the active profile" };
  return [
    group("Pages", runtime.pages.map((p) => `${p.label}: ${p.path}`)),
    group("Page browser access", runtime.pages.filter(page => page.browser).map(page => `${page.path}: preferences ${page.browser?.preferences?.join(", ") || "none"}${page.browser?.clipboard ? " · copy reviewed text to clipboard" : ""}${page.browser?.externalLinks ? " · open HTTP(S) evidence links with confirmation" : ""}${page.browser?.navigation?.length ? ` · navigate to ${page.browser.navigation.join(", ")}` : ""}${page.browser?.createNote ? ` · create today's ${page.browser.createNote}/ note with confirmation; never overwrite` : ""}`)),
    group("API routes", runtime.routes.map((p) => `${p.method} ${p.path}${p.stream ? " · live output" : ""}${p.timeoutSeconds ? ` · ${p.timeoutSeconds}s limit` : ""}`)),
    group("Legacy URLs", (runtime.aliases ?? []).map(alias => `${alias.kind === "page" ? "GET" : alias.method} ${alias.path} → ${alias.target} · core routes and other plugins cannot be replaced`)),
    group("Host reads", (runtime.capabilities?.reads ?? []).map(read => `GET ${read.path}: ${read.sources.join(", ")} · metadata only`)),
    group("Host setting writes", (runtime.capabilities?.settings ?? []).map(setting => `${"server" in setting ? `MCP ${setting.server} · tool ${setting.tool}` : `${"slot" in setting ? `slot ${setting.slot} · ` : ""}${setting.method ?? "POST"} ${setting.path}`}: ${setting.keys.join(", ")}${"slot" in setting && setting.credentials ? " · may update credentials" : ""}${("slot" in setting || "server" in setting) && setting.clear ? " · may clear settings" : ""} · ${"server" in setting ? "save only after current success" : "save only after a successful current worker response"}`)),
    group("Terminal proposals", (runtime.capabilities?.terminalProposals ?? []).map(proposal => `MCP ${proposal.server} · tool ${proposal.tool}: ${proposal.label} · runs automatically; destructive commands require confirmation`)),
    group("Host approvals", (runtime.capabilities?.approvals ?? []).map(approval => `${"server" in approval ? `MCP ${approval.server} · tool ${approval.tool}` : `${approval.method} ${approval.path}`} · user reviews action and payload`)),
    group("Background runs", (runtime.capabilities?.backgroundRuns ?? []).map(run => `${"server" in run ? `MCP ${run.server} · tool ${run.tool}` : `${run.method} ${run.path}`} → ${run.runRoute} · starts only after host approval`)),
    group("Agent runs", (runtime.capabilities?.agentRuns ?? []).map(agent => `${"server" in agent ? `MCP ${agent.server} · tool ${agent.tool}` : `${agent.method} ${agent.path}`}: ${agent.label} · starts an agent in the notes directory on invocation · caller fields: ${agent.inputKeys.join(", ") || "none"} · reviewed prompt: ${agent.prompt}`)),
    group("MCP servers and commands", runtime.mcp.map((p) => `${p.name}: bundled Node ${runtime.entry} (request-worker)${p.timeoutSeconds ? ` · ${p.timeoutSeconds}s limit` : ""}`)),
    group("Database providers", runtime.capabilities?.database ? [`${runtime.capabilities.database.id}: internal list, preflight, resolve and invalidate calls; credentials stay server-side; list limit ${runtime.capabilities.database.listTimeoutSeconds ?? 3}s`] : []),
    group("Integration providers", (runtime.capabilities?.integrations ?? []).map((provider) => `${provider.id}: ${provider.label} · ${provider.capabilities.join(", ")}`)),
    group("Host slots", (runtime.capabilities?.slots ?? []).map((slot) => `${slot.location}/${slot.id}: ${slot.label} · ${slotContext[slot.location]} · ${slot.routes.map((r) => `${r.method} ${r.path}${r.confirmation ? ` (confirm: ${r.confirmation})` : ""}${r.timeoutSeconds ? ` (${r.timeoutSeconds}s limit)` : ""}`).join(", ") || "no actions"}`)),
    group("Background service", runtime.capabilities?.service ? [`${runtime.capabilities.service.id}: ${runtime.capabilities.service.label} · primary dashboard only · ${runtime.capabilities.service.maxRunSeconds}s limit · off until separately approved in Plugins${runtime.capabilities.service.tasks?.length ? ` · ${runtime.capabilities.service.tasks.map((task) => serviceTasks[task]).join(", ")}` : ""}`] : []),
    group("Runtime themes", (runtime.capabilities?.themes ?? []).map(theme => `${theme.id}: ${theme.label} · validated dark/light palettes${theme.surface ? " · sandboxed effect surface" : ""}${theme.staticImage || theme.staticLayers ? " · static image for motion off" : ""}${theme.staticSurface ? " · still surface for motion off" : ""}${theme.readableScene ? " · coarse non-editor layout and preview flags shared with the surface; protected areas stay host-only" : ""}${theme.pointerEffects ? ` · pointer events for ${theme.pointerEffects.join(", ")}` : ""}${theme.fogLayer ? " · host-masked fog layer" : ""}${theme.hostDecorations ? " · fixed host decorations" : ""}${theme.audio?.length ? " · sound off until user gesture and preference" : ""}`)),
    group("Environment and secrets", runtime.permissions.env),
    group("Public environment settings (may appear in output)", runtime.permissions.publicEnv ?? []),
    group("Network access (declared, not enforced)", runtime.permissions.network),
    group("Read-only home paths", runtime.permissions.read ?? []),
    group("Writable home paths", runtime.permissions.write ?? []),
    group("Notes vault access", (runtime.permissions.notes ?? []).map(scope => `${scope.path}/: ${scope.write ? "read and write" : "read only"} · existing vault files stay in place when the plugin is disabled`)),
    group("Retained state access", (runtime.permissions.state ?? []).map(scope => `${scope.id}: ${scope.root} state/${scope.path}/ · ${scope.write ? "read and write" : "read only"} · existing state stays in place when the plugin is disabled`)),
    group("Commands", [runtime.permissions.exec ? "May start child processes with your user account" : "Child processes blocked by Node permissions", ...(runtime.permissions.commands ?? []).map((name) => `Discover on PATH: ${name}`)]),
    group("Branding", runtime.branding ? [runtime.branding.label, "Dark and light colour presets", ...(runtime.branding.logo ? [runtime.branding.logo.path] : []), ...(runtime.branding.font ? [runtime.branding.font.path] : [])] : []),
    group("Bundle SHA-256", [runtime.sha256]),
    group("Lockfile SHA-256", [runtime.lockfile.sha256]),
  ];
}
