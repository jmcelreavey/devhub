# devhub

Shared skills, persona, and MCP configs for Claude Code, Codex CLI, OpenCode, and Cursor. Designed for multi-machine, multi-platform use (macOS, Windows/WSL, iOS read-only).

## Quick Start

### Safe-Chain (required)

DevHub uses [Aikido Safe-Chain](https://github.com/AikidoSec/safe-chain) to block malicious npm packages. Install once per machine:

```bash
npm install -g @aikidosec/safe-chain@1.1.10
safe-chain setup
```

Restart your terminal so npm/yarn/pnpm are guarded. Verify:

```bash
npm install safe-chain-test   # should be blocked
```

### 1Password secrets (recommended before first run)

DevHub can start without integration secrets, but a useful fresh machine wants the 1Password CLI ready before `npm run dev`. Startup checks call `op` and can load missing managed secrets from a 1Password item named `devhub`.

Install and sign in once:

```bash
# macOS example; use the official 1Password CLI install for other platforms.
brew install --cask 1password-cli
op signin
```

Create or sync an item named `devhub` with fields named exactly like the env vars DevHub needs, for example `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `JIRA_DOMAIN`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `DATADOG_API_KEY`, `DATADOG_APPLICATION_KEY`, and `Z_AI_API_KEY`.

To keep 1Password as the source of truth instead of caching secrets into `dashboard/.env.local`, set this in your shell before starting DevHub:

```bash
export DEVHUB_OP_CACHE=0
```

The `/setup` page still helps confirm which integrations are configured after the app boots. If `op` is missing, not signed in, or the `devhub` item cannot be found, `npm run doctor` prints the same diagnosis without starting the dashboard.

### Install and run

```bash
# Clone the repo
git clone git@github.com:jmcelreavey/devhub.git ~/dev/devhub
cd ~/dev/devhub

# Installs dashboard deps (root postinstall → dashboard); dashboard postinstall
# bootstraps .env.local, notes dirs, and git hooks.
npm install

# Run the dashboard
npm run dev          # hot reload, recommended for day-to-day
# npm run start      # production build (faster, no reload)

# Open and configure optional integrations from /setup
open http://localhost:1337   # macOS — on Linux/WSL: xdg-open http://localhost:1337
```

You can still run `npm install` / `npm run dev` inside `dashboard/` if you prefer.

Optional **bootstrap** from the repo root: `bash scripts/install.sh` installs dashboard deps, then runs a **TypeScript** bootstrap (`dashboard/scripts/bootstrap-install.ts`) — skill + persona sync, MCP configs, notes-server deps, production build, validation. Day-to-day sync is from the **Actions** and **Skills** pages in the app.

After install, start a session in any supported AI tool. It will automatically read `AGENTS.md` at the repo root and load your persona.

`install.sh` is **idempotent** — re-running it safely reinstalls deps and re-runs bootstrap. For deps-only refresh: `npm install` at the repo root (or `cd dashboard && npm install`).

## Dashboard (DevHub)

A Next.js-based personal dev dashboard (default `http://localhost:1337`).

> **Trusted network only.** DevHub ships with no authentication. Use it on a LAN you control (home Wi‑Fi) or lock it to this machine (below). Do not expose it to the public internet without adding auth (out of scope). The Actions page can spawn whitelisted scripts on your machine.

By default the dashboard, OpenChamber, and OpenCode bind to all interfaces, so phones and other devices on your Wi‑Fi can use `http://<this machine’s LAN IP>:1337`. Use **Setup** (`/setup`) — checkbox _Allow access from other devices on my network_ — to toggle localhost-only vs LAN; it updates `DEVHUB_BIND_HOST` / `OPENCHAMBER_HOST` / `OPENCODE_BIND_HOST` in `dashboard/.env.local` (restart dev server after changing).

**WSL2:** LAN traffic hits **Windows** first. DevHub already binds `0.0.0.0` inside Linux; you still need Windows to accept and route it.

1. **Mirrored networking (recommended, Windows 11 22H2+):** Put this in `%USERPROFILE%\.wslconfig` (create the file if needed), then run `wsl --shutdown` and open your distro again:

```ini
[wsl2]
networkingMode=mirrored
```

Microsoft documents [Hyper-V firewall rules](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking) you may need once so inbound LAN connections reach WSL. Use your **Windows** Wi‑Fi/Ethernet IPv4 on other devices (not the old `172.x` WSL-only address).

2. **Default NAT mode:** From **elevated** Windows PowerShell, run the repo script (path via `\\wsl$\…` works from Windows):

```powershell
powershell.exe -ExecutionPolicy Bypass -File "\\wsl$\YOUR_DISTRO_NAME\home\YOU\dev\devhub\scripts\wsl\forward-devhub.ps1"
```

That sets `netsh` portproxy for ports **1337**, **1336**, and **1338** plus a firewall rule. Re-run after reboot if your phone can’t connect anymore.

`npm run dev` prints a WSL reminder when relevant.

Features:

- **Today page** — Tasks with Jira key detection + due dates, notes editor, calendar widget, ticket widget, daily activity digest; **Copy standup** (markdown for Slack: git **subjects** in `REPO_ROOT` over the same local window, **Jira** issues still assigned to you with any update in that window, **GitHub PRs you authored** that merged in that window via `gh pr list`, **GitHub PRs you reviewed** (merged, not your own) via `gh api search/issues`, tasks with **due date = today**); **GitHub PRs** (open + review queue via `gh pr status` across devhub and sibling clones with a `github.com` remote when the GitHub CLI is logged in)
- **Calendar** — Week view with Google Calendar integration (optional)
- **Tickets** — Jira Cloud tickets with status filters (optional)
- **Notes** — BlockNote editor, file tree, search overlay, folder-scoped **master checklists** (shared task blocks across notes), optional **in-editor AI** via z.ai (`/ai`, selection toolbar — see env vars below)
- **Chamber** — OpenChamber iframe integration (uses the shared OpenCode server on `1338`)
- **OpenCode** — OpenCode web UI iframe on port `1338`
- **Datadog** — `/datadog` hub + Today strip (deep links to monitors by `@oncall-dad` / `@slack-dad-team-alerts` and today’s event stream) when `DATADOG_API_KEY` is set in `/setup`
- **Status** — Git/repo health, services, MCP server processes, restarts; same **GitHub PRs** strip as Today
- **Skills** — Expandable skill cards with SKILL.md content
- **Actions** — Script runner with run history
- **Command palette (`Cmd+K`)** — Search across notes, tasks, tickets, navigation, **copy standup markdown**, and related actions in one box
- **Auto-refresh** — Calendar / Jira / repos revalidate on tab focus and every minute
- **Toast errors with retry** — Failed saves surface as actionable toasts (no more silent failures)
- **Undo on task delete** — 5s undo window on the toast before the delete is committed
- **Keyboard shortcuts** — Press `?` when the **DevHub** document has focus for the full list (g+h/n/s/a/r/k/c/j/l/d nav, Cmd+K palette, Cmd+Shift+O notes panel, Cmd+Shift+T tasks panel, etc.). The **Chamber** iframe does not receive those keys — use the **Shortcuts** button on the Chamber page or open OpenChamber in a new tab.
- **Atomic file writes** — In-process mutex + temp-and-rename, so concurrent task toggles never lose data and a crash mid-write can't corrupt your notes

A starter `dashboard/.env.example` is checked in — copy to `dashboard/.env.local` and fill in the optional integration vars. The dev server runs a startup health check (`predev`/`prestart`) that verifies env vars and paths and fails fast with a clear message if something's missing.

### Dashboard Setup & Env Vars

`dashboard`’s `postinstall` (or `install.sh`) creates `dashboard/.env.local` from `dashboard/.env.example` and fills in `NOTES_DIR` / `REPO_ROOT` automatically; if it is still missing, `predev` / `prestart` bootstraps a minimal file so the server can start. If the 1Password CLI is installed and signed in, startup also tries to load missing managed secrets from the `devhub` item before the app binds ports. Configure or verify optional integrations from [http://localhost:1337/setup](http://localhost:1337/setup). `npm run setup` prints a short reminder to use `/setup` in the browser. Variables you might want to know about:

**Core (auto-configured by `npm install` at the repo root or in `dashboard/` via `postinstall`, or by `install.sh`):**
| Var | Default | Description |
|-----|---------|-------------|
| `NOTES_DIR` | `~/dev/devhub/notes` | Notes storage path |
| `REPO_ROOT` | `~/dev/devhub` | Repository root |
| `PORT` | `1337` | Dashboard port |
| `DEVHUB_BIND_HOST` | `0.0.0.0` | Next.js listen address; use `127.0.0.1` for localhost only |
| `OPENCHAMBER_HOST` | `0.0.0.0` | OpenChamber bind address (keep in sync with `DEVHUB_BIND_HOST`) |
| `NEXT_PUBLIC_OPENCHAMBER_PORT` | `1336` | Port embedded in the Chamber iframe URL in the browser |
| `OPENCODE_PORT` | `1338` | `opencode serve` listen port (shared by Chamber and the `/opencode` page) |
| `OPENCODE_BIND_HOST` | `0.0.0.0` | `opencode serve --hostname` (legacy: `OPENCODE_HOST` when not a URL) |
| `NEXT_PUBLIC_OPENCODE_PORT` | `1338` | Port embedded in the OpenCode iframe URL in the browser |

**Google Calendar (optional):**
| Var | Required | How to Get |
|-----|----------|------------|
| `GOOGLE_CLIENT_ID` | Yes | [Google Cloud Console](https://console.cloud.google.com/) → OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Same as above |
| `GOOGLE_REFRESH_TOKEN` | Yes | Optional manual paste; otherwise use **Sign in with Google** on `/setup` (callback writes it) |

Calendar setup steps:

1. Go to https://console.cloud.google.com/
2. Create project or select existing
3. Enable "Google Calendar API"
4. Create OAuth 2.0 credentials (**Web application** so you can set a redirect URI, or otherwise allow the redirect you use below)
5. Under **Authorized redirect URIs**, add the exact URL you use to open DevHub, e.g. `http://localhost:1337/api/calendar/auth/callback` — if you use a LAN hostname or IP, add that variant too (`http://YOUR_LAN_HOST:1337/api/calendar/auth/callback`).
6. In [http://localhost:1337/setup](http://localhost:1337/setup) → Google Calendar: enter Client ID and Secret, click **Sign in with Google**. The callback writes `GOOGLE_REFRESH_TOKEN` (and the redirect URI used) into `dashboard/.env.local`; no copy/paste token step.
7. Restart only after changing repo paths / network bind (`npm run dev` / `npm run start` reload); integration keys written from `/setup` are picked up immediately in the running dashboard.

**Jira Cloud (optional):**
| Var | Required | How to Get |
|-----|----------|------------|
| `JIRA_DOMAIN` | Yes | Your Jira Cloud domain (e.g., `yourcompany.atlassian.net`) |
| `JIRA_EMAIL` | Yes | Your Jira email |
| `JIRA_API_TOKEN` | Yes | [Atlassian API Token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `NEXT_PUBLIC_JIRA_DOMAIN` | No | Same domain as `JIRA_DOMAIN`; used client-side for JIRA links in PR copy messages. Defaults to `example-org.atlassian.net`. |

**Datadog (optional):** `DATADOG_API_KEY` is saved from `/setup` (used by skills and to unlock the Datadog nav entry). Datadog’s **Events** REST API expects **both** an API key and an [application key](https://docs.datadoghq.com/account_management/api-app-keys/) — the API key alone is not enough for read/search endpoints we use for counts. Deep links default to US1 (`datadoghq.com`); override as needed:

| Var                           | Required                 | Description                                                                                                                                   |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATADOG_API_KEY`             | For Datadog UI in DevHub | From `/setup` — enables `/datadog` and the Today strip                                                                                        |
| `DATADOG_APPLICATION_KEY`     | For 24h alert counts     | Optional in `/setup` — Events v2 API (`events_read`). Same role as `DD_APPLICATION_KEY` or shell `DATADOG_APP_KEY` (DevHub checks all three). |
| `DD_SITE`                     | No                       | Datadog site (e.g. `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`) — drives the app hostname for links                                  |
| `DATADOG_APP_ORIGIN`          | No                       | Full origin override (e.g. `https://us3.datadoghq.com`) if link base should not be inferred from `DD_SITE`                                    |
| `DATADOG_LINK_ONCALL`         | No                       | Full URL override for the **@oncall-dad** monitor list                                                                                        |
| `DATADOG_LINK_TEAM_ALERTS`    | No                       | Full URL override for the **@slack-dad-team-alerts** monitor list                                                                             |
| `DATADOG_LINK_EVENTS_TODAY`   | No                       | Full URL override for “today’s events” (otherwise local midnight → now on `/event/stream`)                                                    |
| `DATADOG_EVENTS_QUERY_ALERTS` | No                       | Events search query for **all** monitor alerts in the last 24h (default `source:alert`)                                                       |
| `DATADOG_EVENTS_QUERY_ONCALL` | No                       | Events query for **@oncall-dad** slice (default `source:alert "@oncall-dad"`)                                                                 |
| `DATADOG_EVENTS_QUERY_TEAM`   | No                       | Events query for **@slack-dad-team-alerts** slice (default `source:alert "@slack-dad-team-alerts"`)                                           |

**Notes in-editor AI (optional):** not on `/setup` — add to `dashboard/.env.local` from `dashboard/.env.example`:

| Var             | Required | Description                                       |
| --------------- | -------- | ------------------------------------------------- |
| `Z_AI_API_KEY`  | Yes      | z.ai API key (Coding plan)                        |
| `Z_AI_BASE_URL` | No       | Defaults to `https://api.z.ai/api/coding/paas/v4` |
| `Z_AI_MODEL`    | No       | Defaults to `glm-5-turbo`                         |

Restart the dev server after setting these. See [docs/reference/environment-variables.md](docs/reference/environment-variables.md#notes-in-editor-ai-optional).

### Keyboard Shortcuts

Press `?` when DevHub (not the Chamber iframe) has focus to see all shortcuts:

| Shortcut      | Action                  |
| ------------- | ----------------------- |
| `g + h`       | Go to Today             |
| `g + n`       | Go to Notes             |
| `g + s`       | Go to Status            |
| `g + a`       | Go to Actions           |
| `g + r`       | Go to Repos             |
| `g + k`       | Go to Skills            |
| `g + c`       | Go to Chamber           |
| `g + l`       | Go to Calendar          |
| `g + j`       | Go to Tickets           |
| `g + d`       | Go to Datadog           |
| `Cmd+K`       | Toggle command palette  |
| `Cmd+Shift+O` | Toggle notes side panel |
| `Cmd+Shift+T` | Toggle tasks side panel |
| `Cmd+\`       | Toggle sidebar          |
| `Esc`         | Close panel/modal       |

On viewports where the slim mobile header is shown, it includes **notes** and **tasks** buttons (same panels as the shortcuts above). On wider screens, use the shortcuts or open **Notes** from the sidebar.

## What This Repo Does

This repo solves three problems that come up when using multiple AI coding tools across multiple machines:

1. **Consistent persona** — Your AI coding assistant should behave the same way whether you're using Claude Code, Codex CLI, OpenCode, or Cursor. This repo maintains a layered persona system that syncs across all tools and machines.

2. **Shared skills** — Instead of configuring skills separately for each tool, define them once in `skills/shared/` and sync them everywhere. When you create a new skill locally, it can be collected back into the repo.

3. **Persistent memory** — A git-based notes system captures what you learn across sessions and surfaces relevant context at the start of new sessions. No external database dependencies, no lossy compression, 100% retrieval accuracy.

## Persona System

The persona is split into three layers to minimize token usage:

| Layer | File                                                 | Tokens | When Loaded                          |
| ----- | ---------------------------------------------------- | ------ | ------------------------------------ |
| L0    | `persona/identity.txt`                               | ~200   | Every message                        |
| L1    | `persona/shared-persona.md`                          | ~800   | Every session                        |
| L2    | `persona/deep-preferences.md` + `persona/modes/*.md` | ~500   | On demand (`deep-preferences` skill) |

**Why split?** L0 loads on every single message, so it needs to be lean. L1 loads once per session and contains core engineering standards. L2 only loads when the session involves teaching, code review, debugging, or other specific contexts — saving ~500 tokens on every session that doesn't need it.

Persona is delivered to AI tools via two mechanisms:

1. **AGENTS.md** (primary) — Placed at repo root, read automatically by Claude Code, Codex CLI, OpenCode, and Cursor. This is the universal standard.
2. **HTML comment injection** (fallback) — `syncPersona()` injects L0/L1 into tool configs (CLAUDE.md, .cursorrules, etc.) and writes always-on Cursor rules under `~/.cursor/rules/devhub-persona-*.mdc`.

### Customizing Your Persona

Edit the files in `persona/` directly. After editing, use **Skills → Persona & Agent configs → Sync persona** in the dashboard (or **Actions → Sync Persona**).

The `optimize` skill can also propose persona changes based on patterns in your session notes (see Self-Learning Loop below).

## Notes System (Persistent Memory)

A two-tier notes system captures knowledge across sessions without external dependencies.

### How It Works

Nothing here runs on a timer by itself — **you (or the AI using skills) invoke the steps.**

```
After significant work (manual)
    ↓
session-notes skill → notes/sessions/YYYY-MM-DD-HHMM.md
    ↓
When you choose to run it: learnings / optimize skills → notes/learnings/{topic}.md
    ↓
notes/index.md updated (manually or via skill guidance)
    ↓
Next session: AI reads index.md → loads relevant learnings on demand
```

**Tier 1 — Session Notes** (`notes/sessions/`): Raw captures written after significant work (via the `session-notes` skill when you run it). These are not meant to be fully loaded into context (too verbose).

**Tier 2 — Distilled Learnings** (`notes/learnings/`): Reusable insights, organized by topic. Populated when you run `learnings` / `optimize` (or edit by hand).

**Index** (`notes/index.md`): A ~200 token topic map that the AI reads at session start. This is the only always-loaded component of the notes system.

### Session Note Format

Notes are captured using the `session-notes` skill after significant work. Each note includes:

- Frontmatter (date, tools, models, projects, tags, rating)
- What was asked, what happened, key outputs
- What worked, what didn't work, corrections made
- Raw learnings for later distillation

### Pruning

When learnings files exceed ~200 lines, older entries are archived to `notes/learnings/archive/YYYY-QN.md`. Session notes older than 90 days are moved to `notes/sessions/archive/`. This keeps the active files scannable and under token budget.

### Cross-Machine Sync

Notes are plain markdown files in the git repo. They sync across machines via `git push` and `git pull` — same as everything else.

## Skills

Shared skills live in `skills/shared/`. Each skill has a `SKILL.md` describing when and how to use it. Skills are synced from the repo to your local tool directories by **TypeScript** (`dashboard/lib/sync-skills.ts`), triggered from the **Skills** or **Actions** UI.

### Built-in Skills

| Skill             | Purpose                                                    | When to Use                                           |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| **ai-sync**       | Sync repo skills and persona to local tools                | After pulling changes, on new machine setup           |
| **session-notes** | Capture structured notes after significant work            | After completing non-trivial tasks                    |
| **learnings**     | Reference distilled knowledge from past sessions           | At session start, when encountering familiar problems |
| **optimize**      | Self-learning loop: review notes, propose improvements     | Weekly, or when you feel prompts aren't improving     |
| **rubber-duck**   | Independent second-opinion review of the current direction | Before major decisions, when something feels off      |
| **update-check**  | Check for repo updates and sync                            | At session start (optional, lightweight)              |

### Reverse Skill Sync

If you create new skills locally (e.g., `~/.claude/skills/my-new-skill/`), use **Actions → Collect Skills** in the dashboard. Optional comma-separated **Exclude** names apply to both Collect and Sync (see Actions page). This copies new skills into `skills/shared/` and stages them with git.

### Creating Custom Skills

In the app: **Skills → New skill** (creates `skills/shared/<id>/SKILL.md`). Or add a directory by hand:

1. Create `skills/shared/your-skill/`
2. Add `SKILL.md` with `# Skill: your-skill` and When to Use / How to Use sections
3. Run **Sync skills** from the Skills page when you want tool copies updated

For AI-assisted creation of shared DevHub assets, use the `devhub-create-shared-x` skill. It covers shared skills, persona guidance, agents, and MCP server configs.

## Plugins

Skills, agents, and MCP configs can also come from **plugins** — separate repos (often private, e.g. `devhub-bi`) that contribute assets without living in the core repo. They merge at sync time with **core winning on name collisions**, and plugin assets are read-only inside DevHub (edit them in the plugin repo).

Register a plugin in a machine-local file (never committed):

```jsonc
// ~/.config/devhub/plugins.json
{ "plugins": [ { "name": "bi", "path": "~/Developer/devhub-bi", "enabled": true } ] }
```

Each plugin repo has a `devhub-plugin.json` manifest declaring what it contributes. To build one, follow [docs/guides/creating-plugins.md](docs/guides/creating-plugins.md); for the design, see [docs/architecture/plugins.md](docs/architecture/plugins.md). This generalises the older single `ai-tools` skill merge.

### Fork workflow

If you run DevHub as a private mirror of a shared core, `scripts/devhub-update.sh` pulls core updates from your `upstream` remote and re-syncs, and `scripts/devhub-backport.sh` builds a clean PR back to core (personal data excluded). See [CONTRIBUTING.md](CONTRIBUTING.md).

## MCP Servers

MCP (Model Context Protocol) servers extend tool capabilities. This repo configures a notes MCP server for all supported tools.

### Notes MCP Server

A lightweight Node.js server provides both a web UI and MCP integration for your notes. No Docker, no database — just plain markdown files.

```bash
# Start the web UI (port 1337)
NOTES_DIR=~/devhub/notes node mcp-servers/notes-server/src/server.js

# MCP configs are installed by install.sh (bootstrap) or from Actions when you re-run setup flows
# It provides: notes_list, notes_read, notes_write, notes_append, notes_search, notes_delete
```

MCP configs are installed to your tool directories by `install.sh` with the correct paths. The MCP server uses `REPO_ROOT/mcp-servers/notes-server/src/mcp.js` and points at `REPO_ROOT/notes`.

### Web UI

When the notes server is running, open `http://localhost:1337` to:

- Browse and search all notes
- Create and edit notes with a markdown editor
- Dark mode support

## Self-Learning Loop (Optimize Skill)

The `optimize` skill is the automation layer on top of the notes system. It reviews accumulated sessions and proposes improvements to your persona, skills, and workflow.

### How It Works

1. **Gather** — Reads all session notes since the last optimize run
2. **Identify patterns** — Finds recurring corrections, friction points, successful patterns, missing context, and token waste
3. **Propose changes** — Presents a structured report with specific, actionable changes
4. **Apply or confirm** — Either suggests changes for approval or applies non-destructive changes directly
5. **Track** — Logs when it last ran so it only reviews new sessions

### Example Output

```markdown
## Optimize Report — 2026-05-07

### Sessions Reviewed: 8

### Patterns Found: 3

#### Persona Changes

- [ ] shared-persona.md: Add "prefer early returns" rule (seen in 5 sessions)

#### Skill Changes

- [ ] session-notes/SKILL.md: Add "token_cost" field (consistently missing)

#### Learnings Actions

- [ ] Distill 3 session notes → notes/learnings/tools.md
- [ ] Archive 12 old entries from notes/learnings/engineering.md
```

### Running It

```
"Run the optimize skill — review recent sessions and suggest improvements."
```

Or for automatic application of non-destructive changes:

```
"Run optimize and apply changes."
```

The optimize skill never modifies session notes (they're immutable records) and never deletes persona content without explicit approval. After persona changes, sync from **Skills** or **Actions** so tools pick up `AGENTS.md` / injected configs.

## Sync Strategy

### Conflict Prevention

**Update & Sync** (Actions) runs TypeScript (`dashboard/lib/sync-orchestrator.ts`): clean tree required for pull/collect/push; branch must be `main` or `master`; if you are **ahead and behind** remote, it stops until you rebase/merge. Advanced: skip the remote staleness guard from CLI with `cd dashboard && npx tsx scripts/run-action.ts update_and_sync --push --force` (not exposed in the UI).

See **Status → Repo** for live **dirty / ahead / behind** counts and suggested `git` commands when something blocks sync.

### Typical Sync Flow

- Use **Actions → Update & Sync** for pull + sync + optional commit/push.
- Use **Actions → Validate** or **`npm run verify`** in `dashboard/` for lint/typecheck/tests.

### Periodic Auto-Sync

The dashboard has an **in-process scheduler** (while the Next.js server is running) with cron-style jobs. Configure it from **Actions → Scheduled Jobs**. There is no separate host cron requirement.

CLI equivalent when you need it:

```bash
cd dashboard && npx tsx scripts/run-action.ts update_and_sync --push
```

## Validation

Repo integrity checks run in TypeScript (`dashboard/lib/validate.ts`). Run them from **Actions → Validate** in the app, or:

```bash
cd dashboard && npx tsx scripts/run-action.ts validate
```

## Platform Support

See [`docs/PLATFORM_REQUIREMENTS.md`](docs/PLATFORM_REQUIREMENTS.md) for the full matrix. Short version: **Node 20+** and **Git** on macOS or WSL; dashboard + sync actions are TypeScript; iOS is read-only for repo files.

## Migration from Older Versions

If you're upgrading from an earlier version of devhub:

```bash
# Extract v3 zip somewhere temporary
cd /tmp
unzip ~/Downloads/devhub-v3.zip -d devhub-v3

# Run migration from your existing repo
cd ~/devhub
bash /tmp/devhub-v3/scripts/migrate.sh
```

The migration script handles: removing old MemPalace scripts and references, updating MCP configs to the notes server, copying in new files (notes system, optimize skill, etc.), updating the persona split, preserving your existing notes, fixing permissions, cleaning stale cron entries, and running validation.

See `docs/MIGRATION.md` for the full step-by-step guide.

## Workflow Summary

1. **Session start**: AI reads `AGENTS.md` → loads L0 persona → checks `notes/index.md` for relevant context
2. **During work**: AI uses shared skills and follows persona standards
3. **End of task**: Ask AI to run `session-notes` skill to capture what happened
4. **Weekly**: Ask AI to run `optimize` skill to review patterns and propose improvements
5. **Periodic**: Optional **Scheduled Jobs** in the dashboard (in-process scheduler) can run Update & Sync / Validate while DevHub is running

## Documentation

| Document                        | Purpose                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `docs/MEMORY_OPTIONS.md`        | Memory architecture: git-based notes + custom notes MCP server |
| `docs/MIGRATION.md`             | Step-by-step migration guide from older versions               |
| `docs/PLATFORM_REQUIREMENTS.md` | Platform capability matrix                                     |
| `docs/TOKEN_BUDGET.md`          | Token budget analysis and optimization tips                    |
| `docs/guides/creating-plugins.md` | Step-by-step guide to building a plugin                      |
| `docs/architecture/plugins.md`  | Plugin system: manifest, registry, tier-1/tier-2, precedence   |
| `CONTRIBUTING.md`               | Private-mirror + upstream + backport fork workflow             |

## Troubleshooting

**"Working tree is dirty" / diverged branch / blocked sync:** open **Status** — the Repo card lists dirty file count, ahead/behind, and suggested `git` commands. Fix in a terminal, then run **Actions → Update & Sync** again.

**MCP configs wrong or stale:** run `bash scripts/install.sh` from the repo root (rewrites MCP JSON with correct `REPO_ROOT` paths) or re-trigger bootstrap steps from the dashboard after changing paths in `/setup`.

**Skills not appearing in an AI tool:** **Skills → Sync skills** (optionally exclude specific skills). Streamed log shows each target directory.

**Persona not updating:** **Skills → Persona & Agent configs → Sync persona** (or **Actions → Sync Persona**).

**Validation / CI-style checks:** **Actions → Validate**, or `cd dashboard && npx tsx scripts/run-action.ts validate`.
