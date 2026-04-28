#!/usr/bin/env bash
# Blocks dangerous Bash commands before they execute.
# Input: JSON on stdin with keys: tool_name, tool_input

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

BLOCKED_PATTERNS=(
  "rm -rf /"
  "git push --force origin main"
  "git push --force origin master"
  "git push -f origin main"
  "git push -f origin master"
  "git reset --hard"
  "DROP TABLE"
  "truncate"
  "> /dev/sda"
)

for PATTERN in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qi "$PATTERN"; then
    echo "{\"decision\": \"block\", \"reason\": \"Blocked dangerous command pattern: $PATTERN\"}"
    exit 0
  fi
done

echo '{"decision": "approve"}'
