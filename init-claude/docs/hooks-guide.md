# Hooks ガイド

## フックの種類

| フック       | タイミング                       | 用途例                            |
|--------------|----------------------------------|-----------------------------------|
| PreToolUse   | ツール実行前                     | 危険コマンドのブロック、ログ記録  |
| PostToolUse  | ツール実行後                     | 結果の検証、副作用の実行          |
| Stop         | Claudeが応答を終えた後           | git status表示、通知送信          |
| Notification | Claudeがユーザー入力を待つとき   | デスクトップ通知                  |

## フックスクリプトの仕様

### 入力 (stdin)
```json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/test"
  }
}
```

### 出力 (stdout) — PreToolUse のみ

**承認:**
```json
{"decision": "approve"}
```

**ブロック:**
```json
{"decision": "block", "reason": "危険なコマンドです"}
```

**出力なし or 非ゼロ終了コード:** エラーとして扱われる（実行は続行）

## 最小フック実装

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$COMMAND" | grep -q "rm -rf /"; then
  echo '{"decision": "block", "reason": "システムディレクトリの削除は禁止"}'
  exit 0
fi

echo '{"decision": "approve"}'
```

## settings.json での登録

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/PreToolUse/safety-check.sh"
          }
        ]
      }
    ]
  }
}
```

`matcher` は空文字列 `""` で全ツールにマッチ。ツール名を指定すると絞り込める。

## デバッグ方法

```bash
# フックを手動でテスト
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' \
  | ~/.claude/hooks/PreToolUse/safety-check.sh
```
