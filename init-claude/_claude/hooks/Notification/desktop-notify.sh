#!/usr/bin/env bash
# Sends a desktop notification when Claude needs user input.
# Useful when working in another window.

set -euo pipefail

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Claude needs your attention"')

# macOS
if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$MESSAGE\" with title \"Claude Code\""
# Linux (notify-send)
elif command -v notify-send &>/dev/null; then
  notify-send "Claude Code" "$MESSAGE"
fi
