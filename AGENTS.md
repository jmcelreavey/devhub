<!-- ai-dotfiles:identity:start -->
Cursor: L0 is always-on via `~/.cursor/rules/devhub-persona-identity.mdc`. Cloud: read `persona/identity.txt` before the first substantial reply.
<!-- ai-dotfiles:identity:end -->

<!-- ai-dotfiles:shared-persona:start -->
Cursor: L1 is always-on via `~/.cursor/rules/devhub-persona-shared.mdc`. Cloud: read `persona/shared-persona.md` before the first substantial reply.
<!-- ai-dotfiles:shared-persona:end -->

## Cursor Cloud specific instructions

### Persona (Cloud)

This file does **not** inline L0/L1 — Cursor already has them via `~/.cursor/rules/devhub-persona-*.mdc`. If those rules are missing from the system prompt, read `persona/identity.txt` then `persona/shared-persona.md` before the first substantial reply. Paths are repo-root `persona/` only — never `notes/persona/`.

### Public core and private mirrors

- The **public core** ships generic code and empty personal-data paths (`.gitkeep`/`EXAMPLE`). Never publish notes, tasks, identity, voice samples or local credentials there. See `CONTRIBUTING.md` → "Personal-data boundary" for the exact path list.
- A **private mirror** keeps personal data alongside the code. Committing that data to the private remote is expected. Check the remotes before choosing where to publish.
- Running the app writes local data (e.g. `tasks/YYYY-MM-DD.json`). Keep it in your private mirror and move generic changes as content patches when the histories differ.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Core + Vite dashboard | `npm run dev` (repo root) | 1437 checkout; 1337 shell-supervised | File-based storage; SQLite holds agent runs. Packaged DevHub.app also uses 1337; existing `PORT` overrides take precedence. |
| Agents (Paseo) | Separate launchd/systemd user daemon (`npm run agents:install`) | 6767 | Backs `/agents`; managed separately, with setup/restart controls in Agents → Connection |
| Terminal peer | Started by `npm run dev` | 1439 checkout; 1339 shell-supervised | Docked PTY; localhost only. Existing `TERMINAL_PORT` overrides take precedence. |

### Running the app

- `npm run dev` from the repo root starts the dashboard (and attempts companions). The `predev` health check auto-creates `apps/ui/.env.local` if missing.
- Core paths (`NOTES_DIR`, `REPO_ROOT`) are auto-configured by `postinstall`; `PORT` can override the checkout default.
- Optional integrations (Google Calendar, Jira, Datadog) are configured via the `/setup` page; they are not required for the app to function.
- Optional **notes in-editor AI** uses `AI_API_KEY` (any OpenAI-compatible provider; `AI_BASE_URL`/`AI_MODEL` default to z.ai) in `apps/ui/.env.local` (see `apps/ui/.env.example`); not configured via `/setup`.
- Without Paseo, Agents shows a connection error and the rest of the dashboard still works. OpenCode is only lazy-started (ephemeral port) for session recap.

### Lint / Typecheck / Test

- **Tests are deliberately few.** Read `docs/contributing/testing.md` before adding one: only data loss, security boundaries, awkward parsers and shipped regressions get tests. No component render, copy or CSS tests. Delete a test that pins implementation detail rather than updating it.

All from the repo root:
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript (`tsc --noEmit`)
- `npm run test` — Vitest (dashboard unit tests)
- `npm run verify` — runs tests; CI separately runs lint, typecheck and the production build

### UI / UX Review

- For any UI change, be critical of the experience as well as correctness: check visual hierarchy, spacing, copy, empty/loading/error states, affordances, and awkward user flows.
- Use screenshots or recordings to review the rendered result, and call out visible UX issues even when the feature technically works.

### Loading & motion vocabulary

- **Shimmer for content arriving, spin only for an action the user just triggered.** Data panels and route loads use skeletons (`SkeletonRows`, `PageSkeleton` via `loading.tsx`) shaped like the content they become; `animate-spin` is reserved for refresh/submit buttons the user clicked.
- Motion is information — healthy systems hold still. 150–350ms, easing `cubic-bezier(.22,1,.36,1)`, transform/opacity only, no infinite loops on healthy state. Respect `prefers-reduced-motion` and the `body[data-motion="off"]` kill-switch (⌘P → "Toggle animations"). See `docs/contributing/motion.md`.

### Plugin Architecture — CRITICAL FOR EDITING

Private modules live in separate plugin repos. Runtime plugins are loaded from the
reviewed plugin registry; dev, build and start do not materialise dashboard files.
Edit plugin source in its own repo. Before editing `apps/ui/`, check that the file
is tracked and is not a plugin overlay. See `docs/architecture/plugins.md`.

### Gotchas

- **Dashboard hanging or a page never loading?** One blocked subprocess blocks
  every route, so "the app is dead" and "one git call is stuck" look identical.
  Call `status_exec` (or `GET /api/status/exec`) first — it names the command.
  Full ladder: the `devhub-debug-hang` skill.
- **Writing dashboard UI?** Read `docs/reference/ui-vocabulary.md` first — the
  components, CSS primitives and hooks that already exist. Cheaper than
  rediscovering them, and stops a second near-identical warning style existing.
- **Running an external command?** Use `execExternal` (`lib/exec-external.ts`),
  never `execFile`/`spawn` directly. It enforces a timeout; raw subprocess calls can
  otherwise hang indefinitely.
- **Safe-Chain is required** by `scripts/install.sh` and plugins that declare it. The dashboard preinstall checks plugin requirements; a core-only `npm install` doesn't require it. Install globally: `npm install -g @aikidosec/safe-chain@1.1.10`, run `safe-chain setup`, restart the terminal. See README.md.
- **Cloud VMs without sudo:** install Safe-Chain to a user prefix and put it on `PATH` before `npm install`: `npm install -g @aikidosec/safe-chain@1.1.10 --prefix "$HOME/.npm-global"` then `export PATH="$HOME/.npm-global/bin:$PATH"`. The VM update script does this automatically.
- **Tasks vs notes paths:** daily tasks live under repo-root `tasks/YYYY-MM-DD.json` (not under `notes/`). Notes vault files are under `notes/`.
- The 1Password CLI integration (`op`) is optional and logs warnings if absent — not a real error.
- Git hooks are in `.githooks/` (configured via `core.hooksPath`); `pre-push` runs `npm run prepush` checks.
- **`npm run dev` supervises core, Vite and the terminal.** The checkout uses ports 1437, 1439 and 1440; scheduled jobs are opt-in.
- **Protect the packaged app's port.** When DevHub.app holds 1337 (`cwd` under `/Applications/DevHub.app/Contents/Resources/server`), checkout edits are invisible there. Verify UI on a free checkout port (see `devhub-dashboard-verify`). Do not stop the packaged app unless asked.
