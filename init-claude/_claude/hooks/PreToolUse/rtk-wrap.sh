#!/usr/bin/env bash
# Bash コマンドを rtk 経由にリライトしてトークン使用量を削減する。
# rtk がインストールされていない場合はスキップ。

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if [[ "$TOOL" != "Bash" || -z "$COMMAND" ]]; then
  echo '{"decision": "approve"}'
  exit 0
fi

if ! command -v rtk &>/dev/null; then
  echo '{"decision": "approve"}'
  exit 0
fi

# 二重ラップを防ぐ
if echo "$COMMAND" | grep -qE "^rtk "; then
  echo '{"decision": "approve"}'
  exit 0
fi

NEW_COMMAND="rtk $COMMAND"
UPDATED_INPUT=$(jq -n --arg cmd "$NEW_COMMAND" '{"command": $cmd}')
echo "{\"decision\": \"approve\", \"updatedInput\": $UPDATED_INPUT}"
