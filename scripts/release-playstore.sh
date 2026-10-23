#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Default to bumping versionCode so every release-playstore.sh invocation produces
# a fresh bundle that Google Play Console accepts without versionCode collisions.
BUMP_FLAG="--bump"
PASSTHROUGH_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-bump" || "$arg" == "--check-only" || "$arg" == "--set-google-group" ]]; then
    BUMP_FLAG=""
  fi
  if [[ "$arg" != "--no-bump" ]]; then
    PASSTHROUGH_ARGS+=("$arg")
  fi
done

if [[ -n "$BUMP_FLAG" ]]; then
  exec python3 "$SCRIPT_DIR/release-playstore.py" "$BUMP_FLAG" ${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}
else
  exec python3 "$SCRIPT_DIR/release-playstore.py" ${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}
fi
