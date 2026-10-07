---
name: devhub-repo-upstart
description: Create, run, debug, or update a DevHub-private repository upstart script. Use when the user wants a one-command way to start a repo locally, or an upstart script under upstarts/ fails.
metadata:
  short-description: Create or debug repo startup scripts
---

# DevHub Repo Upstart

## Overview

Create or maintain one startup entrypoint in the **DevHub private mirror**, not in
the target project:

`upstarts/<repo-name>/upstart.sh`

(absolute path is usually `$REPO_ROOT/upstarts/<repo-name>/upstart.sh`, and DevHub
passes the concrete path in the launch prompt).

The script should let DevHub start the project next time without asking an
agent to rediscover the repo. Upstart means the dev environment actually ends
up running locally, not a motivational poster telling the user what command to
type next.

**Do not write `.devhub/upstart.sh` (or any upstart) into the target repo.** That
old location is legacy; if you find one, prefer copying/updating the DevHub
store path instead.

## When To Use

- DevHub launches you from a repo card Upstart button.
- DevHub includes user-provided startup context from the Upstart context menu.
- The user asks to create or fix a repo upstart / startup script via DevHub.
- The user reports that a repo startup script failed or started the wrong thing.

## Workflow

1. Inspect existing startup clues in the **target repo cwd**: `README*`,
   `package.json`, `Makefile`, compose files, Procfiles, `.env.example`, and
   repo docs.
2. Treat user-provided startup context as a strong hint, but verify it against
   the repo before baking it into the script.
3. If the DevHub path from the prompt already exists, read it before changing
   anything. If only a legacy `.devhub/upstart.sh` exists in the target repo,
   use it as a starting point and write the result to the DevHub path.
4. Create or update `upstarts/<repo-name>/upstart.sh` (create parent dirs as
   needed) with the smallest reliable startup command that starts the dev
   environment itself.
5. Make the script idempotent: create needed dirs, avoid duplicate long-running
   processes when practical, and print clear missing-secret/manual-service
   messages only when automation is genuinely blocked.
6. Prefer existing documented commands over inventing new orchestration.
7. Validate the script far enough to catch obvious failures. If DevHub launched
   you from the Upstart button, do not leave a long-running server inside your
   own tool call; the surrounding terminal command may run the script after you
   exit (with cwd = the target repo).

## Script Rules

- Use `#!/usr/bin/env bash` and `set -euo pipefail`.
- **Run from the selected checkout's repository root by default.** DevHub launch
  commands must explicitly change to that checkout before invoking the script.
  Scripts must also resolve `git rev-parse --show-toplevel` from the caller's
  cwd and `cd -- "$upstart_root"` before any project operation; fail clearly
  outside a Git working tree. This supports manual invocation from a subdirectory.
  Never use the stored script's directory, an inherited `REPO_ROOT`, or a
  hardcoded clone/worktree path as the project root. A linked worktree's `.git`
  is a file, so do not require it to be a directory.
- **Bootstrap a missing worktree `.env` from the main checkout first.** Use the
  first `worktree` record from `git worktree list --porcelain -z` (Bash
  `IFS= read -r -d ''`) to locate the main checkout, including paths with spaces.
  Never guess it from `.git` or worktree directory names. If the selected
  checkout differs and its `.env` is absent, copy the main checkout's `.env`
  with a restrictive umask and no overwrite (`umask 077; cp -n`). Preserve
  existing files and symlinks; report unreadable or dangling ones rather than
  replacing them. Only fall back to `.env.example` when no main-checkout
  `.env` is available. Never print or source secret values. Perform copying
  before dependency installation/config validation, then reconcile missing
  example keys using the rules below. All subsequent work stays in the selected
  checkout; only the initial configuration is copied from the main checkout.
- **Native app readiness is checkout-specific.** For projects requiring a development
  client, do not default a fresh worktree to Metro/Expo Go merely because its
  ignored native directories are absent. Generate and build the selected branch.
  If reusing a simulator build, check both the branch's native-input fingerprint
  and the identity of the installed binary: another worktree may have replaced
  the same bundle. A working Metro endpoint does not verify a native app launch.
- **Match the running app, not just the installed app.** After bundle-id or variant
  changes, old and new development clients can share a URL scheme. Inspect the
  running simulator process and both installed Info.plist files before assuming
  missing native modules mean a failed build. For iOS, use the current bundle-id
  scheme registered by Expo prebuild for both `expo start --dev-client --scheme`
  and the development-client URL opened after Metro is ready. Do not rely on
  the shared project scheme or bare `simctl launch` restoring the right server.
  Keep Expo Go explicit (`--go`), and do not uninstall old apps to fix routing.
- **Diagnose dependency failures before deleting build state.** A CocoaPods
  deployment-target message can mask missing CDN specs. Check the actual pinned
  podspec and generated target, refresh specs, and preserve the native tree on
  failure. For a reproduced CDN HTTP/2 failure, a process-scoped HTTP/1.1 retry
  may be used with normal TLS verification; never patch installed gems or
  recommend blanket native-directory deletion for network errors.
- If `.nvmrc` exists, prefer loading `nvm` and running `nvm use` before any
  npm/node command.
- For Node projects, run the install step every time (`npm install`, or the
  repo's documented package manager equivalent) so dependencies do not silently
  go stale.
- DevHub desktop (and some parent shells) inject env into the child process —
  notably `NODE_ENV=production` and `PORT=1337` (DevHub's own listen port). Bare
  `npm install` under `NODE_ENV=production` **omits/removes devDependencies**, so
  local CLIs like `nest` / `jest` vanish and start scripts fail with
  `command not found`. Inherited `PORT` makes anything that does
  `process.env.PORT || <default>` bind to 1337 and collide with DevHub. Before
  install/start: `unset NODE_ENV` and `unset PORT` (or set the project's real
  port; install with `--include=dev` if needed).
- **Inherited-but-empty vars beat `.env`.** `dotenv` (and most equivalents) never
  overwrite a key already present in the environment, and an *empty* value still
  counts as present. zsh exports `ENV` (the POSIX startup-file path) as an empty
  string, so an app reading `process.env.ENV` gets `''` and dies on startup even
  though `.env` sets a real value. Symptom: "environment variable X is missing"
  for a key you can see in `.env`. Before starting, clear every var that is set
  but empty and also defined in `.env`:

  ```bash
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]] || continue
    key="${BASH_REMATCH[1]}"
    [[ -n "${!key+set}" && -z "${!key}" ]] && unset "$key"
  done <.env
  ```
- **Reconcile `.env` against `.env.example` on every run, do not just create it
  when absent.** A checkout that has run for months has a stale `.env`; when the
  repo adds a key, apps that validate all env up front (NestJS config factories,
  zod/Joi schemas) crash on boot — and only report the *first* missing key, so
  the user fixes one and hits the next. Append the example's line verbatim for
  any key `.env` lacks, never overwrite an existing value, and print what was
  added so the user knows those are placeholders. Warn (do not guess) for keys
  present but empty.
- After `npm install`, verify CLIs used by start scripts exist under
  `node_modules/.bin` (nest, next, vite, etc.). Fail fast with a clear message
  if missing — do not assume `npm run` will magically find them.
- Prefer `npm run <script>` / `npx` (local bins). If a script calls a bare
  binary and install is flaky, use `npx <cli>` or ensure the package is a real
  dependency. Watch `allow-scripts` / safe-chain warnings; they can leave
  packages present but tools half-broken.
- Start the dev environment from the script. Do not end with instructions like
  `Run: npm run dev`; run it.
- Keep machine-specific paths and secrets out of the script.
- Do not install new dependencies unless the repo already documents that path.
- If a required dependency is missing, print the command the user should run.
- If the app needs environment variables, point to the repo's example or docs
  instead of guessing values.
- Keep the script readable; future agents and humans will edit it under pressure.

- **Smoke-test before handoff:** after install (+ bin checks), run the start
  command far enough to catch `command not found` / immediate crashes, then
  kill the process — do not leave servers hanging in the agent session. A bin
  check alone is not enough if the start script shells out to another tool.

## Running It (DevHub Terminal Dock)

The finished script is **started through the DevHub terminal dock**, never with a
backgrounded `&` / `nohup` in the agent's own shell. Use
`terminal_propose_run` (DevHub MCP) with `kind: "upstart"` — or `"devserver"`
for a bare `npm run dev`-style start.

The dock is where the user can see the run, keep it, and kill it. A server
backgrounded inside an agent tool call is invisible to DevHub: it does not
appear in the dock, its output only exists in whatever scratch log the agent
chose, and when the agent session ends it survives as an orphan holding its port
with nobody tracking it. That is the failure this section exists to prevent.

- **Ordinary commands launch automatically; no extra approval is needed.**
  Destructive commands retain dock confirmation. Poll `terminal_proposal_status`
  with the returned id and act on what it says — `pending` / `approved` /
  `injected` / `denied` / `expired` / `failed`. Queued does not mean running;
  verify injection and inspect startup output before reporting success.
- **Give it a real `label`.** Every approved proposal opens its own tab, and the
  label is the only thing distinguishing this run from the other five. Name the
  repo and what is starting (`api · dev server`), not `bash`.
- **Check `terminal_list` first.** Dock tabs outlive the agent session, so the
  service may already be running from an earlier one. Reuse or tell the user
  it is up; do not propose a second start that races the first for the port.
- **Read output with `terminal_tail`**, using the session id from
  `terminal_list`, rather than teeing the command into a log file of your own.
- **Killing it is the user's call.** The tab is theirs; say the run is in the
  dock and leave it. Only tear down processes you started in your own shell.
- Requires the dashboard running. If `terminal_propose_run` is unavailable, say
  the dock could not be reached and hand the user the command — do not silently
  fall back to backgrounding it yourself.

Short-lived, non-interactive checks — `npm install`, `--version`, binary
resolution under `node_modules/.bin`, a boot that you start and kill within the
call — stay in the agent shell. The dock is for what the user needs to watch,
keep, or stop.

## Debugging

- Ask what failed before rewriting the startup flow.
- Preserve the one-command contract unless the repo truly cannot support it.
- Treat scripts that only print startup instructions as broken; update them to
  perform the startup.
- Add concise comments only where the reason is not obvious.

## Verification

- Exercise the same stored script from the main checkout and a linked worktree,
  including a subdirectory and a path containing spaces. Confirm it uses that
  checkout's root, copies a missing worktree `.env` from the main checkout,
  preserves an existing `.env` byte-for-byte, falls back to the example when
  needed, and fails before startup outside a Git working tree. Use temporary
  fixtures for missing-file cases; never remove a real checkout's `.env`.

- From the **target repo root**, run install (with `NODE_ENV` unset / `--include=dev`
  as above), confirm start-script CLIs exist under `node_modules/.bin`, then
  briefly start the app (or the same `npm run …` the upstart uses) until it is
  past binary resolution **and past env/config validation** — then kill it.
  "Compiled 0 errors" is not a passing boot; wait for the app's own ready line.
  Do not hand off an upstart that only “looks right” on paper.
  For native apps, confirm the selected bundle actually loads the JavaScript
  without missing-native-module errors; test alongside an older installed
  variant when launch schemes can collide. Misleading route/default-export
  errors may be secondary to a native module import failure.
- Smoke-test by running **the upstart script itself**, not the commands inside
  it, and from a shell with the same inherited env DevHub uses. Running
  `npm run dev` by hand in a clean shell hides exactly the `NODE_ENV` / `PORT` /
  empty-`ENV` collisions the script exists to neutralise.
- If a full start will trap the agent, smoke-test the start command in the
  background and kill after the first healthy log line or a short timeout; still
  treat immediate `command not found` as a failed verification. That
  background-and-kill is a *check*, not the handoff — the run the user keeps goes
  to the terminal dock (see Running It), so never leave the smoke-test alive and
  call it started.
- If you cannot start the project, leave the script printing clear next steps
  and explain the blocker.
