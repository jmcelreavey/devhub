#!/bin/sh
set -eu

if [ -z "${EXPLABS_API_KEY:-}" ]; then
  secrets_dir="${XDG_CONFIG_HOME:-$HOME/.config}/devhub/secrets"
  key_file="$secrets_dir/experiential_paseo_api_key"
  if [ ! -f "$key_file" ]; then key_file="$secrets_dir/experiential_api_key"; fi
  if [ ! -r "$key_file" ]; then
    echo 'Set EXPLABS_API_KEY or save it in the DevHub experiential_api_key secret file.' >&2
    exit 1
  fi
  EXPLABS_API_KEY="$(cat "$key_file")"
fi
if [ -z "$EXPLABS_API_KEY" ]; then
  echo 'The Experiential Labs API key is empty.' >&2
  exit 1
fi
export EXPLABS_API_KEY

exec "${CODEX_BIN:-codex}" \
  -c 'model_provider="experiential"' \
  -c 'model="hy4:free"' \
  -c 'model_reasoning_effort="low"' \
  -c 'model_providers.experiential.name="Experiential Labs"' \
  -c 'model_providers.experiential.base_url="https://api.experientiallabs.ai/v1"' \
  -c 'model_providers.experiential.env_key="EXPLABS_API_KEY"' \
  -c 'model_providers.experiential.wire_api="responses"' \
  "$@"
