#!/usr/bin/env bash
# Displays git status after Claude stops, so the user knows what changed.

set -euo pipefail

if git rev-parse --git-dir > /dev/null 2>&1; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "detached HEAD")
  STATUS=$(git status --short 2>/dev/null)

  if [ -n "$STATUS" ]; then
    echo ""
    echo "── git status ($BRANCH) ──"
    echo "$STATUS"
    echo "────────────────────────────"
  fi
fi
