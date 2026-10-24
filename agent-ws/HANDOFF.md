# agent-ws 開発の引き継ぎ

agent-ws.zip（TypeScript プロジェクト一式）を添付しています。以下は前回までの経緯です。読んだうえで続きを手伝ってください。

## 目的
AI エージェント（主に Claude Code）を複数の git worktree で並行して動かすための、tmux 常駐型の管理 CLI です。
- 表示の階層は「リポジトリ > worktree > プロセス（エージェント > サブエージェント）」
- リポジトリは ghq 管理。worktree はブランチごとにフラットに展開している（置き場所は `git worktree list` から取るので、命名は問わない）
- 常駐表示は tmux（neovim ではなく）。ポップアップとステータスラインで使う

## できること（src/entry/cli.ts のサブコマンド）
- `list [query] [--all] [--agents-only] [--json]`: 一覧を1回表示する。既定では「追加 worktree がある、または何か動いている」リポジトリだけを出す
- `watch [query] [--interval=2] [--popup]`: 常駐表示。j/k で選択、Enter でそのペイン／ウィンドウへ移動、r で再読込、q で終了。`--popup` を付けると移動後に終了する
- `status [--tmux]`: ステータスライン用の印。対応が要るものの有無だけを出し、何も無ければ空（⏳ 許可待ち / ❓ 質問待ち / ✓ 完了して未確認 / ✗ エラー）。中身はポップアップ（`watch --popup`）で見る。セッションのログしか読まないので軽い
- `seen <pane_pid>`: そのペインで完了したセッションを既読にする。tmux の pane-focus-in から呼ぶ
- `jump <pid|path> [--create] [--dry-run]`: その pid（の祖先）やパスがいる tmux ペインへ移動する
- `hook`: Claude Code の hook から呼ばれる（stdin に JSON）
- `hooks-config`: `~/.claude/settings.json` に足す hooks 設定を出力する

状態は ready（入力待ち）/ running（実行中）/ waiting（許可待ち）/ asking（質問待ち）/ error（エラー）の5つ。サブエージェントは running / waiting / done。
ターンが完了した ready には「未確認」（`unseen`）が付き、一覧では「✓ 完了」と出る。次のプロンプト・そのペインへのフォーカス・ポップアップからの移動で消える。
waiting・asking・ready・error への遷移で通知する（tmux の display-message と、osascript または notify-send）。通知する状態は `AGENT_WS_NOTIFY` で絞れる。

## 構成（Redux Toolkit・re-ducks。依存は矢印の向きだけ）
    src/entry/*（初期化）─┬→ src/redux/createStore.ts・src/redux/modules/{slug}/{slice,selector,listener}.ts
                         │        └→ src/domain/model.ts（純粋）・src/claude/hook.ts（Claude Code の入力の境界）・src/infra/*（I/O）
                         └→ src/ui/*（表示）

    entry ─ dispatch(意図) ─→ middleware ─┬→ listener     意図に反応して I/O し、結果を事実のアクションで戻す
                                          └→ persistence  セッションのアクションを、状態が変わったときだけログに追記

    src/
      entry/        cli.ts（引数の解析と振り分け）・コマンドごとの初期化（list / watch / status / seen / jump / hook）・store.ts
      redux/
        createStore.ts   Store のファクトリ（reducer と middleware だけ）・addAppListener・listen
        middlewares/     persistence.ts
        modules/
          sessions/      セッション集約（本体＋サブエージェント）。ログの読み込み・取り込み・掃除・hook・既読化
          workspace/     リポジトリ構成・プロセス・変更件数とそのスキャン。ツリーを組み立てる selector
          navigation/    ペインへの移動と、その結果（jumped）
          notification/  通知する遷移（selector）と通知（listener）。状態は持たない
          statusLine/    ステータスラインの印（selector）と tmux の再描画（listener）。状態は持たない
          watch/         常駐の定期スキャンとログの変化の取り込み
      domain/model.ts    Redux に依らない型と純粋なルール（エージェント判定・移動先ペインの特定など）
      claude/hook.ts     hook の入力 → アクション、会話ログからの中断検出、hooks 設定
      infra/             eventLog（アクションログとスナップショット）・git・proc・tmux・notify・shell・transcript
      ui/                view（行モデル）・terminal（色と幅）・watch（対話）

- 各モジュールの slice.ts は事実のアクション・reducer に加えて、意図のアクション（〜Requested など）を持つ。listener.ts は `addAppListener` のアクションの配列を返す
- thunk は使わない（thunk middleware も外している）。I/O を伴う手続きは「意図のアクション → listener → 事実のアクション」で表す。結果を返す必要がある移動は `jumped` で Store（navigation）に記録し、呼び出し側が読む
- createStore はファクトリで、reducer と middleware は全コマンド共通。listener はコマンドによって要らない・困るもの（status から tmux を再描画させると status がまた呼ばれる、hook 以外での通知など）があるので、entry が要るモジュールの分だけ store 初期化のときに `addAppListener` で登録する
- listener の処理は await を含まない限り dispatch の中で同期的に終わる。entry は dispatch の直後に状態を読むのでこれに頼っている（redux/createStore.test.ts で確かめている）

## 設計判断とその理由
### 状態の持ち方
- セッションの状態はアクションの積み重ねで決まる（イベントソーシング）。`~/.local/state/agent-ws/sessions/<id>.jsonl` にアクションを追記し、読むたびに流し直す。追記だけなので、並列に動くサブエージェントの hook が同じログに書いてもロックが要らない
- 状態が変わらないアクション（実行中の本体の PostToolUse など）は記録しない。reducer は値が変わるときだけ書く（`put`）ので、immer が同じ参照を返すかで判定できる
- 流し直しのコストは 1,000 アクションで約30ms、10,000 で約110ms。`<id>.snap.json` にある位置までの状態をスナップショットとして置き、そこから先だけ流す（200 アクションごとに取り直す）。スナップショットはキャッシュなので同時に書かれても問題ない
- アクションは発生時刻 `at` を持ち、reducer は現在時刻を見ない。流し直しても結果が同じになる
- 保存するのは変換後のアクション。hook の生の入力は `tool_response` にファイルの中身が入るなど大きい。生の入力を見たいときは `AGENT_WS_DUMP`
- 本体が人を待っているか（attention）は保存せず、本体とサブエージェントの状態から selector で求める。サブエージェントが2体同時に許可を待っていても、片方の許可でもう片方の待ちが消えない
- リポジトリ構成・プロセス一覧・変更件数も Store に入れるが、外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える
- SessionEnd とプロセスの消滅でログを消す。pid が分からないセッションは、ログの更新が24時間途絶えたら消す
- 完了したサブエージェントは2分だけ表示に残す。バックグラウンドが残っていない Stop で、まだ動いていることになっているサブエージェントは完了にする

### 画面の更新（subscribe）
- watch は Store を購読し、変化したら 1 フレーム（30ms）にまとめて描き直す
- 他のプロセス（hook）が書いたログは、ログのディレクトリを fs.watch で見張って差分だけ取り込む（followLogs）。取り込んだアクションは `logReplayed` で流すので、再び記録も通知もしない
- 定期スキャンは watch の listener が回す（プロセス・変更件数・中断の検出は `--interval` ごと、リポジトリ構成は15秒ごと）。セッションが増えて pid がプロセス一覧に無いとき・消えたときは、interval を待たずにプロセスを取り直す（消えたときは SessionEnd がプロセスの終了より先に届くので1秒待つ）
- tmux のステータスラインは、印（statusFlags）が変わったときだけ listener が `tmux refresh-client -S` で描き直す（`#()` も再実行される。tmux 3.4 で確認）

### Claude Code の hook
- hook は全イベント共通の1コマンドにし、何が起きたかは `hook_event_name` で判断する。登録するイベントは claude/hook.ts の `HOOK_EVENTS`（SessionStart, UserPromptSubmit, PermissionRequest, PostToolUse, PostToolUseFailure, Notification, Stop, StopFailure, SubagentStart, SubagentStop, SessionEnd）
- claude 本体の pid は、hook プロセスの祖先を辿って `attached` に記録する
- サブエージェントは本体プロセスの中で動くので、hook の `agent_id` でだけ観測できる。`agent_type` が空のもの（入力候補の先読みなど内部用）は無視する
- 許可待ちは PermissionRequest で記録する。Notification の permission_prompt は数秒遅れて届き、サブエージェント由来でも `agent_id` が付かないので使わない（matcher からも外した）
- 質問待ち: AskUserQuestion は許可待ちと同じ PermissionRequest で届く（ツール名で分ける）。MCP の elicitation_dialog も質問待ちにする
- Stop の時点でバックグラウンドのサブエージェントが動いていれば（`background_tasks`）、本体は終わったときに自動で再開するので未確認にも通知にもしない
- Esc での中断と許可の拒否では hook が1つも発火しない。どちらも会話ログ（`transcript_path`）に `[Request interrupted by user…]` が書かれるので、running / 待ちのセッションに限り、この状態になった後に会話ログが更新されていれば末尾 16KB を読み、この状態になった後の中断記録があれば `interrupted` を記録する

### 完了と既読
- 「完了」は ready のうちターン完了で未確認のもの（`unseen`）。ready をそのまま印にすると、手が空いている claude で常に点いてしまうため
- 既読にする経路: 次のプロンプト、pane-focus-in → `seen`、ポップアップからの移動（jump）、完了した時点でそのペインが表示中（クライアントが接続したセッションの、アクティブなウィンドウのアクティブなペイン）。`seen` はフォーカスのたびに呼ばれるので、未確認が無ければ ps も呼ばずに終わる

### その他
- プロセスがどの worktree に属するかは、プロセスの cwd で判定する（Linux は /proc/<pid>/cwd、macOS は lsof）
- リポジトリはメイン worktree のパスで束ねる。フラット展開の worktree が ghq 配下にあっても重複しない
- dirty 件数（git status）は表示する worktree だけ数える
- tmux は -F 出力中のタブ（ロケールによっては非 ASCII も）を `_` に置き換えるので、区切りは ASCII の `|~|` にしている
- 移動先: pid の祖先が pane_pid に当たるペイン → そのパスにいるペイン → （watch か --create のとき）新しいウィンドウ

## セットアップ
- `bun install && bun run build` で `dist/agent-ws.js` に bundle する（RTK を含めて1ファイル。`NODE_ENV=production`）。開発中は `bun src/entry/cli.ts …` でそのまま動く
- `bun dist/agent-ws.js hooks-config` の出力を `~/.claude/settings.json` の hooks にマージする（実行したファイルのパスが入る）
- tmux（~/.tmux.conf）:

      bind a display-popup -E -w 90% -h 80% "bun ~/path/agent-ws/dist/agent-ws.js watch --popup"
      set -g status-right "#(bun ~/path/agent-ws/dist/agent-ws.js status --tmux)"
      set -g focus-events on
      set-hook -g pane-focus-in 'run-shell -b "bun ~/path/agent-ws/dist/agent-ws.js seen #{pane_pid}"'

- 実行環境は Bun。依存は @reduxjs/toolkit だけ（bundle に含まれる）。開発時は typescript と @types/bun も使う
- Bun 固有の API は `Bun.spawnSync`（infra/shell.ts）、`Bun.stdin`（entry/hook.ts）、`bun:test` だけで、残りは Bun が互換実装している node:* を使っている

## 検証状況
- 済み（本物の Claude Code 2.1.309 を、クライアントを接続した tmux 3.4 の中で対話実行。bundle した dist で確認）:
  - hook の入力の形。Notification の種別は `notification_type`。hooks 設定の `args` 形式は使える。入力は `src/fixtures/` に保存し、テストで再生している
  - 起動直後の入力待ちと本体 pid の特定、許可待ち（理由つき）、許可の拒否と応答中の Esc からの復帰、バックグラウンドのサブエージェントの許可待ち（本体は ⏳、詳細はサブエージェントの行）→許可→完了、AskUserQuestion で ❓、SessionEnd でログが消える
  - 完了と既読: 別ウィンドウを見ている間の完了で ✓ → そのウィンドウへ移ると pane-focus-in で消える、表示中のペインで完了したら ✓ を出さない、jump で既読
  - subscribe: `watch --interval=60` でも、許可待ち・他プロセスが記録した中断が即座に反映される。claude の起動は1秒以内、終了は約1秒で一覧に反映される
  - ステータスラインは状態が変わったときに描き直される（status-interval=600 でも `#()` が再実行される）
  - hook 1回の処理は約36〜38ms（bundle 版。RTK 導入前は約32ms）。状態が変わらない PostToolUse はログに残らない
- 済み: tsc（strict）が通る。単体テスト15件（`bun test`）が通る
- 未検証:
  - Notification の elicitation_dialog / agent_needs_input、StopFailure、PostToolUseFailure の実際の入力。確かめるときは `AGENT_WS_DUMP=<ファイル>` を付けて claude を起動すると hook の入力がそのまま追記される
  - バックグラウンドのサブエージェントの許可を拒否したときの本体側の状態
  - スナップショットが効く長いセッション（200 アクション超）の実地確認（単体テストのみ）
  - macOS での通知・lsof 経路・fs.watch
  - codex など claude 以外のエージェントの応答状況（現状は「? 状態不明」）

## 既知の制約
- 応答が始まる前に Esc で取り消すと、プロンプトが入力欄に戻るだけで hook も会話ログの記録も無い。次のプロンプトを送るまで「実行中」のまま残る
- 中断の検出は会話ログを見に行ったときだけ（list / status / seen、watch の interval ごと）。watch の interval を長くすると反映が遅れる（tmux の status が先に検出してログに記録すれば、watch にはすぐ反映される）

## 保留中の論点
1. コード量: コメント・空行を除いて 1487 行（Redux 化の前は 1008 行）。増えた主な理由は、ログとスナップショット、意図のアクションと listener への整理、ワークスペースのスライス、re-ducks でのモジュール分割と entry の分割（import 文が増えた）。減らすなら機能を削る。候補は、エージェント以外のプロセス表示、--json、ghq が無い環境向けの走査、claude と codex 以外の判定
2. 子プロセスを ppid でエージェントの下にネストする案（リポジトリ > worktree > エージェント > 子プロセス）。提案したが未回答
3. ペインが無い worktree の新しいウィンドウを今いるセッションに作っている。リポジトリ名のセッションに作るかどうか
4. 中断の検出も subscribe にする案: running / 待ちのセッションの会話ログを fs.watch で見張れば、interval を待たずに中断を拾える

