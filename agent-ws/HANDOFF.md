# agent-ws 開発の引き継ぎ

agent-ws.zip（TypeScript プロジェクト一式）を添付しています。以下は前回までの経緯です。読んだうえで続きを手伝ってください。

## 目的
AI エージェント（主に Claude Code）を複数の git worktree で並行して動かすための、tmux 常駐型の管理 CLI です。
- 表示の階層は「リポジトリ > worktree > プロセス（エージェント > サブエージェント）」
- リポジトリは ghq 管理。worktree はブランチごとにフラットに展開している（置き場所は `git worktree list` から取るので、命名は問わない）
- 常駐表示は tmux（neovim ではなく）。ポップアップとステータスラインで使う

## できること（cli.ts のサブコマンド）
- `list [query] [--all] [--agents-only] [--json]`: 一覧を1回表示する。既定では「追加 worktree がある、または何か動いている」リポジトリだけを出す
- `watch [query] [--interval=2] [--popup]`: 常駐表示。j/k で選択、Enter でそのペイン／ウィンドウへ移動、r で再読込、q で終了。`--popup` を付けると移動後に終了する
- `status [--tmux]`: ステータスライン用の1行（例: 🤖3 ⏳1 ✓2 ⤷2）。状態ファイルしか読まないので軽い
- `jump <pid|path> [--create] [--dry-run]`: その pid（の祖先）やパスがいる tmux ペインへ移動する
- `hook`: Claude Code の hook から呼ばれる（stdin に JSON）
- `hooks-config`: `~/.claude/settings.json` に足す hooks 設定を出力する

状態は ready（入力待ち）/ running（実行中）/ waiting（許可待ち）/ error（エラー）の4つ。サブエージェントは running / waiting / done。
waiting・ready・error への遷移で通知する（tmux の display-message と、osascript または notify-send）。通知する状態は `AGENT_WS_NOTIFY` で絞れる。

## 構成（依存は矢印の向きだけ）
    cli.ts ─┬→ src/app.ts ─┬→ src/domain.ts   型と純粋なルール（I/O なし、単体テストあり）
            │              └→ src/infra/*     git・proc・store・tmux・notify・shell
            └→ src/ui/*  ───→ src/domain.ts   view（行モデル）・terminal（色と幅）・watch（対話）

- `domain.ts`: Repository / Worktree / Proc / Session / Subagent / Pane の型。エージェント判定（detectAgent）、cwd の最長一致による worktree への割り当て、hook イベントから次の状態への遷移（applyHook）、移動先ペインの特定（findPane）
- `app.ts`: ユースケース（loadRepositories / snapshot / loadSessions / handleHook / jump / hooksConfig）
- `ui/view.ts`: ドメインを `Row`/`Cell` に変換する。色ではなく意味のトーン（ok / warn / waiting など）を持つ。罫線ツリーは汎用の flatten で描く。最初に選ぶ行は `priority` で示す
- `ui/terminal.ts`: トーンを ANSI か tmux の `#[fg=]` に変換し、表示幅（全角は2桁）で切り詰める
- `ui/watch.ts`: 行の取得・移動・再読込を関数で受け取る TUI（git や tmux の中身は知らない）

## 設計判断とその理由
- プロセスがどの worktree に属するかは、プロセスの cwd で判定する（Linux は /proc/<pid>/cwd、macOS は lsof）
- リポジトリはメイン worktree のパスで束ねる。フラット展開の worktree が ghq 配下にあっても重複しない
- dirty 件数（git status）は表示する worktree だけ数える。watch ではリポジトリ構成を15秒キャッシュし、プロセスと状態は毎回取り直す
- hook は全イベント共通の1コマンドにし、何が起きたかは `hook_event_name` で判断する。登録するイベントは domain.ts の `HOOK_EVENTS`（SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, Notification, Stop, StopFailure, SubagentStart, SubagentStop, SessionEnd）
- 状態ファイルは `~/.local/state/agent-ws/sessions/` に置く。セッションごとに `<id>.json`、サブエージェントは並列に書かれるので1体1ファイル（`<id>.sub.<agent>.json`）。書き込みは tmp ファイルからの rename
- claude 本体の pid は、hook プロセスの祖先を辿って記録する。pid が死んだセッションは読み込み時に掃除する
- サブエージェントは本体プロセスの中で動くので、hook の `agent_id` でだけ観測できる。サブエージェントの許可待ちは本体にも「[type] …」として反映し、そのサブエージェントの PostToolUse で解除する
- tmux は -F 出力中のタブ（ロケールによっては非 ASCII も）を `_` に置き換えるので、区切りは ASCII の `|~|` にしている
- 移動先: pid の祖先が pane_pid に当たるペイン → そのパスにいるペイン → （watch か --create のとき）新しいウィンドウ

## セットアップ
- `bun cli.ts hooks-config` の出力を `~/.claude/settings.json` の hooks にマージする
- tmux: `bind a display-popup -E -w 90% -h 80% "bun ~/path/agent-ws/cli.ts watch --popup"` と `set -g status-right "#(bun ~/path/agent-ws/cli.ts status --tmux)"`
- 実行環境は Bun（.ts をそのまま実行する）。実行時の依存はない。開発時だけ typescript と @types/bun を使う（`bun install`）
- Node 22.18 から Bun に移した。Bun 固有の API は `Bun.spawnSync`（infra/shell.ts）、`Bun.stdin`（cli.ts の hook）、`bun:test` の3か所だけで、残りは Bun が互換実装している node:* をそのまま使っている

## 検証状況
- 済み: tsc（strict）が通る。単体テスト5件（`bun test`）が通る。tmux 3.4 に偽 claude プロセスを置いた E2E（一覧、サブエージェント、jump、watch の Enter、新規ウィンドウ、--popup、SessionEnd 時の掃除、LC_ALL=C）が動く
- 未検証:
  - 本物の Claude Code の hook 入力。Notification の種別フィールド名（notification_type?）や SubagentStart の入力は、ドキュメントが途中で切れて未確認。stdin をファイルにダンプして確かめるのが早い
  - macOS での通知と lsof 経路
  - codex など claude 以外のエージェントの応答状況（現状は「? 状態不明」）

## 保留中の論点
1. コード量: 1ファイル771行を層分けして904行に増えた（コメント・空行を除く）。減らすなら機能を削るしかない。候補は、エージェント以外のプロセス表示、--json、ghq が無い環境向けの走査、claude と codex 以外の判定。どれを削るかはまだ決めていない
2. 子プロセスを ppid でエージェントの下にネストする案（リポジトリ > worktree > エージェント > 子プロセス）。提案したが未回答
3. ペインが無い worktree の新しいウィンドウを今いるセッションに作っている。リポジトリ名のセッションに作るかどうか
4. PostToolUse のたびに hook のプロセスが起動する。Bun にしたことで1回あたり約135ms（Node）から約32msに縮んだ（手元で10回連続実行して計測）。まだ気になるなら軽量化を検討する
