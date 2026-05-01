# init-claude

Claude Code の設定テンプレートとドキュメント集。

## ディレクトリ構成

```
init-claude/
├── README.md               # このファイル
├── docs/                   # ドキュメント
│   ├── claude-code-guide.md       # Claude Code 基本操作まとめ
│   ├── claude-md-best-practices.md # CLAUDE.md の書き方
│   └── hooks-guide.md             # フック実装ガイド
├── tools/                  # ユーティリティスクリプト
│   ├── install.sh          # _claude を ~/.claude にインストール
│   └── diff-with-live.sh   # リポジトリ設定 vs 実環境の差分確認
└── _claude/                # ~/.claude のテンプレート
    ├── CLAUDE.md           # グローバル Claude 指示（全プロジェクト共通）
    ├── settings.json       # permissions, hooks, env の設定
    ├── keybindings.json    # キーボードショートカット
    ├── mcp.json            # MCP サーバー設定
    ├── commands/           # カスタムスラッシュコマンド
    │   ├── review.md       # /review — コードレビュー
    │   ├── standup.md      # /standup — スタンドアップレポート
    │   └── cleanup.md      # /cleanup — PR前チェック
    ├── hooks/              # フックスクリプト
    │   ├── PreToolUse/
    │   │   └── safety-check.sh     # 危険コマンドをブロック
    │   ├── Stop/
    │   │   └── git-status-check.sh # 応答後に git status を表示
    │   └── Notification/
    │       └── desktop-notify.sh   # デスクトップ通知
    └── skills/             # カスタムスキル
        └── example-skill/
            └── SKILL.md
```

## クイックスタート

```bash
# 1. ドライランで確認
./tools/install.sh --dry-run

# 2. ~/.claude にインストール
./tools/install.sh

# 3. 既存の ~/.claude との差分確認
./tools/diff-with-live.sh
```

## CLAUDE.md について

`_claude/CLAUDE.md` はグローバル設定（全プロジェクト共通のルール）。  
プロジェクト固有の設定は各プロジェクトルートの `CLAUDE.md` に書く。

詳細: [docs/claude-md-best-practices.md](docs/claude-md-best-practices.md)
