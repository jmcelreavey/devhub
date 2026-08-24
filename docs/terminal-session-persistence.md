---
title: Terminal sessions that survive a rebuild
description: Design sketch for decoupling PTY lifetime from the dashboard dev process.
---

# Terminal sessions that survive a rebuild

Design sketch for decoupling PTY lifetime from the `term` process in
`dashboard/package.json`'s `concurrently` group.

Status: proposal. Nothing here is implemented.

## The problem, precisely

`scripts/terminal-pty-server.ts` already has a reattach mechanism, and it works —
but it only covers the _client_ going away:

```
WebSocket closes without dispose  →  session parked for ORPHAN_TTL_MS (15 min)
                                  →  ?attach=<sessionId> rebinds
```

A rebuild is a different event. It restarts the whole `concurrently` group, so
the peer takes SIGTERM and runs:

```ts
function shutdown(): void {
  for (const session of sessions.values()) {
    destroySession(session, "shutdown");   // ← term.kill() on every parked PTY
  }
  ...
}
```

The PTY is a child of the peer. Kill the peer, kill the shell. The orphan park
never gets a chance, because the thing holding the park died too.

The fix is not a longer TTL or a smarter `shutdown()`. It's that **the process
holding the PTY master must not be in the dev loop.**

## Approach: a detach helper owns the PTY

Keep the entire existing WebSocket protocol — `?shell=`, `?attach=<uuid>`,
`dispose`/`resize` control frames, the `session` control frame, the on-disk tee,
the origin + ticket checks. None of that changes.

Change one thing: what `spawnShell` actually execs.

```
today:    peer ──node-pty──> zsh -l
proposed: peer ──node-pty──> dtach client ──socket──> [detached master] ──> zsh -l
                                                       ^ PPID 1, outlives the peer
```

`node-pty` still hands you a PTY and `onData`/`resize`/`kill` still behave. The
difference is that its child is now a thin _client_. The shell lives behind a
unix socket owned by a daemonised master that `launchd` re-parents.

### Why dtach rather than tmux

tmux is the obvious reach, but it fits this codebase worse:

|                     | dtach / abduco                     | tmux                                     |
| ------------------- | ---------------------------------- | ---------------------------------------- |
| Terminal emulation  | none — raw byte passthrough        | full; own screen model                   |
| Reattach redraw     | none; you replay your own log      | tmux redraws the pane                    |
| Scrollback          | none; you already tee to disk      | tmux owns history                        |
| OSC 133 passthrough | transparent                        | tmux ≥3.4 intercepts OSC 133 itself      |
| Config bleed        | none                               | user's `.tmux.conf` leaks in unless `-f` |
| Bundling            | ~1k lines of C, trivially vendored | large; not shipped with macOS            |

The decisive rows are OSC 133 and redraw. This peer already:

- injects its own OSC 133 marks via the intercepted `ZDOTDIR` (`integrationZsh()`),
- tees every byte to `terminalLogPath()`,
- replays `REATTACH_REPLAY_BYTES` on reattach (`readRawLogTail`).

tmux would duplicate all three and fight the first one. dtach does none of them,
which is exactly what's wanted — it adds persistence and nothing else, so
`bindSocket`'s replay path stays byte-for-byte as it is today.

Use `abduco` instead of `dtach` if you want `-l` session listing for free; the
design below is identical either way.

## Concrete changes

### 1. Wrap `shellCommand(mode)` instead of spawning it

```ts
const SESSION_DIR = path.join(
  os.homedir(),
  ".cache",
  "devhub",
  "terminal-sessions",
);

function hostedCommand(session: PtySession, mode: ShellMode): ShellCommand {
  const inner = shellCommand(mode);
  if (terminalHost() !== "dtach") return inner; // fallback path
  const sock = path.join(SESSION_DIR, `${session.sessionId}.sock`);
  return {
    cmd: dtachBin(),
    args: [
      "-A",
      sock, // attach if the socket is live, else create
      "-z", // don't intercept suspend
      "-E", // no detach character — ^\ belongs to the shell
      "-r",
      "none", // we replay from our own log; don't let dtach redraw
      "--",
      inner.cmd,
      ...inner.args,
    ],
  };
}
```

`SESSION_DIR` at `0700`. `sessionId` is already validated by `isValidSessionId`,
so it's safe as a path component — keep that check on the `?attach=` path.

`-A` is the whole reattach primitive: attach-if-exists, create-otherwise. The
peer no longer needs to distinguish "spawn" from "reattach" at the process
level, only at the replay level.

### 2. `SHELL_INTEGRATION_DIR` must stop being pid-scoped

This is the migration's forced bug, and it will bite immediately if missed:

```ts
const SHELL_INTEGRATION_DIR = path.join(
  os.tmpdir(),
  `devhub-terminal-integration-${process.pid}`, // ← breaks
);
```

with `shutdown()` doing `fs.rmSync(SHELL_INTEGRATION_DIR, { recursive: true })`.

The shell now outlives the peer, but its `ZDOTDIR` points into a directory keyed
to the dead peer's pid — which `shutdown()` just deleted. The next `precmd` in
that surviving shell sources nothing, and any new subshell loses integration.

Change to a stable path, written idempotently, never deleted on shutdown:

```ts
const SHELL_INTEGRATION_DIR = path.join(
  os.homedir(),
  ".cache",
  "devhub",
  "terminal-integration",
);
```

Prune it on _startup_ alongside `initLogDir()`, not on exit.

### 3. Record the shell's pid so `dispose` can still kill

dtach has no "kill this session" verb — it only attaches and detaches. Give it
one by making the innermost command a two-line wrapper:

```sh
#!/bin/sh
echo $$ > "$DEVHUB_SESSION_PID_FILE"
exec "$@"
```

Then:

- **dispose** (user closed the tab) → read `<sessionId>.pid`, `process.kill(-pid, "SIGHUP")`,
  unlink socket + pidfile. Same observable behaviour as today's `term.kill()`.
- **liveness** → `process.kill(pid, 0)` tells you whether a socket on disk is
  a real session or a leftover.

### 4. `shutdown()` stops destroying

```ts
function shutdown(): void {
  for (const session of sessions.values()) {
    session.term?.kill(); // kills the dtach *client* only
    session.logStream?.end();
  }
  wss.close(() => process.exit(0));
  // no rmSync of the integration dir
  // no destroySession
}
```

Killing the client detaches; the master and the shell keep running.

### 5. Adopt live sessions on startup

New step in the boot sequence, after `initLogDir()`:

```ts
function adoptExistingSessions(): void {
  for (const entry of fs.readdirSync(SESSION_DIR)) {
    if (!entry.endsWith(".sock")) continue;
    const id = entry.slice(0, -5);
    if (!isValidSessionId(id)) continue;
    if (!pidAlive(readPidFile(id))) {
      cleanupSession(id);
      continue;
    }
    sessions.set(id, {
      sessionId: id,
      term: null, // no client attached yet
      logFile: terminalLogPath(id),
      /* …rest from a `detached` factory… */
    });
  }
}
```

`bindSocket` then needs one new branch: a session that is _known but has
`term === null`_ means "adopted, not yet attached" — spawn the dtach client for
it, then bind and replay exactly as the current `reattached` path does.

### 6. Orphan TTL becomes a reaper

`ORPHAN_TTL_MS` is currently a per-session `setTimeout`, which dies with the
peer. Replace with a sweep on startup and on an interval: any session whose
socket has had no attached client for longer than the TTL gets its pid killed
and its files removed. Because detached shells are now genuinely cheap, the TTL
can go up a lot — hours rather than 15 minutes.

Track "last detached at" by touching the socket's mtime on unbind.

## Risks and open questions

**Bundling.** macOS ships neither dtach nor abduco. The desktop app would need
to vendor a binary, which means `desktop/src-tauri/src/selftest.rs` gains a
resource check next to `terminal-pty-server.cjs`, and the notarisation story
covers one more executable. This is the main cost of the whole design — worth
deciding before writing any code.

**Fallback.** Gate on `DEVHUB_TERMINAL_HOST=dtach|direct`, defaulting to
`direct` when the binary isn't found. `direct` keeps today's exact semantics, so
a checkout with no helper installed behaves as it does now.

**Log growth.** Sessions that live for days will grow their `.log` past what
`LOG_TTL_MS` pruning (which is mtime-based, and these files stay hot) will ever
touch. Needs a size cap or rotation — `REATTACH_REPLAY_BYTES` already reads only
the tail, so rotation is safe.

**Redraw fidelity.** With `-r none`, a reattached xterm shows the replayed log
tail, not the shell's true current screen. If the session was sitting in a
full-screen TUI (vim, htop, `less`), the replay is a transcript of escape
sequences that will look wrong until the app redraws. Today's code has the same
property, so this is not a regression — but it becomes much more visible once
sessions live for days instead of minutes. `-r winch` is the cheap mitigation
(SIGWINCH nudges most TUIs into a redraw).

**Security posture.** The socket lives under `~/.cache` at `0700`. Anyone who
can read it can already execute as the user, so this is no weaker than the
loopback WebSocket — but the security comment block at the top of the peer is
careful and specific, and should get a paragraph saying so explicitly rather
than leaving a reader to infer it.

## Suggested order

1. Fix `SHELL_INTEGRATION_DIR` to a stable path. Standalone, correct on its own
   merits, and unblocks everything else.
2. Decide the bundling question. If vendoring a binary is a no, stop here — the
   rest of the design has no cheap variant.
3. `hostedCommand` + pid wrapper + `dispose` rework, behind
   `DEVHUB_TERMINAL_HOST`, defaulting off.
4. `shutdown()` stops destroying; adopt-on-startup; reaper.
5. Flip the default once a rebuild demonstrably leaves a session running.
