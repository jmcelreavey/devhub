import type { PluginOperationView } from "./model";

/** Offline page fixtures shared by interaction and rendered checks. */
export function readyOperation(): PluginOperationView {
  return {
    id: "a123456789abcdef", kind: "install", state: "ready", phase: "Prepare preview", steps: [], cancellable: true,
    message: null, startedAt: "2026-01-01T12:00:00.000Z", subject: "team-tools/examples", sourceUrl: "https://github.com/team-tools/examples", pluginId: null,
    result: null, error: null, access: null, issues: [], progress: [],
    preview: {
      operationId: "a123456789abcdef", revision: 1, planDigest: "reviewed-digest", registryRevision: "reviewed-registry", expiresAt: "2099-01-01T00:00:00.000Z",
      plugin: { name: "team-tools", version: "0.1.0", devhubApi: "1" },
      source: { url: "https://github.com/team-tools/examples", owner: "team-tools", repo: "examples", ref: "main", sha: "a".repeat(40), shortSha: "aaaaaaa", visibility: "private", managed: true, destination: "~/.local/share/devhub/plugins/repos/a123456789abcdef" },
      contributions: {
        skills: [{ name: "team-review", description: "Review changes using shared conventions.", path: "skills/team-review", status: "add", statusLabel: "Will add", supportingFiles: 2, executable: true, conflictTargets: [] }],
        agents: [{ name: "team-reviewer", description: "Review a small change.", path: "agents/team-reviewer.md", status: "add", statusLabel: "Will add", readonly: true, frontmatter: ["mode: subagent", "readonly: true"], conflictTargets: [] }],
      },
      declaredIgnored: [], unsupported: [], inventory: [], requirements: [], requirementsMet: true,
      targets: [{ id: "claude", label: "Claude Code", pathLabel: "~/.claude/skills · ~/.claude/agents", selectedByDefault: true, conflict: null }, { id: "codex", label: "Codex", pathLabel: "~/.codex/skills · ~/.codex/agents", selectedByDefault: true, conflict: null }],
      conflicts: [], blockers: [], canApply: true, heading: null, body: null,
    },
  };
}

export const pluginListFixture = { ok: true, plugins: [], operations: [], malformed: false, diagnostic: null, storageLine: "The download will be stored in TestDistro (WSL), where DevHub runs.", syncHeading: "Sync to tools in TestDistro", syncNote: "These are the tool folders in TestDistro. Windows-native tool configurations are separate.", runtimeLabel: "TestDistro (WSL)", settingsFile: "~/.config/devhub/plugins.json" };

export const accessFixture = { owner: "team-tools", repo: "examples", ghStatus: "Not signed in", gitStatus: "Couldn’t access this repository", runtimeLabel: "TestDistro (WSL)", login: null, ghAvailable: true, brewHint: false, commands: ["gh auth login --hostname github.com --git-protocol https --web", "gh auth setup-git --hostname github.com"], gitCommands: ["git config --global credential.helper '/mnt/c/Program Files/Git/mingw64/bin/git-credential-manager.exe'", "git ls-remote 'https://github.com/team-tools/examples.git' HEAD"], signedInDenied: false };
