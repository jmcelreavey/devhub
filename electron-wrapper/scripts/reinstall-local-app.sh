#!/usr/bin/env bash
set -euo pipefail

APP_NAME="DevHub"
TARGET_APP="/Applications/${APP_NAME}.app"
LOG_FILE="/tmp/devhub-electron-reinstall.log"

if [[ "${1:-}" == "--perform-swap" ]]; then
  sleep "${DEVHUB_SWAP_DELAY_SECONDS:-10}"
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  sleep 2
  rm -rf "$TARGET_APP"
  cp -R "$DEVHUB_STAGED_APP" "$TARGET_APP"
  xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
  open "$TARGET_APP" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$DEVHUB_STAGED_APP")"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILT_APP="$WRAPPER_DIR/release/mac-arm64/${APP_NAME}.app"
STAGE_DIR="$HOME/Library/Application Support/DevHub/pending-local-app"
STAGED_APP="$STAGE_DIR/${APP_NAME}.app"
DELAY_SECONDS="${1:-10}"

cd "$WRAPPER_DIR"
npm run dist -- --mac dir

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp -R "$BUILT_APP" "$STAGED_APP"

echo "Staged $STAGED_APP" | tee "$LOG_FILE"
echo "Will quit ${APP_NAME}, replace ${TARGET_APP}, and reopen it in ${DELAY_SECONDS}s." | tee -a "$LOG_FILE"

DEVHUB_STAGED_APP="$STAGED_APP" \
DEVHUB_SWAP_DELAY_SECONDS="$DELAY_SECONDS" \
nohup "$0" --perform-swap >>"$LOG_FILE" 2>&1 &

echo "Swap scheduled. Log: $LOG_FILE"
