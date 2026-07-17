---
name: devhub-repo-upstart
description: Use when DevHub asks an agent to create, run, debug, or update a DevHub-private upstart script (`upstarts/<repo>/upstart.sh`) from the Repos page Upstart button.
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
- Assume the script runs with **cwd = the target repo root** (DevHub sets this).
  Prefer relative paths into the project; do not hardcode the machine's clone path.
- If `.nvmrc` exists, prefer loading `nvm` and running `nvm use` before any
  npm/node command.
- For Node projects, run the install step every time (`npm install`, or the
  repo's documented package manager equivalent) so dependencies do not silently
  go stale.
- Start the dev environment from the script. Do not end with instructions like
  `Run: npm run dev`; run it.
- Keep machine-specific paths and secrets out of the script.
- Do not install new dependencies unless the repo already documents that path.
- If a required dependency is missing, print the command the user should run.
- If the app needs environment variables, point to the repo's example or docs
  instead of guessing values.
- Keep the script readable; future agents and humans will edit it under pressure.

## Debugging

- Ask what failed before rewriting the startup flow.
- Preserve the one-command contract unless the repo truly cannot support it.
- Treat scripts that only print startup instructions as broken; update them to
  perform the startup.
- Add concise comments only where the reason is not obvious.

## Verification

- Run or dry-check `bash <devhub-upstart-path>` from the **target repo root**
  when it will not trap the agent in a long-running foreground server.
- If you cannot fully start the project, leave the script printing clear next
  steps and explain the blocker.
