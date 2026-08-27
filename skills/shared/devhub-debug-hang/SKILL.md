---
name: devhub-debug-hang
description: "Diagnose a DevHub dashboard that is hanging, slow, or unresponsive — pages that never load, requests that never return, a wedged server, or a route that got slow. Start with status_exec to find the blocking external command, then the ladder below. Keywords: dashboard hangs, page never loads, server wedged, unresponsive, HTTP 000, slow route, stuck request, git hangs, gh hangs, spinner forever."
---

# Debugging a hanging or slow DevHub

The dashboard is a single Node process. **One blocked external command blocks
everything** — every route, including the pages you would use to investigate. So
"the whole app is dead" and "one `git` call is stuck" look identical from
outside, and the fix is to find the stuck call, not to restart blindly.

Work down this ladder. Stop when you have the answer.

## 1. Ask the app what it is running

```
status_exec        # MCP tool — in-flight external commands + slowest recent
```

Or directly:

```bash
curl -s --max-time 5 http://127.0.0.1:<port>/api/status/exec
```

A call with a large `runningMs`, especially `overdue: true`, is your culprit —
it names the command and the repo it is running in. Common shapes:

- `gh:search`/`gh:api` running for minutes → GitHub degraded; `gh` hangs rather
  than failing.
- `git:status`/`git:commit` stuck → a held `.git/index.lock`, or a hook waiting
  on stdin.
- Many entries at once → not a hang, a stampede. See step 4.

**If `/api/status/exec` itself does not answer, the event loop is already
blocked.** That is the diagnosis: skip to step 2.

## 2. Confirm from outside when the app cannot answer

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:<port>/
lsof -nP -iTCP:<port> -sTCP:LISTEN            # is it even listening?
ps -eo pid,ppid,etime,stat,command | awk '$2==<server-pid>'
```

The signature of a wedge, and it is unambiguous:

- every route returns `000` (no response, not an error page), **and**
- the process is `S` (sleeping) with near-zero CPU — blocked, not spinning, **and**
- it has a long-lived child, often with grandchildren of its own.

Low CPU matters. A busy loop looks completely different and is a different bug.

## 3. Read the child process

The stuck child names the cause. Two that have actually happened here:

- **A shell probe sourcing an interactive rc.** `zsh -lic` sources `~/.zshrc`;
  anything blocking in there (a 1Password helper calling `op whoami` against a
  locked vault) blocks the probe. Note that `spawnSync`'s `timeout` does **not**
  save you: it kills the shell, but a grandchild that inherited the stdout pipe
  keeps it open and `spawnSync` waits on the pipe. Use a non-interactive shell.
- **A network CLI with no ceiling.** Anything not going through
  `execExternal` can still wait forever.

## 4. Slow rather than stuck

`status_exec`'s `slowest` list is recent calls over ~1s. If the same command
appears repeatedly, you have a repetition problem, not a latency one:

- Workspace tabs keep every visited route mounted. `useLive` pauses polling in
  hidden panels (`PanelVisibilityContext`) — if a new fetch bypasses `useLive`,
  it will poll from every background tab forever.
- Check for one-request-per-row patterns. Existence checks belong in the list
  payload or a shared index, never a request per row.

## 5. Only now consider restarting

Restarting destroys the evidence, so capture `status_exec` (or the `ps` output)
first. **Never kill port 1337 unless asked** — that is packaged DevHub.app, the
daily driver. Verify checkout changes on a free port instead.

## Fixing what you find

Every external command must go through `execExternal`
(`dashboard/lib/exec-external.ts`), which applies a default ceiling and feeds
`status_exec`. There is deliberately no way to request "no timeout"; pass a
larger `timeoutMs` for genuinely slow work.

When you need to know whether something was killed for exceeding its ceiling,
use `isExecTimeout(err)` — a killed process reports `killed`/`signal` and no
useful message. Matching on error text is how a stale-cache fallback ended up
unreachable in production: it only fired on a message the hung process never
produced.
