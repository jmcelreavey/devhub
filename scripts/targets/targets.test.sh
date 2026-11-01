#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
SOURCE="$TEST_ROOT/source"
mkdir -p "$SOURCE/scripts/targets" "$SOURCE/scripts/lib" "$SOURCE/apps/ui" \
  "$SOURCE/apps/desktop/scripts" "$SOURCE/skills/shared/my-voice" "$SOURCE/notes" "$SOURCE/tasks" "$SOURCE/private" "$TEST_ROOT/tmp" "$TEST_ROOT/bin"
cp "$ROOT/scripts/targets/clean-clone.sh" "$ROOT/scripts/targets/fixture-env.sh" \
  "$ROOT/scripts/targets/targets-gate.sh" "$SOURCE/scripts/targets/"
cp "$ROOT/scripts/lib/public-paths.sh" "$SOURCE/scripts/lib/"
printf 'public\n' >"$SOURCE/README.md"
printf 'private\n' >"$SOURCE/notes/secret"
printf 'private\n' >"$SOURCE/tasks/secret"
printf 'private\n' >"$SOURCE/private/secret"
printf 'private\n' >"$SOURCE/skills/shared/my-voice/writing-style.md"
printf 'private\n' >"$SOURCE/apps/ui/.env.secret"
printf '{}\n' >"$SOURCE/apps/ui/package.json"
printf '{}\n' >"$SOURCE/apps/desktop/package.json"
touch "$SOURCE/apps/desktop/scripts/selftest.mjs"
git -C "$SOURCE" init --quiet --template=
git -C "$SOURCE" add --force --all
git -C "$SOURCE" -c user.name=Fixture -c user.email=fixture@localhost -c core.hooksPath=/dev/null commit -qm first
FIRST_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
printf 'second\n' >>"$SOURCE/README.md"
git -C "$SOURCE" add README.md
git -C "$SOURCE" -c user.name=Fixture -c user.email=fixture@localhost -c core.hooksPath=/dev/null commit -qm second

bash "$SOURCE/scripts/targets/clean-clone.sh" HEAD "$TEST_ROOT/clone"
test -d "$TEST_ROOT/clone/.git"
test "$(git -C "$TEST_ROOT/clone" rev-list --count HEAD)" = 1
test "$(git -C "$TEST_ROOT/clone" show HEAD:README.md)" = "$(printf 'public\nsecond')"
for entry in notes tasks private apps/ui/.env.secret skills/shared/my-voice/writing-style.md; do test ! -e "$TEST_ROOT/clone/$entry"; done
if bash "$SOURCE/scripts/targets/clean-clone.sh" HEAD "$TEST_ROOT/clone" 2>/dev/null; then exit 1; fi
bash "$SOURCE/scripts/targets/clean-clone.sh" "$FIRST_SHA" "$TEST_ROOT/older-clone"
test "$(git -C "$TEST_ROOT/older-clone" show HEAD:README.md)" = public
echo 'PASS clean clone excludes personal data, env files and history'

cat >"$TEST_ROOT/bin/node" <<'NODE'
#!/usr/bin/env bash
printf '%s %s %s / %s %s %s\n' "$TARGET_PORT" "$TARGET_TERMINAL_PORT" "$TARGET_MCP_PORT" "$PORT" "$TERMINAL_PORT" "$DEVHUB_MCP_HTTP_PORT"
exit 71
NODE
chmod +x "$TEST_ROOT/bin/node"
for ports in defaults alternate; do
  overrides=()
  expected='1437 1439 1440 / 1437 1439 1440'
  if [ "$ports" = alternate ]; then
    overrides=(TARGET_PORT=24437 TARGET_TERMINAL_PORT=24439 TARGET_MCP_PORT=24440)
    expected='24437 24439 24440 / 24437 24439 24440'
  fi
  status=0
  output="$(env -i PATH="$TEST_ROOT/bin:$PATH" HOME="$TEST_ROOT" TMPDIR="$TEST_ROOT/tmp" \
    CHECKOUT="$TEST_ROOT/clone" ${overrides[@]+"${overrides[@]}"} bash "$TEST_ROOT/clone/scripts/targets/fixture-env.sh")" || status=$?
  test "$status" = 71
  case "$output" in *"$expected"*) ;; *) echo "Port forwarding failed: $output" >&2; exit 1 ;; esac
done
echo 'PASS default and alternate ports reach the gate and app environment'
