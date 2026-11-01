# herdr-tools

「Herdr × tmux エージェント運用 方式設計」の実装。エージェントの実行は herdr-core に一元化し、
Bun/TypeScript 製の **ws CLI** を共通のナビゲーション層として、Herdr app の mod と tmux の popup の
どちらからでも同じ操作で一覧・移動・会話・再開ができるようにする。

```
Herdr app mod ─exec─┐            ┌─ hc（JSON-RPC / CLI）… エージェントの実行・状態・ラベル・イベント
                    ├→ ws CLI ───┼─ tmux …………………………… セッション・ウィンドウ・会話ペイン（hc attach）
tmux popup ─────────┘ （判断は    └─ git / ghq ……………………… worktree の場所、本体リポジトリで束ねる
 (ws ui)              ここだけ）
```

事実は herdr-core と tmux が持ち、判断は ws に集め、フロントは表示と入力だけを持つ。ws は自前の状態ファイルを持たない。

## ディレクトリ

| パス | 中身 | 設計書のマイルストーン |
| --- | --- | --- |
| `ws/src/domain.ts` | 型と純粋なルール（I/O なし）。グループ化、Agent と Worktree の対応、要再開・未 attach・場所消失の導出、セッション名規則、端末名の slug 化、`ws go` / `ws panes` / `ws prune` の計画 | M1 |
| `ws/src/infra/` | `hc.ts`（`hc connect` で JSON-RPC、操作は CLI）、`tmux.ts`、`git.ts`（git / ghq / Ghostty）、`exec.ts` | M1 |
| `ws/src/app.ts` | list / go / new / resume / panes / hookSessionStart / prune。domain の計画を infra で実行 | M1〜M3, M5, M7 |
| `ws/src/ui/` | `view.ts`（行モデル）、`popup.ts`（`ws ui` の対話 TUI） | M4 |
| `ws/cli.ts` | エントリポイント | — |
| `ws/test/` | `bun test` の単体テスト、スタブの hc（`stub/`）、実 tmux での E2E（`e2e.sh`） | — |
| `mod/agent-board/` | Herdr app の mod（`main.js`、`mod.json`） | M6 |
| `layouts/agents.json` | 一覧だけの画面（agents レイアウト） | M6 |
| `config/` | `~/.tmux.conf` と `~/.claude/settings.json` に足す内容 | M2, M4 |
| `install.sh` | ビルドと配置（dotfiles 側のファイルは書き換えず、追記内容を表示する） | — |

依存は `cli.ts → app.ts → domain.ts / infra/*`、`ui/* → domain.ts` の向きだけ。

## セットアップ（手元の Mac）

1. 設計書の「実機確認項目」（M0）を確かめる。結果で直す場所は下の「実機確認の結果で直す場所」を参照
2. Herdr app（herdr-core を含む）を入れ、シェルで `hc ls` が動くことを確認する
3. `./install.sh`（`--dry-run` で内容だけ確認できる）
   - `ws` をビルドして `~/.local/bin/ws` に置く（`bun build --compile` の単一バイナリ）
   - mod を `~/.config/herdr-app/mods/agent-board/` に、レイアウトを `~/.config/herdr-app/layouts/agents.json` に置く
   - `herdr-app` があれば `herdr-app check` を通す
4. `config/claude-settings.json` の SessionStart hook を `~/.claude/settings.json` に足す
5. `config/tmux.conf` のキー（`prefix a` 一覧、`prefix A` 全ペイン表示）を `~/.tmux.conf` に足す
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

設計書の判断フローをそのまま `domain.planGo` が手順のリストにし、`app.execute` が実行する（`--dry-run` で手順だけ見られる）。

1. セッションを用意（無ければ tm 規則 = basename、`.`→`_` で作る。同名があればそれを使う）
2. agent なら: 要再開なら再開（C）→ `@hc` が一致する生きたペインがあればそれを選ぶ／無ければ `agents` ウィンドウに `hc attach` ペインを作る（無ければウィンドウごと）
3. tmux クライアントを切り替える: `--client` 指定 > `--from-app` なら最後に使われたクライアント > tmux 内なら呼び出し元 > tmux の外ならその場で `tmux attach`
4. app からなら Ghostty を前面へ（クライアントが1つも無ければ Ghostty の新しいウィンドウで attach）

### ラベル

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
| `ws panes` の並べ方 | `agents` ウィンドウに `tiled` | `tmux.openAttachPane` |
| `ws panes` の上限 | 8（注意が要る順に開き、超えた分は省略と表示） | `--max` / `WS_PANES_MAX` |
| `ws panes` の要再開 | 開く前に再開する（`ws go` と同じ） | — |
| `ws prune` でエージェントを終了する条件 | ラベル `wt` の場所が消えたもの。確認プロンプトで y のときだけ（`--yes` で省略） | `domain.planPrune` |
| 再開時のコマンド | `claude --resume <id>`（元の引数は引き継がない） | `WS_CLAUDE_BIN` |

自動で `ws panes` を開くこと、`C-\` が tmux に取られて `hc attach` を切り離せない件、同名リポジトリのセッション名衝突、メモリ表示、sbx は未着手（設計書どおり当面やらない／後で検討）。

## 実機確認の結果で直す場所

| 確認項目 | 結果が想定と違ったら |
| --- | --- |
| ラベルのキーに `.` を使える | 使えなければ `WS_SESSION_LABEL=claude_session`（読む側は両方見る） |
| kill -9 後もラベルが残り `foreground.name` がシェルになる | 残らなければセッションIDをファイルに保存する方式に変える（`app.hookSessionStart` と `domain.needsResume`） |
| hook から `$HC_TERMINAL_ID` が見える | 見えなければ hook は何もしない（`WS_DEBUG=1` で理由を stderr に出す） |
| `terminal.list` の返り値の形 | `infra/hc.ts` の `normalizeTerminal` / `terminalsFromResult` で吸収。RPC が失敗したら `hc ls --json` にフォールバックする（その場合ラベルが無く cwd から推定） |
| `hc run --bg` の出力 | 出力には依存せず、起動後に名前で引き直してアドレスを得る |
| `open -na Ghostty --args -e tmux attach -t <session>` | `infra/git.ts` の `ghosttyNewWindow` |
| mod の API（`herdr.d.ts` / `gpui-kit.d.ts`） | `mod/agent-board/main.js` の「[2] アダプタ」だけ直す。判断ロジック（[1]）はテスト済み |

**mod の注意**: この環境には Herdr app が無いため、`main.js` の描画部分（[2] アダプタ）は設計書に書かれた API 名
（`terminals()` / `exec()` / `shared` / `setShared` / cx のタイマー）を元にした下書き。UI 部品の呼び方（`ui.div()…` など）は
手元の `gpui-kit.d.ts` に合わせて直し、`herdr-app check` を通すこと。行の組み立てと ws の呼び出し方（[1]）はテスト済みで、そのまま使える。

## 開発

```sh
cd ws
bun install
bun run test        # domain / view / hc 正規化の単体テスト
bun run test:mod    # mod の純粋ロジック
bun run typecheck
bun run e2e         # スタブの hc（test/stub）と実際の tmux（専用ソケット）で全コマンドを通す
bun run build       # dist/ws（単一バイナリ）
```

E2E は `git worktree` で `repo` と `repo=branch` を横並びに作り、tmux のコントロールモードのクライアントを切り替え対象にして、
list / new / hook / go（全分岐）/ resume / panes / new --attach / prune / ui を確かめる。

環境変数: `HC_BIN`（hc のパス）、`WS_TMUX_SOCKET`（`tmux -L`）、`GHQ_ROOT`、`GHQ_BIN`、`WS_SESSION_LABEL`、`WS_CLAUDE_BIN`、`WS_PANES_MAX`、`WS_DEBUG`。
