#!/usr/bin/env bash
# Blocks dangerous Bash commands and reads of credential files.
# Input: JSON on stdin with keys: tool_name, tool_input

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# --- Block Read/Edit/Write on credential-like files ---
SENSITIVE_PATH_PATTERNS=(
  "\.env$"
  "\.env\."
  "\.secret"
  "secret\."
  "secrets\."
  "credentials"
  "\.pem$"
  "\.key$"
  "\.p12$"
  "\.pfx$"
  "id_rsa"
  "id_ed25519"
)

if [[ "$TOOL" =~ ^(Read|Edit|Write)$ ]]; then
  for PATTERN in "${SENSITIVE_PATH_PATTERNS[@]}"; do
    if echo "$FILE_PATH" | grep -qiE "$PATTERN"; then
      echo "{\"decision\": \"block\", \"reason\": \"Blocked read/write of credential file: $FILE_PATH\"}"
      exit 0
    fi
  done
fi

# --- Block Bash commands that cat/print credential files ---
SENSITIVE_COMMAND_PATTERNS=(
  "\.env[^a-zA-Z]"
  "\.env$"
  "\.secret"
  "secret\."
  "credentials"
  " id_rsa"
  " id_ed25519"
  "\.pem"
  "\.key"
)

if [[ "$TOOL" == "Bash" ]]; then
  for PATTERN in "${SENSITIVE_COMMAND_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qiE "(cat|less|head|tail|bat|echo|print|type)[[:space:]].*$PATTERN"; then
      echo "{\"decision\": \"block\", \"reason\": \"Blocked command that reads credential file matching: $PATTERN\"}"
      exit 0
    fi
  done
fi

# --- Block destructive Bash commands ---
BLOCKED_PATTERNS=(
  "rm -rf /"
  "git push --force origin main"
  "git push --force origin master"
  "git push -f origin main"
  "git push -f origin master"
  "git reset --hard"
  "DROP TABLE"
  "> /dev/sda"
)

if [[ "$TOOL" == "Bash" ]]; then
  for PATTERN in "${BLOCKED_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qi "$PATTERN"; then
      echo "{\"decision\": \"block\", \"reason\": \"Blocked dangerous command: $PATTERN\"}"
      exit 0
    fi
  done
fi

echo '{"decision": "approve"}'
