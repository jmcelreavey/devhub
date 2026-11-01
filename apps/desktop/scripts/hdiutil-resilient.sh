#!/bin/bash
# A drop-in `hdiutil` for the macOS Intel DMG step in release-desktop.yml.
#
# Why this exists. Tauri's bundler writes create-dmg's `bundle_dmg.sh` into the
# target dir on every build and runs it. That script mounts a scratch image,
# copies the app in, then calls `hdiutil detach <device>` through
# `hdiutil_detach_retry`. That helper only retries on exit code 16 (EBUSY). A
# DiskArbitration timeout ("detach: timeout for DiskArbitration expired" /
# "drive not detached") exits 1, so the helper gives up on the first attempt, the
# script dies under `set -e`, and the image is left attached. Nothing in the
# bundler lets us change that script, but it finds `hdiutil` through PATH, so the
# workflow puts this file first on PATH (Intel job only) under the name `hdiutil`.
#
# What it does:
#   * `hdiutil detach <target>` is retried with escalation, and success is judged
#     by whether the device is still attached, not by the exit code alone:
#       1-2  plain `hdiutil detach`, with a mitigation pass between them
#       3    `diskutil unmountDisk force` + `diskutil eject`
#       4+   `hdiutil detach -force`
#     Every step is bounded, so a wedged helper cannot hang the job. When the
#     ladder is exhausted it exits 1, not 16, so the caller does not multiply it.
#   * Mitigation is best-effort: `sync`, `mdutil -i off` on the volume, and a kill
#     of XProtect, whose on-access scan of a freshly written volume is a commonly
#     reported cause of a busy mount on hosted runners. A diagnostic dump (hdiutil
#     info, lsof, related processes) is printed on the first failure.
#   * create / attach / resize / convert are passed through untouched, and timed:
#     anything taking 5s or more is logged, so a slow `hdiutil create` shows up in
#     the log as a number rather than a gap between two timestamps.
#   * Everything else is exec'd straight to the real hdiutil.
#
# `hdiutil-resilient.sh --cleanup` detaches leftover /Volumes/DevHub* and
# /Volumes/dmg.* images with the same ladder. Always exits 0.
#
# Tunables (environment): DEVHUB_DMG_DETACH_ATTEMPTS (5), DEVHUB_DMG_DETACH_BUDGET
# seconds before giving up (600), DEVHUB_DMG_DETACH_BACKOFF seconds x attempt (5),
# DEVHUB_DMG_STEP_TIMEOUT seconds per command (180), DEVHUB_DMG_SETTLE seconds to
# wait after mitigation (3), DEVHUB_DMG_LOG file that also receives the log.
# DEVHUB_REAL_HDIUTIL / DEVHUB_REAL_DISKUTIL point at the real tools (the tests
# point them at fakes).
#
# Must stay compatible with macOS /bin/bash 3.2: no associative arrays, mapfile,
# or ${var,,}.

set -u

REAL_HDIUTIL="${DEVHUB_REAL_HDIUTIL:-/usr/bin/hdiutil}"
REAL_DISKUTIL="${DEVHUB_REAL_DISKUTIL:-/usr/sbin/diskutil}"
ATTEMPTS="${DEVHUB_DMG_DETACH_ATTEMPTS:-5}"
BUDGET="${DEVHUB_DMG_DETACH_BUDGET:-600}"
BACKOFF="${DEVHUB_DMG_DETACH_BACKOFF:-5}"
STEP_TIMEOUT="${DEVHUB_DMG_STEP_TIMEOUT:-180}"
SETTLE="${DEVHUB_DMG_SETTLE:-3}"
LOG_FILE="${DEVHUB_DMG_LOG:-}"

log() {
  printf '[devhub-hdiutil] %s\n' "$*" >&2
  if [ -n "$LOG_FILE" ]; then
    printf '%s [devhub-hdiutil] %s\n' "$(date -u +%H:%M:%S)" "$*" >>"$LOG_FILE" 2>/dev/null || true
  fi
}

emit() {
  local line
  while IFS= read -r line; do log "    $line"; done
}

# bounded <seconds> <command...>: run, kill -9 after the deadline (status 124).
# Polls instead of sleeping in a watchdog so no orphan holds the caller's pipes.
bounded() {
  local limit=$(($1 * 5)) ticks=0 pid rc
  shift
  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge "$limit" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 0.2
    ticks=$((ticks + 1))
  done
  wait "$pid"
  rc=$?
  return "$rc"
}

priv() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi
}

whole_disk() {
  printf '%s' "$1" | sed -E 's#^(/dev/disk[0-9]+).*#\1#'
}

# True while the target is still attached. If hdiutil cannot tell us, assume it is.
attached() {
  local info
  info=$("$REAL_HDIUTIL" info 2>/dev/null) || return 0
  case "$1" in
    /dev/*)
      printf '%s\n' "$info" | awk -v t="$(whole_disk "$1")" '
        $1 == t || (index($1, t "s") == 1 && substr($1, length(t) + 2) ~ /^[0-9]+$/) { found = 1 }
        END { exit !found }'
      ;;
    *) printf '%s\n' "$info" | grep -F -q -- "$1" ;;
  esac
}

mount_points() {
  case "$1" in
    /dev/*)
      "$REAL_HDIUTIL" info 2>/dev/null | awk -F'\t' -v d="$(whole_disk "$1")" \
        '$1 ~ /^\/dev\// && index($1, d) == 1 && $3 != "" { print $3 }'
      ;;
    *) printf '%s\n' "$1" ;;
  esac
}

diagnose() {
  local mp
  log "diagnostics for $1:"
  log "  hdiutil info"
  "$REAL_HDIUTIL" info 2>&1 | head -n 40 | emit
  mount_points "$1" | while IFS= read -r mp; do
    [ -n "$mp" ] || continue
    log "  open files on $mp"
    bounded 20 lsof -- "$mp" 2>&1 | head -n 30 | emit
  done
  log "  related processes"
  ps -axo pid,ppid,etime,pcpu,comm 2>/dev/null |
    grep -E 'mds|XProtect|diskimages|fseventsd|Finder|hdiutil|diskarbitrationd' |
    grep -v grep | head -n 20 | emit
}

mitigate() {
  local mp
  log "mitigating: sync, Spotlight off for the volume, stop XProtect"
  sync || true
  mount_points "$1" | while IFS= read -r mp; do
    [ -n "$mp" ] || continue
    priv mdutil -i off "$mp" >/dev/null 2>&1 || true
  done
  priv pkill -9 XProtect >/dev/null 2>&1 || true
  sleep "$SETTLE"
}

# detach_ladder detach [options] <device-or-mount>
detach_ladder() {
  local target="" disk arg started now attempt=1 rc=0
  shift
  for arg in "$@"; do
    case "$arg" in
      -*) ;;
      *) target="$arg"; break ;;
    esac
  done
  if [ -z "$target" ]; then
    "$REAL_HDIUTIL" detach "$@"
    return $?
  fi
  disk=$(whole_disk "$target")
  started=$(date +%s)

  while :; do
    case "$attempt" in
      1 | 2)
        log "detach attempt $attempt/$ATTEMPTS: hdiutil detach $*"
        bounded "$STEP_TIMEOUT" "$REAL_HDIUTIL" detach "$@"
        rc=$?
        ;;
      3)
        log "detach attempt $attempt/$ATTEMPTS: diskutil unmountDisk force + eject $disk"
        bounded "$STEP_TIMEOUT" "$REAL_DISKUTIL" unmountDisk force "$disk"
        bounded "$STEP_TIMEOUT" "$REAL_DISKUTIL" eject "$disk"
        # diskutil's status says little about whether the image went away.
        if attached "$target"; then rc=1; else rc=0; fi
        ;;
      *)
        log "detach attempt $attempt/$ATTEMPTS: hdiutil detach -force $target"
        bounded "$STEP_TIMEOUT" "$REAL_HDIUTIL" detach -force "$target"
        rc=$?
        ;;
    esac

    if [ "$rc" -eq 0 ] || ! attached "$target"; then
      log "detached $target on attempt $attempt (last status $rc)"
      return 0
    fi
    log "attempt $attempt left $target attached (status $rc) after $(($(date +%s) - started))s"

    now=$(date +%s)
    if [ "$attempt" -ge "$ATTEMPTS" ] || [ $((now - started)) -ge "$BUDGET" ]; then
      break
    fi
    [ "$attempt" -eq 1 ] && diagnose "$target"
    mitigate "$target"
    sleep $((BACKOFF * attempt))
    attempt=$((attempt + 1))
  done

  log "giving up on $target after $attempt attempt(s)"
  diagnose "$target"
  return 1
}

cleanup() {
  local disks disk
  disks=$("$REAL_HDIUTIL" info 2>/dev/null | awk -F'\t' '
    $1 ~ /^\/dev\// && $3 ~ /^\/Volumes\/(DevHub|dmg\.)/ { d = $1; sub(/s[0-9]+$/, "", d); print d }' | sort -u)
  for disk in $disks; do
    log "cleanup: stale image on $disk"
    detach_ladder detach -force "$disk" || true
  done
  return 0
}

timed() {
  local verb="$1" started elapsed rc
  started=$(date +%s)
  [ "$verb" = create ] && log "hdiutil create started"
  "$REAL_HDIUTIL" "$@"
  rc=$?
  elapsed=$(($(date +%s) - started))
  if [ "$elapsed" -ge 5 ] || [ "$rc" -ne 0 ]; then
    log "hdiutil $verb finished in ${elapsed}s (status $rc)"
  fi
  return "$rc"
}

main() {
  case "${1:-}" in
    --cleanup) cleanup; exit 0 ;;
    detach) detach_ladder "$@"; exit $? ;;
    create | attach | resize | convert | makehybrid) timed "$@"; exit $? ;;
    *) exec "$REAL_HDIUTIL" "$@" ;;
  esac
}

main "$@"
