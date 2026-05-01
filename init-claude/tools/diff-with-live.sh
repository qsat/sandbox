#!/usr/bin/env bash
# Diffs this repo's _claude config against the live ~/.claude
# Usage: ./tools/diff-with-live.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$(dirname "$SCRIPT_DIR")/_claude"
TARGET="$HOME/.claude"

DIFF_ITEMS=("CLAUDE.md" "settings.json" "keybindings.json" "mcp.json")

for ITEM in "${DIFF_ITEMS[@]}"; do
  SRC="$SOURCE/$ITEM"
  DST="$TARGET/$ITEM"

  if [[ ! -f "$SRC" ]]; then
    echo "── $ITEM: not in repo ──"
    continue
  fi
  if [[ ! -f "$DST" ]]; then
    echo "── $ITEM: not in ~/.claude (new file) ──"
    continue
  fi

  DIFF=$(diff --color=always "$SRC" "$DST" || true)
  if [[ -n "$DIFF" ]]; then
    echo "── $ITEM ──"
    echo "$DIFF"
    echo ""
  else
    echo "── $ITEM: identical ✓"
  fi
done
