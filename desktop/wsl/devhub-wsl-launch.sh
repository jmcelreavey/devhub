#!/bin/sh
# Starts the DevHub supervisor inside WSL. Shipped in the payload as
# bin/devhub-wsl-launch and run by the Windows shell through `wsl.exe --exec`.
#
# usage: devhub-wsl-launch <payload-dir>
#
# Why a script and not `wsl.exe --exec node supervisor.mjs`: --exec gives the
# process WSL's bare default PATH, so the terminal and agents would not find
# `claude`, `codex`, `gh`, or anything installed through nvm/volta/asdf. Running
# under the user's own login+interactive shell gets them the PATH their normal
# terminal has. `exec` at the end means the shell is replaced, not wrapped: the
# supervisor keeps the stdin pipe (its orphan guard depends on it) and receives
# signals directly.
set -eu

payload="${1:?usage: devhub-wsl-launch <payload-dir>}"
node="$payload/runtime/node"
supervisor="$payload/services/supervisor.mjs"

if [ ! -x "$node" ] || [ ! -f "$supervisor" ]; then
  echo "[wsl-launch] incomplete payload at $payload" >&2
  exit 127
fi

cd "$payload/server"

shell="${SHELL:-/bin/bash}"
[ -x "$shell" ] || shell=/bin/bash

# $0 is the node binary, "$@" is the supervisor path (bash -c arg0 semantics).
exec "$shell" -lic 'exec "$0" "$@"' "$node" "$supervisor"
