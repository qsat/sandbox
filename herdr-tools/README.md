# herdr-tools

「Herdr × tmux エージェント運用 方式設計」の実装。エージェントを workspace > worktree > agent で一覧・移動・会話・再開する。

中心にあるのは **ws-core**。実行環境は herdr-core に一元化しているので、ws-core は herdr-core と ghq / git を
「事実の出どころ」として直接知っていて、その上に Workspace > Worktree > Agent のドメインとユースケースを持つ。
知らないのは、それを見せる・それに入るための**クライアント**（tmux と Herdr app）だけ。

```
herdr-tools/
├── utils/src/                    依存なしの共通関数（1ファイル1関数）
├── ws-core/src/                  ドメインとユースケース。herdr-core と ghq / git は知っていて、クライアントは知らない
│   ├── domain/
│   │   ├── agent.ts              AgentRecord → AgentNode、再開できるか、注意が要る順
│   │   ├── tree.ts               Workspace > Worktree > Agent の木
│   │   └── locate.ts             パス・id から木の場所を引く
│   ├── ports.ts                  AgentRuntime / WorkspaceSource（単体テストで偽物に差し替える継ぎ目）
│   ├── ws-core.ts                WsCore: snapshot / resume / startAgent / stopAgent / recordClaudeSessionFromHook / removeAgents
│   │   └── usage.ts              Claude の利用上限（5h / 週）の枠、期限切れの扱い
│   ├── claude-code.ts            会話の再開コマンド、SessionStart hook と statusLine の入力
│   ├── ghq-workspace-source.ts   WorkspaceSource の実装
│   └── herdr-core/               AgentRuntime の実装（hc-terminal: schema/hc.openrpc.json の Terminal、hc-client: JSON-RPC、herdr-runtime: 翻訳）
├── tmux/src/                     クライアント: tmux でエージェントへ移動し、会話する
│   ├── facts.ts                  tmux のセッション・ペイン・クライアント
│   ├── tmux-index.ts             木の worktree → セッション、エージェント → 会話ペイン
│   ├── plans/                    go（ws go の判断フロー）/ panes / prune。I/O なし
│   ├── navigator.ts              計画を TmuxServer と WsCore で実行する
│   ├── tmux-server.ts, ghostty.ts
│   ├── list-json.ts              ws list --json の形（ListedTree）
│   └── ui/                       rows（一覧の行）/ popup（ws ui）/ keys
├── herdr-app/                    クライアント: Herdr app の mod（ws を exec するだけ）
│   ├── src/agent-board/          board.ts（行と ws の呼び出し）/ main.ts（Herdr app の API）
│   ├── sync-types.sh, tsconfig.json   Herdr app が生成した型（types/、gitignore）で main.ts を検査する
│   ├── mod/agent-board/mod.json, layouts/agents.json
└── ws/                           CLI。cli.ts と compose-from-env.ts で全部をつなぐ
```

依存の向きは `ws → {ws-core, tmux}`、`tmux → ws-core`、`herdr-app → ws-core/domain`（I/O の無いモジュールだけ）、
全員 → `utils`。Bun workspaces でパッケージを分け、各パッケージの `node_modules` には宣言した依存しか入らない。
`test/architecture.test.ts` がこの向きと、utils の1ファイル1関数、mod のバンドルが Herdr app の API 以外を import しないことを検査する。

mod は TypeScript で書き、`bun build` で `herdr` / `gpui-kit` だけを外部 import に残した1ファイル（`dist/mods/agent-board/main.js`）にまとめる。
表示の部品（状態アイコン・文言・タグ）は utils にあり、tmux の popup と mod が同じものを使う。

会話ペインの印は tmux のペインオプション `@ws_agent`（値はエージェントの id）。
`ws list --json` は ws-core の木に tmux の情報を `tmux` キーで添えて出す（`worktree.tmux.session`、`worktree.tmux.panes`（会話ペイン以外の生きたペイン）、`agent.tmux.attached` / `agent.tmux.panes`）。

## セットアップ（手元の Mac）

1. 設計書の「実機確認項目」（M0）を確かめる。結果で直す場所は下の「実機確認の結果で直す場所」を参照
2. Herdr app（herdr-core を含む）を入れ、シェルで `hc ls` が動くことを確認する
3. `./install.sh`（`--dry-run` で内容だけ確認できる）
   - `ws` をビルドして `~/.local/bin/ws` に置く（`bun build --compile` の単一バイナリ）
   - mod をバンドル（`dist/mods/agent-board/`）して `~/.config/herdr-app/mods/agent-board/` に、レイアウトを `~/.config/herdr-app/layouts/agents.json` に置く
   - `herdr-app` があれば `herdr-app check` を通す
4. `ws/config/claude-settings.json` の SessionStart hook と statusLine を `~/.claude/settings.json` に足す
5. `tmux/config/tmux.conf` のキー（`prefix a` 一覧を枠線なしの popup で開く、`prefix A` 全ペイン表示、`prefix b` で次のエージェントへ巡回、`prefix B` で後ろへ巡回、`M-B` / `M-W` で prefix 無しの巡回）を `~/.tmux.conf` に足す
6. Herdr app のキーで巡回するには、`~/.config/herdr-app/keys.json` の `global` に次の 2 行を足す。Mac の option+b は普段 `∫` を入力するキーなので、Herdr app ではその入力ができなくなる
   ```json
   "alt-b": "agent-board.next",
   "shift-alt-b": "agent-board.prev"
   ```
7. Ghostty から同じキーを tmux へ送るには、Ghostty の設定に次の 2 行を足す。`M-B` / `M-W` として届くので、tmux の prefix に関係なく、`tmux.conf` の `bind -n M-B` / `bind -n M-W`（手順 5 で足す）で巡回する（`prefix b` / `prefix B` と同じ動き）
   ```
   keybind = alt+b=text:\x1bB
   keybind = shift+alt+b=text:\x1bW
   ```
   - （任意）手順 6・7 の代わりに skhd でキーを取ると、Herdr app と Ghostty のどちらが前にあっても同じ経路（`ws next --from-app` と `ws next --prev --from-app`）で巡回する。設定例は `tmux/config/skhdrc`（`alt - b` で次へ、`shift + alt - b` で後ろへ）。skhd に寄せるなら、手順 6・7 と `tmux.conf` の `bind -n M-B` / `M-W` は要らない（`prefix b` / `prefix B` は残してよい）。skhd は PATH が短いので、`ws` と、`ws` が呼ぶ `tmux` / `hc` / `ghq` / `git` が見つかる PATH を設定例のように書く。tmux のクライアントが複数あるときは、最後に使ったクライアントが移動する
8. 一覧だけの画面にしたければ `mod.json` を `{"place": "none"}` にし、`ctrl-shift-l` か `herdr-app do layout.switch '{"name":"agents"}'` で切り替える

## 使い方

| やりたいこと | tmux から | Herdr app から |
| --- | --- | --- |
| worktree を作る | `gwq add -b <branch>`（今までどおり） | — |
| その worktree に入る | `C-e`（tm）で選ぶ（今までどおり） | 一覧で worktree をクリック → Ghostty が前に出る |
| エージェントを起動する | `cc`（`ws new --here`。今のペインで会話）か `ws new --attach`（agents ウィンドウへ移る） | worktree の「＋ claude」ボタン |
| 待っているエージェントを探す | `prefix a`（blocked が先頭） | 一覧を見る（常時表示） |
| 注意が要るエージェントを次へ巡回する | `prefix b`、または Ghostty の `alt+b`（`ws next`）。列は blocked → done → idle の順で、同じ status の中は status になった時刻が新しい順（working は入れない）。無ければステータス行に表示 | `alt+b`（`ws next --from-app`） |
| 同じ列を後ろへ巡回する | `prefix B`、または Ghostty の `shift+alt+b`（`ws next --prev`） | `shift+alt+b`（`ws next --prev --from-app`） |
| そのエージェントと話す | 一覧で `Enter` → 会話ペインへ | クリック → Ghostty の会話ペインへ |
| 一覧をキーで操作する | 一覧で `j` / `k`（↓ / ↑）で選び、`Enter` 移動、`n` ＋ claude、`R` 再開、`s` 停止・削除、`x` セッションを閉じる（停止と閉じるは y で確かめる） | ボードを一度クリックしてから `j` / `k`（↓ / ↑）で選び、`Enter` 移動、`n` ＋ claude、`R` 再開、`s` 停止・削除、`x` セッションを閉じる（停止と閉じるは確認のダイアログを出す）。選んだ行は濃い黄色、今いるペイン（会話ペインならそのエージェント）の行は薄い黄色で示す |
| tmux のペインへ移動する | 一覧で worktree の下のペインの行（実行中のコマンド名。会話ペインと死んだペインは出ない）を `j` / `k` で選び `Enter`。または `ws go %12`。移動だけで、停止・閉じるは付かない | ペインの行をクリック（`Enter` でも移動） |
| worktree のエージェントを全部並べる | `prefix A`（`ws panes`）。会話ペインが無ければ開き、別のウィンドウ・セッションにあればそのペインを agents ウィンドウへ集める | — |
| 再起動後に続きをやる | 一覧で `R`（再開できる行に「R で再開」と出る）か `ws resume <agent>`。移動では再開しない | 「再開」ボタン |
| エージェントを止める | `ws stop <agent>`（止めて一覧から消す）。claude の中なら `/exit` | エージェントの停止ボタン（■ のアイコン。確認のダイアログで「停止する」か Enter で止める。「キャンセル」か Esc で取りやめる）。終了済みなら「削除」。再開できる行には停止ボタンを出さない（`s` では止められる） |
| worktree の tmux セッションを閉じる（エージェントは止めない） | 一覧で `x` → `y`。または `ws close [<worktree>]` | worktree の「閉じる」ボタン（tmux セッションがある行に出る。確認のダイアログで「閉じる」か Enter） |
| 片付ける | claude を `/exit` → `gwq remove` → 必要なら `ws prune` | — |

### コマンド

```text
ws list [--json] [--all]                         Workspace > Worktree > Agent の木（--all で ghq の全エントリ）
ws go <ref> [--client <name> | --from-app] [--dry-run]
                                                 移動。ref は worktree のパス（配下でも可）かアドレス／端末名
ws new [<worktree>] [--here | --attach] [--client <name> | --from-app] [-- <claude の引数>]
ws resume <agent>                                再開できるなら claude --resume <id> を送る（何度呼んでも安全）
ws stop <agent>                                  エージェントを止め、終了を待って一覧から消す（エージェントでない端末は触らない）
ws close [<ref>]                                 ref（既定は今いる worktree）の tmux セッションを閉じる。エージェントは herdr-core で動き続ける
ws panes [-a] [--pane <pane_id>] [--max <n>]     今の worktree のエージェントを agents ウィンドウに並べる（会話ペインが無ければ開き、他の場所にあれば移して集める）
ws next [--prev] [--pane <pane_id>] [--client <name> | --from-app] [--list]
                                                 blocked → done → idle の順の列（同じ status の中は status になった時刻が新しい順。working と動いていないものは除く）を巡回し、エージェントの会話ペインへ移動。押すたびに次へ、--prev で後ろへ（--list は移動せず、列を「ID・名前・status・status になった時刻・workspace・worktree」で順に出す。--from-app は移動後に Ghostty を前に出し、候補が無いときは標準エラーにも出す。--pane も TMUX_PANE も無いときは、移動に使うクライアントが表示しているペインを今いるペインとみなす）
ws ui [--client <name>]                          tmux popup 用の対話一覧
ws hook session-start                            Claude Code の SessionStart hook
ws statusline [--quiet]                          Claude Code の statusLine。5h / 週の利用上限を記録して表示する
ws prune [--dry-run] [--yes]                     場所が消えた worktree のセッションを閉じ、エージェントを確認のうえ終了
```

`ws ui` のキー: `j`/`k`（↑↓）移動、`Enter` 移動、`n` 新規エージェント、`R` 再開、`a` 全 worktree の表示切替、`r` 再読込、`q`/`Esc` 閉じる。
core のイベント（`events.subscribe`）で自動更新し、tmux 側の変化は3秒おきに拾う。

### ws go の判断

設計書の判断フローをそのまま `tmux/src/plans/go.ts` の `planGo` が手順（`Step`）のリストにし、`TmuxNavigator` が実行する（`--dry-run` で手順だけ見られる）。

1. セッションを用意（無ければ tm 規則 = basename、`.`→`_` で作る。同名があればそれを使う）
2. agent なら（移動では再開しない。再開は `ws resume`・ボタン・`R` だけで行う）: `@ws_agent` が一致する生きたペインがあればそれを選ぶ／無ければ `agents` ウィンドウに `hc attach` ペインを作る（無ければウィンドウごと）
3. tmux クライアントを切り替える: `--client` 指定 > `--from-app` なら最後に使われたクライアント > tmux 内なら呼び出し元 > tmux の外ならその場で `tmux attach`
4. app からなら Ghostty を前面へ（クライアントが1つも無ければ Ghostty の新しいウィンドウで attach）

### `cc`: herdr-core で起動して、今の端末で会話する

`claude` はそのままにして、herdr-core で動かしたいときは `cc` で起動する。`cc` は `ws new --here` のエイリアスで、
`ws/config/cc.sh` を `~/.zshrc` などから source する。`cc` に続けた引数は claude に渡る（`cc --model opus`）。

```sh
alias cc='ws new --here --'
```

- `ws new --here` は今の worktree で herdr-core に起動し、今の端末で `hc attach` する。tmux の中なら今のペインに `@ws_agent` を付け、一覧では会話中になる
- 抜ける（切り離す）と元のシェルに戻り、ペインの印を外す。エージェントは動き続け、一覧からまた会話に入れる
- herdr-core の端末の中（Herdr app のタブなど）で打つと、その端末の中に子端末を作って attach する。そこではそのまま `claude` を使う
- `cc` は C コンパイラの名前だが、エイリアスは対話シェルで打ったときだけ効くので、`make` などが呼ぶ `cc` には影響しない

#### 会話から抜ける: `prefix C-\`

`tmux/config/tmux.conf` の割り当て。会話中のペイン（`@ws_agent` がある）でだけ、`hc attach` の切り離しキー `Ctrl+\` をペインへ直接送る。
`send-keys` はキーの割り当てを通らないので、vim-tmux-navigator の `C-\` と競合しない。会話中でないペインでは何も送らず、メッセージだけ出す
（シェルや他のプログラムに `Ctrl+\`＝SIGQUIT を飛ばさない）。

```tmux
bind 'C-\' if-shell -F '#{@ws_agent}' "send-keys 'C-\\'" "display-message '会話中のペインではありません'"
```

#### vim-tmux-navigator を使っているときは、`C-\` を `hc attach` に通す

`hc attach` から抜けるキーは `Ctrl+\` だけで、変えられない。vim-tmux-navigator は `C-\` を「直前のペインへ移る」に割り当てていて、
tmux がキーを先に受け取るので、そのままでは会話中のペインから抜けられない（`cc` で入ったペインならシェルに戻れない）。

vim-tmux-navigator の「前面が vim なら、キーを tmux で使わずにそのまま送る」判定（`is_vim`）の正規表現に `hc` を足す。
こうすると `hc attach` が動いているペインでだけ `C-\` が届いて抜けられ、ほかのペインでは今までどおりペイン移動に使える。

```tmux
# ~/.tmux.conf の is_vim の正規表現に |hc を足す
is_vim="ps -o state= -o comm= -t '#{pane_tty}' \
    | grep -iqE '^[^TXZ ]+ +(\\S+\\/)?g?(view|l?n?vim?x?|fzf|hc)(diff)?$'"
bind-key -n 'C-\' if-shell "$is_vim" 'send-keys C-\\' 'select-pane -l'
```

- `C-h` / `C-j` / `C-k` / `C-l` も同じ `is_vim` を見るので、会話中のペインではそれらのキーもペイン移動ではなく claude に届く。
  会話中にペインを移るときは `prefix` と矢印キーなどを使う
- vim-tmux-navigator を TPM のプラグインとして読み込んでいる場合は、プラグインの読み込み（`run '~/.tmux/plugins/tpm/tpm'`）より後ろに
  上の2行を書いて、プラグインが付けた割り当てを上書きする
- 抜けたかどうかは、ペインがシェルに戻ること（`cc` の場合）か、一覧の「未attach」で分かる

### エージェントごとの context 使用率

`ws statusline` は、statusLine に渡される `context_window.used_percentage` を、自分の端末（`$HC_TERMINAL_ID`）の
`claude.context` ラベルに記録する（整数の % が変わったときだけ）。一覧ではエージェントの行に出す。

- tmux（`ws list`・popup）: `ctx 42%`
- Herdr app の mod: 利用上限と同じ円グラフ（マウスを乗せると `context 42%`）

利用上限と同じく、70% 以上で強調、90% 以上で警告の色。セッションの開始直後（値が null）、終了した端末、
claude が落ちて要再開になった端末（値が古い）には出さない。statusLine に `ws statusline` を設定したセッションだけが対象。

### tmux のセッション内のウィンドウを1つのウィンドウのペインにまとめる

`join-pane` で他のウィンドウのペインを今のウィンドウへ移す。ペインが無くなったウィンドウは自動で閉じる。
移す先を毎回「最後のペイン」にすると元の順番のまま並び、1回ごとに `tiled` で並べ直すとペインが多くても `pane too small` で失敗しない。

```sh
#!/usr/bin/env bash
# ~/.config/scripts/tmux-join-windows.sh <window_id>
target="$1"
for p in $(tmux list-panes -s -t "$target" -F '#{window_id} #{pane_id}' | awk -v w="$target" '$1 != w {print $2}'); do
  last=$(tmux list-panes -t "$target" -F '#{pane_id}' | tail -1)
  tmux join-pane -d -s "$p" -t "$last" && tmux select-layout -t "$target" tiled
done
```

```tmux
bind J run-shell "~/.config/scripts/tmux-join-windows.sh '#{window_id}'"
```

1枚ずつ別ウィンドウに戻すときは、標準の `prefix !`（`break-pane`）。

### Claude の利用上限（5h / 週）

Claude Code は statusLine のコマンドに `rate_limits.five_hour` / `rate_limits.seven_day`（使用率とリセット時刻）を渡す。
`ws statusline` がそれを herdr-core のドキュメント `claude-usage` に記録し（値が変わったときだけ）、
先頭に、消費した割合とリセットまでの残り時間を出す。
並びは 5時間枠 → 週の枠で、ラベルは付けない。週の残り時間は分を省く。
- `ws list`・popup（`prefix a`）: `24% 0d 2h 14m  41% 3d 5h`
- Herdr app の mod: `◔ 0d 2h 14m  ◕ 3d 5h` のように、% の代わりに円グラフ（1px のグレーの枠の上に消費した割合の扇形）。
  マウスを乗せると「5時間枠 24% 使用」と出る。
  扇形は `bun run build:mod` が 1〜100% の SVG を `dist/mods/agent-board/pie/` に生成する

消費が 70% 以上で強調、90% 以上で警告の色。リセット時刻を過ぎた枠は出さない。

- `rate_limits` が来るのは claude.ai の Pro / Max / Ultra だけで、セッションの最初の応答のあとから。API キーで使っているときは何も出ない
- 利用上限はアカウント単位なので、どのセッションの statusLine から記録しても同じ値になる
- statusLine をすでに自作しているなら、そのスクリプトから `ws statusline --quiet` に同じ入力を渡す（記録だけして何も出さない）。
  例: `input=$(cat); printf '%s' "$input" | ws statusline --quiet; printf '%s' "$input" | your-statusline`

### ラベル（herdr-core への記録。ドメインでは「本体リポジトリ・worktree・会話ID」として扱う）

| ラベル | 値 | 付けるもの |
| --- | --- | --- |
| `ws` | 本体リポジトリのパス | `ws new` |
| `wt` | worktree のパス | `ws new` |
| `claude.session` | Claude のセッションID | SessionStart hook（起動・再開・/clear・compact のたびに最新を指す） |
| `claude.context` | context の使用率（整数の %） | `ws statusline`（自分の端末に、値が変わったときだけ） |

ラベル無しで手で起動したエージェントは cwd から対応を推定する（git の toplevel で判定するので `repo` と `repo=branch` は混ざらない）。

herdr-core の端末のうちエージェントとして一覧に出すのは、次のどれかに当てはまるものだけ（`isAgentTerminal`）。
Herdr app で開いただけのシェルは出さない。

| 条件 | 理由 |
| --- | --- |
| 状態を報告したことがある（`reported` / `status`） | Herdr app もこれをエージェントの条件にしている |
| `ws` / `wt` のラベルがある | `ws new` が起動したもの。claude が落ちてシェルに戻っても、再開できるエージェントとして出す |
| 会話IDのラベルがある | SessionStart hook が記録したもの（手で起動した claude） |

`claude` コマンドで起動したのに一覧に出ないときは、次の順に確かめる。

| 状況 | 一覧に出ない理由 | 対処 |
| --- | --- | --- |
| tmux のペインや Ghostty で直接 `claude` を起動した | herdr-core の端末ではないので、herdr-core が知らない | `ws new`（tmux の popup なら `n`）か、Herdr app のタブから起動する |
| herdr-core の端末で起動したが、最初の応答の前 | 状態の報告も会話IDの記録もまだ無い | 最初のメッセージを送るか、SessionStart hook を設定する（起動直後にラベルが付く） |
| SessionStart hook を設定していない、または hook から `ws` が見つからない | 会話IDのラベルが付かない。状態の報告も無ければ出ない | `~/.claude/settings.json` の hook を確かめ、`ws` を PATH に置く。`WS_DEBUG=1` で hook の結果が stderr に出る |
| hook から `$HC_TERMINAL_ID` が見えない | 自分の端末が分からず、ラベルを付けられない | 実機確認項目。見えなければ hook は何もしない |
| 別の hc セッション（`HC_SESSION` / `--session`）の端末 | ws は既定のセッションにだけ繋ぐ | Herdr app と ws で同じセッションを使う |
| 状態を一度も報告せずに終わった | 終了後は状態が消え、ラベルも無い | `ws new` で起動すれば、終了後もラベルで一覧に残る |

一覧に出すリポジトリは、tmux のセッションかエージェントがあるもの（`--all` なら ghq の全エントリ）。
出したリポジトリについては、tmux のセッションやエージェントの有無に関わらず、`git worktree list` の worktree をすべて並べる
（bare の本体と、場所が消えた prunable の登録は並べない）。

## 実装時に決めたこと（設計書の未決事項に対する仮の既定）

| 項目 | 既定 | 変え方 |
| --- | --- | --- |
| `ws` が `hc connect` に渡す環境変数 | Claude Code のセッションの印（`CLAUDECODE`、`CLAUDE_CODE_CHILD_SESSION` など）を外す。claude の中で動いた `ws` が herdr-core を起動すると、その端末で起動した claude がトランスクリプトを保存しなくなるため | `utils/src/without-claude-code-session.ts` |
| `ws panes` に子エージェントを含めるか | 含めない（`-a` で含める） | フラグ |
| `ws panes` の並べ方 | `agents` ウィンドウに `tiled` | `Tmux.openAgentPane` / `Tmux.moveAgentPane` |
| `ws panes` で会話ペインが他の場所にあるとき | 開き直さず、そのペインを `agents` ウィンドウへ移す（`join-pane`。`agents` ウィンドウが無ければそのペインを切り出して作る）。移した元のウィンドウが空になれば閉じる | `plans/panes.ts` の `planPanes` |
| `ws panes` の上限 | 8（開くものと集めるものを合わせて、注意が要る順に選び、超えた分は省略と表示） | `--max` / `WS_PANES_MAX` |
| `ws panes` で再開できるエージェント | 再開しないで開く（`ws go` と同じ） | — |
| `ws prune` でエージェントを終了する条件 | 記録した worktree の場所が消えたもの。確認プロンプトで y のときだけ（`--yes` で省略） | ws-core の `agentsInMissingWorktrees` |
| 再開時のコマンド | `claude --resume <id>`（元の引数は引き継がない） | `WS_CLAUDE_BIN` |

自動で `ws panes` を開くこと、`C-\` が tmux に取られて `hc attach` を切り離せない件、同名リポジトリのセッション名衝突、メモリ表示、sbx は未着手（設計書どおり当面やらない／後で検討）。

## 実機確認の結果で直す場所

| 確認項目 | 実機の結果（2026-11-02、Herdr app 0.1.11） | 結果が想定と違ったら |
| --- | --- | --- |
| ラベルのキーに `.` を使える | 使える。hook が `claude.session` を書き、`terminal.list` で読めた | 使えなければ `WS_SESSION_LABEL=claude_session`（読み書きともこのキーだけを使う。既に記録した会話IDは引き継がれない） |
| kill -9 後もラベルが残り `foreground.name` がシェルになる | なる。keep 端末のプログラムを kill -9 すると、約 2 秒は `foreground` が無く（`reason: signaled`）、約 2.5 秒でシェル（`zsh`）に替わる。ラベルは残る | 残らなければセッションIDをファイルに保存する方式に変える（`HerdrRuntime.recordClaudeSession` / `toAgentRecord`） |
| hook から `$HC_TERMINAL_ID` が見える | 見える。Herdr app の端末で起動した claude に `claude.session` が付いた | 見えなければ hook は何もしない（`WS_DEBUG=1` で理由を stderr に出す） |
| API の形 | 合っている。`terminal.list` / `run` / `label` / `kill` / `rm` を実機で使った | `schema/hc.openrpc.json`（herdr-core リポジトリ）どおりに書いてある（`ws-core/src/herdr-core/hc-terminal.ts`）。実機で違えばそこと `hc-client.ts` を直す。hc とは `hc connect` の JSON-RPC だけで話し、接続は1本を使い回す。起動した端末のアドレスは `terminal.run` の返り値から取る |
| `open -na Ghostty --args -e tmux attach -t <session>` | まだ確かめていない（画面に Ghostty の窓が開くので、人が試す） | `tmux/src/ghostty.ts` の `ghosttyNewWindow` |
| mod の API（`gpui-kit.d.ts`。`herdr` モジュールを含む） | 合っている（gpui-shell 0.7.1） | アプリの更新で API が変わったら `bun run typecheck:mod` が型エラーを出すので、`main.ts` だけ直す。判断ロジック（`board.ts`）はテスト済み |

**mod の型**: Herdr app が `~/.config/herdr-app/mods/<mod>/gpui-kit.d.ts` を生成する。アプリの版ごとに変わり、
アプリ自身がコミットしないよう指示しているので、`herdr-app/sync-types.sh` が `herdr-app/types/`（gitignore）に写してから検査する。
この d.ts は `console` / `fetch` などをグローバルに宣言して bun の型とぶつかるため、`main.ts` だけ `herdr-app/tsconfig.json` で別に検査する。
mod を変えたら `bun run build:mod` のあと `herdr-app check ~/.config/herdr-app/mods/agent-board` を通し、`herdr-app shot` で表示を見る。

## 開発

```sh
bun install
bun test            # utils / ws-core（herdr-core の翻訳を含む）/ tmux / mod / アーキテクチャの検査
bun run typecheck   # 全体と mod（typecheck:mod。Herdr app を一度起動して生成された型が要る）
bun run e2e         # 偽の herdr-core（ws-core/test/fake-hc）と実際の tmux（専用ソケット）で全コマンドを通す。E2E_KEEP_TMP=1 で後片付けしない
bun run build       # dist/ws（単一バイナリ）と dist/mods/agent-board/（バンドルした mod）
bun run build:mod   # mod だけ
```

E2E は `git worktree` で `repo` と `repo=branch` を横並びに作り、tmux のコントロールモードのクライアントを切り替え対象にして、
list / new / hook / go（全分岐）/ resume / stop / panes / new --attach / prune / ui / close を確かめる。

環境変数: `HC_BIN`（hc のパス）、`WS_TMUX_SOCKET`（`tmux -L`）、`TMUX_BIN`、`GHQ_ROOT`、`GHQ_BIN`、`GIT_BIN`、`WS_SESSION_LABEL`、`WS_CLAUDE_BIN`、`WS_PANES_MAX`、`WS_DEBUG`。

クライアントを足すとき（別の端末マルチプレクサなど）は、ws-core の `WsCore` と木（`Tree` / `Locate`）だけを使って `tmux/` と同じ形で作る。ws-core には手を入れない。
