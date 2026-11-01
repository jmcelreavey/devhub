import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireDashboardAuth } from "../../../lib/api-utils";
import { getCollectionsDir, getDocsDir, getHome, getNotesDir, getRepoRoot, getTasksDir } from "../../../lib/notes/dir";
import { taskEventStream, type EventRoot } from "@devhub/core/events/task-stream";
import { eventStream } from "../../../../../../packages/shared/actions/events";
import { agentRunsDir, legacyAgentRunsDir } from "../../../lib/agent-runs/paths";
import { sqliteRunsEnabled } from "@devhub/core/storage/runs";
import { sqliteDatabasePath } from "@devhub/core/storage/sqlite";
import { activeProfileFile } from "../../../../../../packages/shared/vault/task-profiles.ts";
import { noteMediaDir } from "../../../lib/notes/media-store";
import { schedulerStateDir } from "@devhub/core/scheduler/paths";
import { desktopLogDirs, getAppDataDir, getCheckoutRoot, getReposDir } from "../../../lib/desktop/runtime-paths";
import { rebuildStateDir } from "../../../lib/desktop/checkout-rebuild";
import { getReposScanDir, listRepoNames, resolveCommonDir, resolveGitDir } from "../../../lib/repos/index";
import { resolvePluginPaths } from "../../../lib/plugins/paths";
import { readRegistryFile, registryRevision } from "../../../lib/plugins/registry-write";
import { expandHome, listEnabledPlugins } from "../../../lib/plugins/registry";
import { getRepsDir, getResourceRoot, getUpstartsDir } from "../../../lib/content/dirs";
import { profileStateDir } from "../../../../../../packages/shared/storage/profile-state";
import { runHistoryFile } from "../../../lib/runs/history-path";
import { projectsFile } from "../../../lib/projects";
import { CONTENT_SYNC_PATHS } from "../../../lib/content/sync-paths";
import { aiToolsSkillsDir, resolveAiToolsRoot } from "../../../lib/ai/tools-skills";
import { agentDirEntries, toolDirPaths } from "../../../lib/sync/skills";
import { getDashboardEnvLocalPath } from "../../../lib/dashboard-env-local";
import { readUserConnections, userConnectionsPath } from "../../../lib/db/user-connections";


function gitEventRoots(repo: string): EventRoot[] {
  const workingTree: EventRoot = {
    path: repo,
    domain: "git",
    optional: true,
    ignore: (relative) => relative.split(/[\\/]/).some((part) => part === ".git" || part === "node_modules" || part === ".devhub" || part.startsWith(".next")),
  };
  const metadata = [...new Set([resolveGitDir(repo), resolveCommonDir(repo)].filter((dir): dir is string => dir !== null))];
  return [workingTree, { path: path.join(repo, ".devhub"), files: ["upstart.sh"], domain: "git", optional: true }, ...metadata.map((dir): EventRoot => ({
    path: dir,
    domain: "git",
    optional: true,
    ignore: (relative) => {
      const parts = relative.split(/[\\/]/);
      return ["objects", "hooks"].includes(parts[0]) || parts.some((part) => part.endsWith(".lock"));
    },
  }))];
}

function repoScanVersion(): string {
  try {
    const directories = readdirSync(getReposScanDir(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    return JSON.stringify([directories, listRepoNames().sort()]);
  } catch {
    return "";
  }
}

function dbEventRoots(): EventRoot[] {
  const file = userConnectionsPath();
  let sqliteFiles: string[] = [];
  try {
    sqliteFiles = readUserConnections(file).flatMap((connection) => connection.engine === "sqlite" && connection.file ? [path.resolve(connection.file)] : []);
  } catch (error) {
    console.error("[events] Cannot read database connections", error);
  }
  return [
    { path: path.dirname(file), files: [path.basename(file)], domain: "db", reconnect: true, optional: true },
    ...[...new Set(sqliteFiles)].map((sqlite): EventRoot => ({ path: path.dirname(sqlite), files: [path.basename(sqlite)], domain: "db", optional: true })),
  ];
}

function pluginPathsForStream() {
  try {
    return resolvePluginPaths();
  } catch (error) {
    console.error("[events] Cannot watch plugin changes", error);
    return null;
  }
}

function pluginSourceRoots(home: string, pluginHome: string): EventRoot[] {
  let sources: string[];
  try {
    sources = readRegistryFile(home).plugins.filter((entry) => entry.enabled !== false).map((entry) => expandHome(entry.path, home));
  } catch (error) {
    console.error("[events] Cannot read plugin source registry", error);
    try {
      sources = listEnabledPlugins(home).map((plugin) => path.resolve(plugin.path));
    } catch (fallbackError) {
      console.error("[events] Cannot load enabled plugins", fallbackError);
      return [];
    }
  }
  const managedRepos = path.join(pluginHome, "repos");
  const localSources = [...new Set(sources)].filter((source) => {
    const relative = path.relative(managedRepos, source);
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  });
  const manifestVersion = (source: string) => {
    try {
      const stat = statSync(path.join(source, "devhub-plugin.json"), { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch {
      return null;
    }
  };
  const initialVersions = new Map(localSources.map((source) => [source, manifestVersion(source)]));
  let enabled: string[];
  try {
    enabled = listEnabledPlugins(home).map((plugin) => path.resolve(plugin.path));
  } catch (error) {
    console.error("[events] Cannot load enabled plugins", error);
    enabled = [];
  }
  return localSources.flatMap((source): EventRoot[] => {
    return [
      { path: source, files: ["devhub-plugin.json"], domain: "plugins", optional: true, reconnect: true, validate: () => manifestVersion(source) === initialVersions.get(source) },
      ...(enabled.includes(path.resolve(source)) && path.resolve(source) !== path.parse(path.resolve(source)).root
        ? [{ path: source, domain: "plugins" as const, optional: true }]
        : []),
    ];
  });
}

export function GET(req: Request): Response {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  const repos = [...new Set(new URL(req.url).searchParams.getAll("repo"))];
  // eslint-disable-next-line no-control-regex -- Reject control characters in repository names.
  if (repos.length > 64 || repos.some((name) => !name || name.length > 255 || name === "." || name === ".." || /[\\/\x00-\x1f]/.test(name))) {
    return new Response("Invalid repository", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const allRepos = new URL(req.url).searchParams.get("repos") === "1";
  const repoNames = repos.length || allRepos ? listRepoNames() : [];
  const scanVersion = allRepos || repos.length ? repoScanVersion() : "";
  const allowed = new Set(repoNames);
  const checkoutRequested = new URL(req.url).searchParams.get("checkout") === "1";
  const checkout = checkoutRequested ? getCheckoutRoot() : null;
  const gitRepos = [...new Set([...(allRepos ? repoNames : repos.filter((name) => allowed.has(name))).map((name) => path.join(getReposScanDir(), name)), ...(checkout ? [checkout] : [])])];
  let uninitializedDirs: string[] = [];
  if (allRepos || repos.length) {
    try {
      uninitializedDirs = readdirSync(getReposScanDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !allowed.has(entry.name) && (allRepos || repos.includes(entry.name)))
        .map((entry) => path.join(getReposScanDir(), entry.name));
    } catch { uninitializedDirs = []; }
  }
  const legacyRuns = legacyAgentRunsDir();
  const database = sqliteRunsEnabled() ? sqliteDatabasePath() : null;
  const profileFile = activeProfileFile();
  const notesDir = getNotesDir();
  const pluginPaths = new URL(req.url).searchParams.get("plugins") === "1" ? pluginPathsForStream() : null;
  const pluginRevision = pluginPaths ? registryRevision(pluginPaths.home) : null;
  const records = new URL(req.url).searchParams.get("records") === "1";
  const recall = new URL(req.url).searchParams.get("recall") === "1";
  const docs = new URL(req.url).searchParams.get("docs") === "1";
  const db = new URL(req.url).searchParams.get("db") === "1";
  const skills = new URL(req.url).searchParams.get("skills") === "1";
  const syncTargets = new URL(req.url).searchParams.get("sync") === "1";
  const aiToolsSkills = skills ? aiToolsSkillsDir() : null;
  const dashboardEnv = skills ? getDashboardEnvLocalPath() : null;
  const content = new URL(req.url).searchParams.get("content") === "1" ? getRepoRoot() : null;
  const runHistory = records ? runHistoryFile() : null;
  const projects = records ? projectsFile() : null;
  return eventStream.handler({
    repo: repos, repos: allRepos, checkout: checkoutRequested, content: Boolean(content),
    plugins: new URL(req.url).searchParams.get("plugins") === "1", records, recall, docs, db, skills, sync: syncTargets,
  }, { execute: () => new Response(taskEventStream([
    { path: getTasksDir(), domain: "tasks" },
    { path: path.dirname(profileFile), files: [path.basename(profileFile)], domain: "tasks" },
    { path: notesDir, domain: "notes" },
    ...(db ? dbEventRoots() : []),
    ...gitRepos.flatMap(gitEventRoots),
    ...(allRepos || repos.length ? [
      { path: getReposScanDir(), domain: "git" as const, recursive: false, reconnect: true, optional: true, validate: () => repoScanVersion() === scanVersion },
      { path: getUpstartsDir(), domain: "git" as const, optional: true },
      ...uninitializedDirs.map((dir) => ({ path: dir, files: [".git"], domain: "git" as const, reconnect: true, optional: true })),
    ] : []),
    ...(skills && aiToolsSkills && dashboardEnv ? [
      ...[...new Set([path.join(getRepoRoot(), "skills"), path.join(resolveAiToolsRoot(), "skills"), aiToolsSkills, ...(syncTargets ? [path.join(getRepoRoot(), "agents", "shared"), ...toolDirPaths(os.homedir()), ...agentDirEntries(os.homedir()).map((entry) => entry.path)] : [])])].map((dir) => ({ path: dir, domain: "skills" as const, optional: true })),
      { path: path.join(os.homedir(), ".cache", "devhub", "ai-tools-upstream"), files: ["manifest.json"], domain: "skills" as const, optional: true, reconnect: true },
      { path: path.dirname(dashboardEnv), files: [path.basename(dashboardEnv)], domain: "skills" as const, optional: true },
    ] : []),
    ...(content ? [
      { path: content, files: [".git"], domain: "git" as const, optional: true },
      ...gitEventRoots(content).slice(1),
      ...CONTENT_SYNC_PATHS.map((dir) => ({ path: path.join(content, dir), domain: "git" as const, optional: true })),
    ] : []),
    ...(checkoutRequested ? [{ path: getAppDataDir(), files: ["content-repo-path.txt", "repo-path.txt"], domain: "git" as const, reconnect: true, optional: true, validate: () => getCheckoutRoot() === checkout }] : []),
    ...(pluginPaths ? [
      { path: pluginPaths.configDir, files: [path.basename(pluginPaths.registryPath)], domain: "plugins" as const, reconnect: true, optional: true, validate: () => registryRevision(pluginPaths.home) === pluginRevision },
      { path: path.join(pluginPaths.pluginHome, "operations"), domain: "plugin-operations" as const, optional: true },
      ...["receipts", "repos"].map((dir) => ({ path: path.join(pluginPaths.pluginHome, dir), domain: "plugins" as const, optional: true })),
      ...pluginSourceRoots(pluginPaths.home, pluginPaths.pluginHome),
    ] : []),
    ...(records && runHistory ? [
      { path: getRepsDir(), domain: "reps" as const, optional: true },
      { path: path.dirname(runHistory), files: [path.basename(runHistory)], domain: "script-history" as const, optional: true },
      { path: path.join(profileStateDir(), "skill-proposals"), domain: "skill-proposals" as const, optional: true },
      { path: path.join(getResourceRoot(), "skills", "shared"), domain: "skill-proposals" as const, optional: true },
      { path: path.join(os.homedir(), ".local", "state", "devhub"), files: ["agent-cli-updates.json"], domain: "cli-updates" as const, optional: true },
      { path: path.join(os.homedir(), ".local", "state"), files: ["agent-cli-updates.lock"], domain: "cli-updates" as const, optional: true },
      { path: path.join(getHome(), ".local", "state", "devhub"), files: ["shares.json"], domain: "shares" as const, optional: true },
      { path: path.join(getRepoRoot(), ".devhub", "ownership"), files: ["repos.json"], domain: "ownership" as const, optional: true },
      ...(projects ? [{ path: path.dirname(projects), files: [path.basename(projects)], domain: "projects" as const, optional: true }] : []),
    ] : []),
    ...(recall || docs ? [{ path: getDocsDir(), domain: "recall" as const, optional: true }] : []),
    ...(recall ? [{ path: getReposDir(), domain: "recall" as const, recursive: false, optional: true }] : []),
    ...desktopLogDirs().map((logDir) => ({ path: logDir, domain: "logs" as const, files: ["shell.log", "sidecar.log", "renderer.log"] })),
    { path: rebuildStateDir(process.env, process.env.HOME), domain: "rebuild" },
    { path: noteMediaDir(), domain: "media" },
    { path: schedulerStateDir(), files: ["jobs.json"], domain: "jobs" },
    { path: path.join(notesDir, ".config", "storyboard", "orchestrations"), domain: "orchestrations" },
    { path: path.join(notesDir, ".config", "task-agent-runs"), domain: "orchestrations" },
    { path: getCollectionsDir(), domain: "collections" },
    { path: agentRunsDir(), domain: "runs" },
    ...(legacyRuns ? [{ path: legacyRuns, domain: "runs" as const }] : []),
    ...(database ? [{
      path: path.dirname(database), domain: "runs" as const,
      files: [path.basename(database), `${path.basename(database)}-wal`],
    }] : []),
  ], req.signal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  }) }) as Response;
}
