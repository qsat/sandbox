# herdr-tools

「Herdr × tmux エージェント運用 方式設計」の実装。エージェントを workspace > worktree > agent で一覧・移動・会話・再開する。

中心にあるのは **ws-core**（ドメインとユースケース）で、tmux も herdr も知らない。
herdr-core はエージェントを動かす「実行環境」として、tmux と Herdr app は「見せ方・入り方」としてその外側につながる。

```
                 ┌──────────── ws CLI（コンポジションルート: つなぐだけ）────────────┐
                 │                                                                   │
 Herdr app mod ──exec──→  tmux/（クライアント）            herdr/（実行環境の実装）
 (herdr/mod)              セッション・ペイン・popup          HerdrRuntime: hc の JSON-RPC / CLI
                          ws go / ws panes の計画            ラベル・端末名規則・$HC_TERMINAL_ID
                                │                                  │ implements
                                ▼                                  ▼
                 ws-core: Workspace > Worktree > Agent ── ports: AgentRuntime / WorkspaceSource
                          状態の導出・参照の解決・再開・起動・会話IDの記録・片付け
                          （WorkspaceSource の git / ghq 実装も持つ）
```

依存の向きは `ws → {ws-core, herdr, tmux}`、`herdr → ws-core`、`tmux → ws-core` だけ。
Bun workspaces でパッケージを分け、各パッケージの `node_modules` には宣言した依存しか入らない。
さらに `test/architecture.test.ts` が import と識別子を検査する（ws-core に tmux / herdr / hc が出てこない、tmux に herdr / hc が出てこない）。

## ディレクトリ

| パス | 中身 |
| --- | --- |
| `ws-core/src/model.ts` | ドメインの型（`AgentRecord` / `AgentNode` / `WorktreeNode` / `WorkspaceNode`）と純粋なルール（要再開・注意の順・パス境界） |
| `ws-core/src/tree.ts` | 木の組み立て、生のパスからの worktree 特定（`makeLocator`）、参照の解決、片付けの計画 |
| `ws-core/src/ports.ts` | `AgentRuntime`（起動・一覧・送信・会話IDの記録・購読・会話に入るコマンド）と `WorkspaceSource` |
| `ws-core/src/service.ts` | `WsCore`: snapshot / resolve / resume / newAgent / recordSessionFromHook / prune |
| `ws-core/src/claude.ts` | Claude Code の知識（`claude --resume <id>`、SessionStart hook の入力） |
| `ws-core/src/adapters/git.ts` | `WorkspaceSource` の ghq / git 実装 |
| `herdr/src/runtime.ts` | `HerdrRuntime`: herdr-core の言葉（ラベル `ws` / `wt` / `claude.session`、端末名規則、foreground がシェル＝プログラム喪失）と ws-core の言葉の翻訳 |
| `herdr/src/hc.ts` | hc クライアント（`hc connect` の JSON-RPC、CLI、返り値の正規化） |
| `herdr/mod/agent-board/`, `herdr/layouts/` | Herdr app の mod とレイアウト（`ws list --json` の利用者） |
| `herdr/test/stub/` | E2E 用のスタブ herdr-core |
| `tmux/src/model.ts` | tmux の事実（セッション・ペイン・クライアント）、木への索引、`ws go` / `ws panes` の計画、tm のセッション名規則 |
| `tmux/src/navigator.ts` | `TmuxNavigator`: 計画を tmux で実行。再開は `WsCore.resume`、会話ペインのコマンドは `AgentRuntime.attachCommand` から受け取る |
| `tmux/src/tmux.ts`, `ghostty.ts` | tmux コマンド、Ghostty（tmux を表示する端末） |
| `tmux/src/ui/` | 行モデルと popup（`ws ui`） |
| `tmux/config/tmux.conf` | `~/.tmux.conf` に足すキー |
| `ws/cli.ts`, `ws/src/compose.ts` | CLI とコンポジションルート |
| `ws/config/claude-settings.json` | `~/.claude/settings.json` に足す SessionStart hook |
| `ws/test/e2e.sh` | スタブ herdr-core と実際の tmux での E2E |

会話ペインの印は tmux のペインオプション `@ws_agent`（値はエージェントの id）。`ws list --json` は ws-core の木に、tmux の情報を `tmux` キーで添えて出す（`worktree.tmux.session`、`agent.tmux.attached` / `agent.tmux.panes`）。

## セットアップ（手元の Mac）

1. 設計書の「実機確認項目」（M0）を確かめる。結果で直す場所は下の「実機確認の結果で直す場所」を参照
2. Herdr app（herdr-core を含む）を入れ、シェルで `hc ls` が動くことを確認する
3. `./install.sh`（`--dry-run` で内容だけ確認できる）
   - `ws` をビルドして `~/.local/bin/ws` に置く（`bun build --compile` の単一バイナリ）
   - mod を `~/.config/herdr-app/mods/agent-board/` に、レイアウトを `~/.config/herdr-app/layouts/agents.json` に置く
   - `herdr-app` があれば `herdr-app check` を通す
4. `ws/config/claude-settings.json` の SessionStart hook を `~/.claude/settings.json` に足す
5. `tmux/config/tmux.conf` のキー（`prefix a` 一覧、`prefix A` 全ペイン表示）を `~/.tmux.conf` に足す
6. 一覧だけの画面にしたければ `mod.json` を `{"place": "none"}` にし、`ctrl-shift-l` か `herdr-app do layout.switch '{"name":"agents"}'` で切り替える

## 使い方

| やりたいこと | tmux から | Herdr app から |
| --- | --- | --- |
| worktree を作る | `gwq add -b <branch>`（今までどおり） | — |
| その worktree に入る | `C-e`（tm）で選ぶ（今までどおり） | 一覧で worktree をクリック → Ghostty が前に出る |
| エージェントを起動する | `ws new --attach` | worktree の「新規」ボタン |
| 待っているエージェントを探す | `prefix a`（blocked が先頭） | 一覧を見る（常時表示） |
| そのエージェントと話す | 一覧で `Enter` → 会話ペインへ | クリック → Ghostty の会話ペインへ |
| worktree のエージェントを全部並べる | `prefix A`（`ws panes`） | — |
| 再起動後に続きをやる | 一覧で「要再開」を選ぶだけ（移動時に自動で再開） | 「再開」ボタン |
| 片付ける | claude を `/exit` → `gwq remove` → 必要なら `ws prune` | — |

### コマンド

```text
ws list [--json] [--all]                         Workspace > Worktree > Agent の木（--all で ghq の全エントリ）
ws go <ref> [--client <name> | --from-app] [--dry-run]
                                                 移動。ref は worktree のパス（配下でも可）かアドレス／端末名
ws new [<worktree>] [--attach] [--client <name> | --from-app] [-- <claude の引数>]
ws resume <agent>                                要再開なら claude --resume <id> を送る（何度呼んでも安全）
ws panes [-a] [--pane <pane_id>] [--max <n>]     今の worktree のエージェントを agents ウィンドウに並べる
ws ui [--client <name>]                          tmux popup 用の対話一覧
ws hook session-start                            Claude Code の SessionStart hook
ws prune [--dry-run] [--yes]                     場所が消えた worktree のセッションを閉じ、エージェントを確認のうえ終了
```

`ws ui` のキー: `j`/`k`（↑↓）移動、`Enter` 移動、`n` 新規エージェント、`R` 再開、`a` 全 worktree の表示切替、`r` 再読込、`q`/`Esc` 閉じる。
core のイベント（`events.subscribe`）で自動更新し、tmux 側の変化は3秒おきに拾う。

### ws go の判断

設計書の判断フローをそのまま `tmux/src/model.ts` の `planGo` が手順のリストにし、`TmuxNavigator.execute` が実行する（`--dry-run` で手順だけ見られる）。

1. セッションを用意（無ければ tm 規則 = basename、`.`→`_` で作る。同名があればそれを使う）
2. agent なら: 要再開なら再開（C。`WsCore.resume`）→ `@ws_agent` が一致する生きたペインがあればそれを選ぶ／無ければ `agents` ウィンドウに `hc attach` ペインを作る（無ければウィンドウごと）
3. tmux クライアントを切り替える: `--client` 指定 > `--from-app` なら最後に使われたクライアント > tmux 内なら呼び出し元 > tmux の外ならその場で `tmux attach`
4. app からなら Ghostty を前面へ（クライアントが1つも無ければ Ghostty の新しいウィンドウで attach）

### ラベル（herdr の実装の中だけの話。ws-core は「本体リポジトリ・worktree・会話ID」としてだけ扱う）

| ラベル | 値 | 付けるもの |
| --- | --- | --- |
| `ws` | 本体リポジトリのパス | `ws new` |
| `wt` | worktree のパス | `ws new` |
| `claude.session` | Claude のセッションID | SessionStart hook（起動・再開・/clear・compact のたびに最新を指す） |

ラベル無しで手で起動したエージェントは cwd から対応を推定する（git の toplevel で判定するので `repo` と `repo=branch` は混ざらない）。

## 実装時に決めたこと（設計書の未決事項に対する仮の既定）

| 項目 | 既定 | 変え方 |
| --- | --- | --- |
| `ws panes` に子エージェントを含めるか | 含めない（`-a` で含める） | フラグ |
| `ws panes` の並べ方 | `agents` ウィンドウに `tiled` | `Tmux.openAgentPane` |
| `ws panes` の上限 | 8（注意が要る順に開き、超えた分は省略と表示） | `--max` / `WS_PANES_MAX` |
| `ws panes` の要再開 | 開く前に再開する（`ws go` と同じ） | — |
| `ws prune` でエージェントを終了する条件 | 記録した worktree の場所が消えたもの。確認プロンプトで y のときだけ（`--yes` で省略） | ws-core の `planPrune` |
| 再開時のコマンド | `claude --resume <id>`（元の引数は引き継がない） | `WS_CLAUDE_BIN` |

自動で `ws panes` を開くこと、`C-\` が tmux に取られて `hc attach` を切り離せない件、同名リポジトリのセッション名衝突、メモリ表示、sbx は未着手（設計書どおり当面やらない／後で検討）。

## 実機確認の結果で直す場所

| 確認項目 | 結果が想定と違ったら |
| --- | --- |
| ラベルのキーに `.` を使える | 使えなければ `WS_SESSION_LABEL=claude_session`（読む側は両方見る） |
| kill -9 後もラベルが残り `foreground.name` がシェルになる | 残らなければセッションIDをファイルに保存する方式に変える（`HerdrRuntime.recordSession` / `toAgentRecord`） |
| hook から `$HC_TERMINAL_ID` が見える | 見えなければ hook は何もしない（`WS_DEBUG=1` で理由を stderr に出す） |
| `terminal.list` の返り値の形 | `herdr/src/hc.ts` の `normalizeTerminal` で吸収。RPC が失敗したら `hc ls --json` にフォールバックする（その場合ラベルが無く cwd から推定） |
| `hc run --bg` の出力 | 出力には依存せず、起動後に名前で引き直してアドレスを得る |
| `open -na Ghostty --args -e tmux attach -t <session>` | `tmux/src/ghostty.ts` の `ghosttyNewWindow` |
| mod の API（`herdr.d.ts` / `gpui-kit.d.ts`） | `herdr/mod/agent-board/main.js` の「[2] アダプタ」だけ直す。判断ロジック（[1]）はテスト済み |

**mod の注意**: この環境には Herdr app が無いため、`main.js` の描画部分（[2] アダプタ）は設計書に書かれた API 名
（`terminals()` / `exec()` / `shared` / `setShared` / cx のタイマー）を元にした下書き。UI 部品の呼び方（`ui.div()…` など）は
手元の `gpui-kit.d.ts` に合わせて直し、`herdr-app check` を通すこと。行の組み立てと ws の呼び出し方（[1]）はテスト済みで、そのまま使える。

## 開発

```sh
bun install
bun test            # ws-core / herdr / tmux / mod / アーキテクチャの検査
bun run typecheck
bun run e2e         # スタブの herdr-core と実際の tmux（専用ソケット）で全コマンドを通す
bun run build       # dist/ws（単一バイナリ）
```

E2E は `git worktree` で `repo` と `repo=branch` を横並びに作り、tmux のコントロールモードのクライアントを切り替え対象にして、
list / new / hook / go（全分岐）/ resume / panes / new --attach / prune / ui を確かめる。

環境変数: `HC_BIN`（hc のパス）、`WS_TMUX_SOCKET`（`tmux -L`）、`TMUX_BIN`、`GHQ_ROOT`、`GHQ_BIN`、`GIT_BIN`、`WS_SESSION_LABEL`、`WS_CLAUDE_BIN`、`WS_PANES_MAX`、`WS_DEBUG`。

別の実行環境やクライアントを足すとき: 実行環境は `AgentRuntime` を実装して `ws/src/compose.ts` で差し替える。クライアントは ws-core の `WsCore` と木（`Tree` / `Locate`）だけを使って作る。
