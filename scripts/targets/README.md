# Desktop target checks

Run against the final core/Vite cutover. Record the exact source commit, OS, command and result below; repeat when build inputs change. Create an independent disposable clone without personal content, `.env*` files or source history from the source checkout:

```bash
bash scripts/targets/clean-clone.sh <source-sha> /absolute/path/to/new/clone
```

The clone has one new fixture commit, not the source SHA. The gate replaces all remotes in its clone with a new local fixture remote. It creates a fresh fixture `HOME`, content, config and logs, disables scheduler/MCP, and defaults to ports 1437/1439/1440. Override these with `TARGET_PORT`, `TARGET_TERMINAL_PORT` and `TARGET_MCP_PORT` when needed. `NODE_OPTIONS` passes through, so a small container can raise the heap (`--max-old-space-size=6144`) for typecheck and build. `PLAYWRIGHT_BROWSERS_PATH` also passes through; set it to an existing browser cache (for example `$HOME/.cache/ms-playwright`, filled by `npx playwright install chromium webkit` from the clone's `apps/ui`) because the fixture `HOME` starts empty. Never probe, stop or send traffic to the installed app on 1337/1339/1340. Use a dedicated Bash terminal; the gate stops only its own process group. If a port or target is unavailable, record unverified.

The gate requires the root workspace lockfile from W04, Node and npm, Git, curl and Bash. It runs `npm ci`, lint, typecheck, tests and the production build, starts the fixture, confirms a random fixture note and terminal log location before mutations, exercises task edit/restart, PTY and foreign-origin denial, then stops the fixture. It retains the printed fixture directory for inspection. `--ui` also runs Chromium and WebKit Playwright against the configured dashboard port and pauses for the terminal and screenshot check; have those browsers available. `--desktop` runs the Mac desktop test/build/verify/selftest in the same clean environment. Check `$FIXTURE/dev.log` for disabled scheduler/MCP and audit writes against the fixture roots and disposable checkout. Read the printed fixture path as `FIXTURE` for that inspection.

## T01 — Mac

In an independent clone at the tested commit:

```bash
cd /absolute/path/to/disposable/clone
CHECKOUT="$PWD" bash scripts/targets/fixture-env.sh --ui --desktop
```

For native WKWebView, use a separate macOS user **and graphical login session**, or a disposable Mac VM. In that session build the same commit with the command above, then in a terminal with that user's normal `HOME`:

```bash
test "$(id -un)" = devhub-fixture
cd /absolute/path/to/disposable/clone
APP="$PWD/apps/desktop/src-tauri/target/release/bundle/macos/DevHub.app"
test -x "$APP/Contents/MacOS/devhub-desktop"
command -v lsof >/dev/null
if lsof -nP -iTCP:15437 -sTCP:LISTEN >/dev/null || lsof -nP -iTCP:15439 -sTCP:LISTEN >/dev/null; then exit 1; fi
mkdir -p "$HOME/devhub-target/app-data" "$HOME/devhub-target/terminal-logs"
export DEVHUB_APP_DATA="$HOME/devhub-target/app-data" DEVHUB_PORT=15437 DEVHUB_TERMINAL_PORT=15439
export DEVHUB_SCHEDULER=0 DEVHUB_MCP_HTTP=0 DEVHUB_TERMINAL_LOG_DIR="$HOME/devhub-target/terminal-logs"
"$APP/Contents/MacOS/devhub-desktop"
```

In another terminal in that session, check `test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:15437/api/desktop/health)" = 401`. In the candidate window create `WK note fixture` and `WK task fixture`, run `printf 'WK_%s\n' OK` and see `WK_OK`; restart only that candidate and verify both records. Check `grep -R -l 'WK note fixture' "$HOME/devhub-target/app-data/notes"` and `grep -R -l 'WK task fixture' "$HOME/devhub-target/app-data/tasks"`; capture the fixture window with `screencapture -x "$HOME/devhub-target/wkwebview.png"`. Exercise a deep link, a disposable plugin, and upgrade/rollback using fixture artifacts and data. If the isolated session or a required fixture is unavailable, record the affected result as unverified. Never use an installed bundle or an installer.

## T02 — Windows host WSL

Inside Ubuntu, in a separate disposable clone:

```bash
cd /absolute/path/to/disposable/clone
CHECKOUT="$PWD" bash scripts/targets/fixture-env.sh --ui
```

Inspect the retained fixture log and write locations. The existing WSL service and installed Windows process must stay running unchanged; do not start, stop, restart or probe them. If their continuity cannot be observed without interacting with them, record coexistence as unverified. Record both startup orders separately: use the historical `wsl-coexistence/physical-wsl2-check.txt` result only when its exact build inputs match; otherwise mark the reverse order unverified. Do not repeat that order by stopping either live process. Preserve the historical evidence.

## T03 — Windows CI and native tests

Once the exact candidate commit is already on the remote `main` ref, run this **non-publishing** dispatch from the candidate clone. `source_commit` is only a payload marker: Actions checks out `--ref`, so the remote ref and returned `headSha` must both equal the tested SHA. If the commit is not already there, record CI unverified; do not substitute another commit.

```bash
SHA="$(git rev-parse HEAD)"
test "$(gh api 'repos/{owner}/{repo}/commits/main' --jq .sha)" = "$SHA"
PREVIOUS_ID="$(gh run list --workflow release-desktop.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
gh workflow run release-desktop.yml --ref main -f version=0.0.0-targetcheck -f windows_only=true -f source_commit="$SHA"
RUN_ID=
for attempt in $(seq 1 60); do
  RUN_ID="$(gh run list --workflow release-desktop.yml --branch main --limit 20 --json databaseId,headSha,event --jq ".[] | select(.databaseId > $PREVIOUS_ID and .headSha == \"$SHA\" and .event == \"workflow_dispatch\") | .databaseId" | head -n 1)"
  test -n "$RUN_ID" && break
  sleep 3
done
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
test "$(gh run view "$RUN_ID" --json headSha --jq .headSha)" = "$SHA"
gh run view "$RUN_ID" --json conclusion,jobs --jq '{conclusion,jobs:[.jobs[]|{name,conclusion}]}'
```

Confirm both `Windows (x64, WSL2)` and `Windows installer smoke` succeeded. The installer smoke runs on the disposable CI runner only. On a disposable Windows checkout at the same commit, with SDK and Rust installed, run in PowerShell:

```powershell
node apps/desktop/scripts/test-windows.mjs
if ($LASTEXITCODE -ne 0) { throw 'Windows tests failed' }
```

Together with T02 this is the default Windows proof. Native WebView2 is optional and stays unverified unless a disposable Windows VM or a separate Windows user **and logon session** with a fresh, isolated WSL distro is available. Do not create a Windows user. Run the isolated WebView2 procedure if available and record it separately. Never run an installer or `windows-install-smoke.ps1` on the existing Windows host, and never run a candidate in the user's Windows session.

## T04 — Docker

Use a **second** disposable clone: the builder uses isolated container dependency volumes. Docker must already be running; do not start or stop it. From the clone on the Mac:

```bash
docker info >/dev/null
cd /absolute/path/to/disposable/docker-clone
node apps/desktop/scripts/build-linux.mjs
find apps/desktop/src-tauri/target-linux/release/bundle/deb -type f -name '*.deb' | grep -q .
find apps/desktop/src-tauri/target-linux/release/bundle/appimage -type f -name '*.AppImage' | grep -q .
docker run --rm -it --name devhub-target-fixture -v "$PWD:/work" -w /work devhub-linux-builder bash
```

Inside that container:

```bash
CHECKOUT=/work bash scripts/targets/fixture-env.sh
```

Exit the container afterwards; stop only `devhub-target-fixture` if necessary. Do not mount host home, publish ports or use host networking. The Linux build and headless gate are separate results; neither proves a native WebKitGTK GUI.

## Results after V20

| Commit | Target / OS | Command or action | Result (pass/unverified) |
| --- | --- | --- | --- |
| | T01 Mac gate + desktop | `CHECKOUT="$PWD" bash scripts/targets/fixture-env.sh --ui --desktop` | unverified |
| | T01 native WKWebView | isolated session procedure above | unverified |
| | T02 Windows host WSL: service first | `CHECKOUT="$PWD" bash scripts/targets/fixture-env.sh --ui` | unverified |
| | T02 Windows host WSL: checkout first | matching historical evidence or isolated procedure | unverified |
| | T03 Windows CI | dispatch + both Windows jobs | unverified |
| | T03 Windows tests | `node apps/desktop/scripts/test-windows.mjs` | unverified |
| | T03 native WebView2 (optional) | isolated VM/session procedure | unverified |
| | T04 Docker build | `node apps/desktop/scripts/build-linux.mjs` | unverified |
| | T04 Docker runtime | `CHECKOUT=/work bash scripts/targets/fixture-env.sh` | unverified |
| | T04 native WebKitGTK GUI | separate native check | unverified |

Final pass: generate the root lockfile, then run root typecheck, production build and one supervisor shutdown test. Record native Windows, WSL and macOS results separately.
