---
name: devhub-create-shared-x
description: Use when creating or updating shared DevHub assets such as skills, persona guidance, shared agents, MCP server configs, or OpenCode model config in the devhub repo. Helps choose the right artifact, follow repo conventions, avoid secrets and machine-local paths, and verify sync readiness.
metadata:
  short-description: Create shared DevHub assets
---

# DevHub Create Shared X

## Overview

Use this skill when the user wants to create or update a shared DevHub asset:

- shared skills in `skills/shared/<slug>/SKILL.md`
- shared persona guidance in `persona/`
- shared agents in `agents/shared/<slug>.md`
- shared MCP server configs in `mcp/shared/<name>.json`
- shared OpenCode config in `opencode/shared/opencode.json`

Default to the smallest correct shared artifact. Do not add new code, scripts, sync targets, or compatibility layers unless the requested asset cannot work without them.

## Before Editing

1. Inspect nearby examples for the requested asset type.
2. Check the current repo conventions instead of relying on memory.
3. Choose a stable lowercase slug or file name.
4. Confirm the asset is safe to share across machines and tools.
5. Avoid secrets, tokens, credentials, private hostnames, and machine-local absolute paths.

If the user asks for a vague shared asset, ask one short clarifying question about the asset type or intended trigger before writing files.

## Shared Skills

Shared skills live under `skills/shared/<slug>/SKILL.md`.

Use a skill when the user wants a reusable workflow, checklist, domain procedure, or tool-usage guide that agents should load only when relevant.

### Skill Naming

- Use lowercase kebab-case or snake_case slugs.
- Keep names action-oriented and specific.
- Match the frontmatter `name` to the directory name.
- Prefer one focused skill over a broad knowledge dump.

### Skill Template

```markdown
---
name: example-skill
description: Use when <specific trigger>. Include enough detail for the agent to know when to load this skill.
metadata:
  short-description: <short dashboard label>
---

# Example Skill

## Overview

What this skill is for and the default outcome.

## When To Use

- Trigger condition 1
- Trigger condition 2

## Workflow

1. Inspect the current repo or inputs.
2. Make the smallest safe change or recommendation.
3. Verify the result.

## Verification

- Run the relevant repo command, or explain why verification was not run.
```

### Skill Rules

- Put operational instructions in the skill, not vague advice.
- Include concrete paths, commands, and decision points when useful.
- Keep frontmatter valid YAML.
- Do not include secrets or private credentials.
- Do not include AI attribution footers for commits, PRs, or published text.

## Persona Guidance

Persona files live under `persona/`.

Use persona changes when the requested behavior should apply broadly, not only during one named workflow.

Choose the smallest layer that fits:

- `persona/identity.txt` for tiny identity or always-on behavior only.
- `persona/shared-persona.md` for core engineering standards loaded every session.
- `persona/deep-preferences.md` (index) and `persona/modes/*.md` for context-heavy preferences; wire behavior with `skills/shared/deep-preferences/SKILL.md`.

Persona edits should be concise. Avoid adding project-specific implementation trivia, long examples, or instructions that belong in a skill.

After persona edits, remind the user to run **Skills -> Persona & Agent configs -> Sync persona** or the equivalent dashboard action.

## Shared Agents

Shared agents live as single Markdown files under `agents/shared/<slug>.md`.

Use an agent when the user wants a reusable specialist persona or role that can be delegated work independently.

Agent files should include:

- YAML frontmatter: `name`, `description` (with **Use when …** triggers), `mode: subagent`, `readonly: true|false`
- Do **not** add `tools:`, `model:`, or `permission:` in the repo — `sync_agents` emits OpenCode `permission:` and Cursor `readonly` per target
- Body sections: when called, workflow, rules, expected output, related skills (by name only)

```markdown
---
name: example-agent
description: Does X for Y. Use when the user asks about Z or needs a read-only pass on W.
mode: subagent
readonly: true
---

You are …

## When You Are Called

…

## Expected Output

…
```

Keep agent scopes narrow enough that automatic invocation stays reliable. If the agent would mostly restate an existing skill, create or update a skill instead. See `docs/guides/agents.md` for catalog and sync behavior.

After adding or updating shared agents, remind the user to run the dashboard agent sync action.

## Shared MCP Configs

Shared MCP configs live under `mcp/shared/<name>.json` with one file per server.

Use a shared MCP config when a server should be installed into supported tool configs by DevHub sync.

### Stdio MCP Shape

```json
{
  "command": "REPO_ROOT/path/to/executable",
  "args": ["REPO_ROOT/path/to/server.ts"],
  "env": {
    "EXAMPLE_DIR": "REPO_ROOT/example"
  },
  "description": "Short description of what this server provides."
}
```

### Remote MCP Shape

```json
{
  "type": "remote",
  "url": "https://example.com/mcp",
  "enabled": true,
  "description": "Short description of what this server provides."
}
```

### MCP Rules

- Use `REPO_ROOT` placeholders for repo-local paths.
- Do not store secrets in `env`; use user-local config or environment variables instead.
- Ensure each file has valid JSON.
- Include either a string `command` or a string `url`.
- Keep server names stable and compatible with `mcp/shared/<name>.json`.
- If the MCP depends on a user-installed local companion, browser extension, or explicitly enabled tab, put that requirement in `description`; do not encode machine-local extension paths, profile paths, cookies, or tokens in the shared config.
- For browser-extension MCPs such as Playwriter, use the upstream stdio command shape and document the manual consent step in the relevant workflow skill. Shared config installs the server; it cannot install or authorize Chrome extensions for the user.

After MCP edits, remind the user to run **Sync MCP** from the dashboard or rerun setup flows.

## Shared OpenCode Config

The shared OpenCode config lives in a single file: `opencode/shared/opencode.json`.

Use it to share OpenCode model selection, provider definitions and theme
across machines. Sync writes only a curated allowlist of top-level keys —
`model`, `small_model`, `provider`, `theme` — into
`~/.config/opencode/opencode.json`. Everything else in that file (the `mcp`
block, `$schema`, agents, anything OpenCode writes itself) is left untouched
so OpenCode keeps auto-updating its model catalogue.

### OpenCode Config Rules

- Only the curated keys are synced. Do not rely on other keys being shared.
- **Never store raw API keys, tokens or secrets.** Provider credentials must
  be OpenCode-native `{env:VAR}` placeholders, e.g.
  `"apiKey": "{env:OPENROUTER_API_KEY}"`. The matching value is supplied by the
  env layer (the 1Password `devhub` item / `.env.local`) and resolved into the
  local file at sync time. The repo always keeps the placeholder.
- Adding a provider is zero-code: drop a `{env:NEW_KEY}` placeholder and add a
  matching field named `NEW_KEY` to the 1Password `devhub` item.
- Ensure the file is valid JSON with an object at the root.

After OpenCode config edits, remind the user to run **Agents → OpenCode →
Sync OpenCode** from the dashboard.

## Verification

Use the narrowest verification that proves the shared asset is valid:

- For shared skills: ensure `SKILL.md` exists and starts with YAML frontmatter.
- For MCP configs: ensure JSON parses and includes `command` or `url`.
- For persona files: ensure the relevant persona file still reads cleanly and is not bloated.
- For agents: ensure the file is under `agents/shared/` and has a focused responsibility.
- For OpenCode config: ensure JSON parses and every secret-like value is an `{env:VAR}` placeholder (no raw keys).

When practical, run repo validation:

```bash
npm run verify
```

If full verification is too expensive, run the dashboard validation action or a targeted check, then report what was and was not verified.

## Final Response

Report:

- which shared asset was created or updated
- the exact path
- any sync action the user should run
- verification performed, or why it was skipped
