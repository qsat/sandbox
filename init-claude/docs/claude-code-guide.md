# Claude Code 使い方ガイド

## 基本操作

| 操作               | 方法                                  |
|--------------------|---------------------------------------|
| 起動               | `claude` または `claude <file>`       |
| 終了               | `/exit` または Ctrl+C                 |
| 会話クリア         | `/clear`                              |
| 設定確認           | `/config`                             |
| ヘルプ             | `/help`                               |

## キーボードショートカット

| ショートカット | 動作                         |
|----------------|------------------------------|
| Ctrl+Enter     | メッセージ送信（デフォルト） |
| Shift+Enter    | 改行                         |
| ↑/↓            | 入力履歴ナビゲーション       |
| Ctrl+C         | 実行中のツールを中断         |
| Ctrl+R         | 入力履歴検索                 |

## カスタムスラッシュコマンド

`~/.claude/commands/<name>.md` に Markdown ファイルを置くと `/name` で呼び出せる。

```markdown
# /my-command

## Steps
1. git diff を確認
2. レポートを生成
```

## フック

`~/.claude/settings.json` の `hooks` セクションで定義する。

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{"type": "command", "command": "~/.claude/hooks/PreToolUse/check.sh"}] }],
    "PostToolUse": [...],
    "Stop": [...],
    "Notification": [...]
  }
}
```

フックスクリプトは stdin で JSON を受け取り、`{"decision": "approve"}` または `{"decision": "block", "reason": "..."}` を stdout に出力する（PreToolUse の場合）。

## MCP サーバー

`~/.claude/mcp.json` に設定する。プロジェクトローカルは `.claude/mcp.json`。

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@my-scope/mcp-server"]
    }
  }
}
```

## CLAUDE.md の優先順位

1. `~/.claude/CLAUDE.md` — グローバル（全プロジェクト共通）
2. `<project-root>/CLAUDE.md` — プロジェクト固有
3. サブディレクトリの `CLAUDE.md` — 自動的にインポートされる

## permissions の設定

```json
{
  "permissions": {
    "allow": ["Bash(git *)", "Bash(npm test)"],
    "deny":  ["Bash(rm -rf *)"]
  }
}
```

パターンは `Tool(pattern)` 形式。ワイルドカード `*` が使える。
