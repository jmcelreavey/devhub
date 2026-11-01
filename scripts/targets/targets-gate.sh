#!/usr/bin/env bash
set -euo pipefail
: "${FIXTURE:?Run through fixture-env.sh}" "${CHECKOUT:?Run through fixture-env.sh}"
: "${TARGET_PORT:?Run through fixture-env.sh}" "${TARGET_TERMINAL_PORT:?Run through fixture-env.sh}" "${TARGET_MCP_PORT:?Run through fixture-env.sh}"
export PORT="$TARGET_PORT" TERMINAL_PORT="$TARGET_TERMINAL_PORT" DEVHUB_MCP_HTTP_PORT="$TARGET_MCP_PORT"
UI=0 DESKTOP=0
for arg in "$@"; do
  case "$arg" in
    --ui) UI=1 ;;
    --desktop) DESKTOP=1 ;;
    *) echo 'Usage: fixture-env.sh [--ui] [--desktop]' >&2; exit 2 ;;
  esac
done
cd "$CHECKOUT"
if [ -f apps/ui/package.json ]; then UI_DIR="$CHECKOUT/apps/ui"
else echo 'Cannot find the UI package' >&2; exit 1; fi
if [ -f desktop/package.json ]; then DESKTOP_DIR="$CHECKOUT/desktop"
elif [ -f apps/desktop/package.json ]; then DESKTOP_DIR="$CHECKOUT/apps/desktop"
else echo 'Cannot find the desktop package' >&2; exit 1; fi
test -f "$DESKTOP_DIR/scripts/selftest.mjs"

check_ports() {
  node --input-type=module <<'JS'
import net from 'node:net';
const ports = [process.env.TARGET_PORT, process.env.TARGET_TERMINAL_PORT, process.env.TARGET_MCP_PORT];
if (ports.some(port => !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) || new Set(ports.map(Number)).size !== ports.length) {
  throw new Error('Target ports must be distinct integers between 1 and 65535');
}
for (const port of ports.map(Number)) for (const host of ['0.0.0.0', '::']) await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', error => {
    if (error.code === 'EAFNOSUPPORT') resolve();
    else reject(new Error(`port ${port} is unavailable on ${host}: ${error.code}`));
  });
  server.listen({ port, host, ipv6Only: host === '::' }, () => server.close(resolve));
});
JS
}
check_ports
test -f package-lock.json || { echo 'The root workspace lockfile from W04 is required' >&2; exit 1; }
# All remotes in this disposable clone are replaced with a local fixture.
git init --bare --quiet "$FIXTURE/remote.git"
while IFS= read -r remote; do git remote remove "$remote"; done < <(git remote)
git remote add origin "$FIXTURE/remote.git"
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
check_ports
set -m
BASE="http://127.0.0.1:$TARGET_PORT"
FIXTURE_MARKER="$(node -p 'require("node:crypto").randomUUID()')"
printf '[{"id":"%s","type":"paragraph","props":{},"content":[{"type":"text","text":"%s","styles":{}}],"children":[]}]\n' "$FIXTURE_MARKER" "$FIXTURE_MARKER" >"$NOTES_DIR/$FIXTURE_MARKER.json"
start_fixture() {
  cd "$CHECKOUT"
  check_ports
  : >"$FIXTURE/dev.log"
  npm run dev >"$FIXTURE/dev.log" 2>&1 &
  DEV_PID=$!
  for attempt in $(seq 1 120); do
    if kill -0 "$DEV_PID" 2>/dev/null && curl -fsS "$BASE/api/desktop/health" >/dev/null 2>&1 && \
      grep -Fq "PTY server listening on ws://127.0.0.1:$TARGET_TERMINAL_PORT" "$FIXTURE/dev.log" && \
      grep -Fq "session logs: $DEVHUB_TERMINAL_LOG_DIR" "$FIXTURE/dev.log" && \
      curl -fsS "$BASE/api/notes/$FIXTURE_MARKER" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{if(!JSON.stringify(JSON.parse(s).content).includes(process.argv[1]))process.exit(1)}catch{process.exit(1)}})' "$FIXTURE_MARKER"; then
      return 0
    fi
    sleep 1
  done
  return 1
}
stop_fixture() {
  if [ -n "${DEV_PID:-}" ]; then
    kill -INT -- "-$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
    DEV_PID=
  fi
}
trap stop_fixture EXIT
start_fixture
curl -fsS "$BASE/" >/dev/null
curl -fsS "$BASE/api/desktop/health" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s);if(!v.devhub||v.status!=="browser")process.exit(1)})'
curl -fsS -X POST -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"text":"target fixture initial"}' "$BASE/api/tasks" >"$FIXTURE/task.json"
TASK_ID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id' "$FIXTURE/task.json")"
curl -fsS -X PATCH -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data "{\"id\":\"$TASK_ID\",\"text\":\"target fixture edited\"}" "$BASE/api/tasks" >/dev/null
find "$TASKS_DIR" -type f -name '*.json' -exec grep -lF 'target fixture edited' {} + | grep -q .
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: https://untrusted.invalid' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "http://127.0.0.1:$TARGET_TERMINAL_PORT/")" = 403
cd "$UI_DIR"
node --input-type=commonjs <<'JS'
const WebSocket = require('ws');
const socket = new WebSocket(`ws://127.0.0.1:${process.env.TARGET_TERMINAL_PORT}/?shell=bash`, { origin: `http://127.0.0.1:${process.env.TARGET_PORT}` });
let sent = false, seen = false, output = '';
const timer = setTimeout(() => { console.error('PTY timeout'); socket.terminate(); process.exitCode = 1; }, 10000);
socket.on('message', data => {
  const text = data.toString();
  if (text.startsWith('{"devhubCtl"')) {
    const control = JSON.parse(text);
    if (control.type === 'session' && !sent) { sent = true; socket.send("printf 'TARGET_%s\\n' OK\r"); }
  } else {
    output = (output + text).slice(-1024);
    if (output.includes('TARGET_OK') && !seen) {
      seen = true; clearTimeout(timer); socket.send('{"type":"dispose"}', () => socket.close());
    }
  }
});
socket.on('error', () => { clearTimeout(timer); process.exitCode = 1; });
socket.on('close', () => { clearTimeout(timer); if (!seen) process.exitCode = 1; });
JS
cd "$CHECKOUT"
if [ "$UI" = 1 ]; then
  for browser in chromium webkit; do
    (cd "$UI_DIR" && PLAYWRIGHT_BASE_URL="$BASE" npm run test:e2e -- --project="$browser")
  done
  printf '\nOpen %s in the fixture browser. In its terminal run printf '\''UI_%%s\\n'\'' OK, confirm UI_OK and inspect a screenshot.\n' "$BASE"
  read -r -p 'Type PASS after both checks succeed, or Ctrl-C to abort: ' result
  test "$result" = PASS
fi
stop_fixture
start_fixture
curl -fsS "$BASE/api/tasks?taskId=$TASK_ID" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(!JSON.parse(s).tasks.some(t=>t.text==="target fixture edited"))process.exit(1)})'
stop_fixture
trap - EXIT
if [ "$DESKTOP" = 1 ]; then
  npm run desktop:test
  npm run desktop:build
  npm run desktop:verify
  npm run desktop:selftest
fi
echo 'Fixture gate passed.'
