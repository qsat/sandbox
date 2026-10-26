# agent-ws 開発の引き継ぎ

agent-ws.zip（TypeScript プロジェクト一式）を添付しています。以下は前回までの経緯です。読んだうえで続きを手伝ってください。

## 目的
AI エージェント（主に Claude Code）を複数の git worktree で並行して動かすための、tmux 常駐型の管理 CLI です。
- ゴールは「並行して動くエージェントのうち、人の対応が要るものにすぐ気づき、すぐそこへ行ける」こと
- 表示の階層は「リポジトリ > worktree > エージェント > サブエージェント」
- リポジトリは ghq 管理。worktree はブランチごとにフラットに展開している（置き場所は `git worktree list` から取るので、命名は問わない）
- 常駐表示は tmux（neovim ではなく）。ポップアップとステータスラインで使う

## できること（src/entry/cli.ts のサブコマンド）
- `list [query] [--all] [--agents-only] [--json]`: 一覧を1回表示する。既定では「追加 worktree がある、またはエージェントがいる」リポジトリだけを出す
- `watch [query] [--interval=2] [--popup]`: 常駐表示。j/k で選択、Enter でそのペイン／ウィンドウへ移動、r で再読込、q で終了。`--popup` を付けると移動後に終了する
- `status [--tmux]`: ステータスライン用の印。対応が要るものの有無だけを出し、何も無ければ空（⏳ 許可待ち / ❓ 質問待ち / ✓ 完了して未確認 / ✗ エラー）。中身はポップアップ（`watch --popup`）で見る。git は呼ばないので軽い
- `seen <pane_pid>`: そのペインにいるエージェントの完了を確認したことにする。tmux の pane-focus-in から呼ぶ
- `jump <pid|path> [--create] [--dry-run]`: その pid（の祖先）やパスがいる tmux ペインへ移動する
- `hook`: Claude Code の hook から呼ばれる（stdin に JSON）
- `hooks-config`: `~/.claude/settings.json` に足す hooks 設定を出力する

ターンの状況は ready（入力待ち）/ running（実行中）/ waiting（許可待ち）/ asking（質問待ち）/ error（エラー）の5つ。サブエージェントは running / waiting / done。
ターンが完了して人がまだ見ていないものは「未確認」で、一覧では「✓ 完了」と出る。次のプロンプト・そのペインへのフォーカス・ポップアップからの移動で確認したことになる。
waiting・asking・ready・error への遷移で通知する（tmux の display-message と、osascript または notify-send）。表示中のペインで完了したときは、見ているので知らせない。通知する状態は `AGENT_WS_NOTIFY` で絞れる。

## 用語
| 用語 | 意味 |
|---|---|
| Agent | worktree で動いているエージェント1体（プロセスと、hook で分かった応答状況）。ID は Claude Code のセッション ID |
| Turn | プロンプトから完了までの1往復（実行中 → 許可待ち・質問待ち → 完了） |
| Subagent | Agent の中で動く子 |
| Attention | 人の対応が要るもの（許可待ち・質問待ち・エラー・完了の未確認） |
| Acknowledge | Attention を人が確認したこと（既読） |
| Visit | Agent や worktree の場所（tmux のペイン）へ行くこと |

「session」は Claude Code の用語として、claude の middleware の中（`session_id` など）だけで使う。

## 構成（Redux Toolkit・re-ducks。依存は矢印の向きだけ。src/__tests__/layers.test.ts で確かめている）
    src/entry（境界: cli・context・command。引数・環境変数・標準入出力・終了コード・いまの時刻・このプロセス）
       └→ src/entry/commands/*（コマンドごとに middleware・購読者を選んで Store を作り、出来事を伝える。結果は状態で返す）
             ├→ src/ui/*（人に見せる: 状態 → 文字・画面、ステータスラインの描き直し・通知）
             └→ src/redux/middlewares/*（外部システムとのやりとり。I/O の実装もそれぞれの隣に置く）
                   └→（ui も）src/redux/createStore.ts・rootReducer.ts → src/redux/modules/{app,ui}/*（ドメイン: slice・selector。I/O を知らない）
                         └→ src/redux/types/*（型）・src/redux/utils/*（純粋な関数） → src/lib/*（ドメインを知らない道具）

    依存テストが確かめること: 上の層は下の層だけを import する／ファイル単位の循環が無い／modules/app は modules/ui を知らない／
    middleware は他の外部システムの middleware 本体（index.ts）に頼らない（そのシステムの I/O のファイルは使ってよい）。
    例外は1つ: modules の selector は rootReducer.ts の RootState を型としてだけ読む（状態の形は rootReducer が決める。slice は selector を読まないので循環しない）

    dispatch ─→ listener ─→ effects（claude・processes・git・tmux・clock）─→ log（eventLog）─→ reducer ─→ subscribers（statusLine・notifier）

    State: { app: { agents, attention, workspace, lifecycle }, ui: { visit, watch } }

    src/
      entry/          ① プロセスの境界と ② コマンド
        cli.ts        引数・環境変数・標準入力を読み、Command を match で実行し、標準出力と終了コードに書く。TUI に端末を渡す
        context.ts    環境変数・いまの時刻・このプロセス（pid・ppid・OS）→ Context、端末 → Display。ここより内側は process も Date.now() も見ない（clock を除く）
        command.ts    コマンドライン → Command。引数の解釈はここだけ
        commands/     コマンドごとに middleware・購読者を選んで Store を作り、出来事を伝える（list・status・seen・jump・hook・watch）。
                      どれも (Command, Context) → Store の形で、文字にはしない。types.ts に Command（判別共用体）と Context、start.ts が Store を作って起動する
      redux/
        createStore.ts  Store のファクトリ。createStore({ log, effects })。addAppListener・listen
        rootReducer.ts  状態の形: 各モジュールの reducer を app と ui にまとめる。RootState
        modules/
          app/
            agents/       Agent 集約: ターン・サブエージェント・場所（pid・cwd）と、OS から見えるエージェントのプロセス。
                          出来事（agentAttached・turnStarted・inputRequested・toolUsed・turnFinished・turnInterrupted…）
            lifecycle/    アプリの出来事: 起動した（initialized）・時間が経った（ticked）と、いまの時刻（now）
            attention/    中核: 人の対応が要るもの。持つのは導けない「完了の未確認」だけで、許可・質問・エラーは agents から selector で導く。
                          selector に通知する遷移（selectNotice）とステータスラインの印（selectStatusFlags）
            workspace/    リポジトリ・worktree・変更件数・リポジトリ構成を取った時刻・変更件数を数えた時刻。エージェントとは selector（selectTree）で cwd を使って結びつける
          ui/
            visit/        人が行き先を選んだ（destinationChosen）・移動の結果（visited）・人がペインにフォーカスした（paneFocused）。移動できたか（selectArrived）
            watch/        watch の画面: 開いた（watchOpened）・人が選んだ行（rowSelected）・移動の結果を見せているか・読み直しの操作（reloadPressed）。
                          popup で行き先へ移れたら閉じる（selectShouldClose）。watch は visit を読むが、visit は watch を知らない
        middlewares/      外部システムごと。出来事を受けて、自分の判断で I/O し、結果を出来事として戻す。何をするかは entry がオプションで決める。
                          effects.ts の effects・on で「出来事 → 反応」の対応表として書く
                          外部システムの出力の解析は、そのシステムのディレクトリの parse.ts に純粋な関数で置く（本物を動かさずにテストできる）
          eventLog/       出来事の記録・流し直し・見張り（log.ts がファイルの読み書き）
          claude/         Claude Code の hook 入力 → 出来事（hook.ts）、会話ログからの中断検出と見張り（transcript.ts）。実データの fixture
          processes/      ps（proc.ts、解析は parse.ts）: プロセスが消えたエージェントを終わらせる・エージェントのプロセス一覧
          git/            git（git.ts、解析は parse.ts）: リポジトリ構成・変更件数・場所 → リポジトリ名とブランチ（locate。通知の組み立てで使う）
          tmux/           移動・フォーカスでの確認・表示中の完了の確認（tmux.ts がコマンド、解析は parse.ts）
          clock/          時間の経過を出来事（ticked）にする（watch で組む）
        types/            ドメインの型（agent・attention・workspace・visit）
        utils/            純粋な関数を1関数1ファイルで（detectAgent・isBlocked・isUnder・repoName・firstLine・ancestry・findPane・replayed）
      ui/                 人に見せる。middleware は知らない（使う外部の情報は組み立てる側が関数で渡す）
        list.ts status.ts jump.ts watch.ts notification.ts   出力ごとの表示: 状態 → 文字（watch.ts は常駐表示の画面の状態）
        parts.ts        表示の部品: Cell・Row・状況の見せ方（STATUS）・経過時間
        terminal.ts     色と表示幅（Display）
        tui.ts          常駐表示の TUI。状態を読んで描くだけで、人の操作は受け取った関数で伝える。端末は境界から受け取る
        subscribers/    状態を人に見せる購読者。store.subscribe で、見ている部分が変わったときだけ動く（observe.ts）。何も dispatch しない
                        statusLine.ts（印が変わったら tmux のステータスラインを描き直させる）・notifier.ts（知らせる遷移の通知）・
                        tmux.ts・notify.ts（そのためのコマンド）
      lib/                ドメインを知らない汎用の道具: attempt（失敗したら代わりの値）・scan（reduce の途中経過）・debounce（続けて呼ばれたら、途絶えてから1回だけ実行）・
                          match（kind によるパターンマッチ）・run（外部コマンドの実行・パスの実体）

- modules（slice・selector・listener）は I/O を知らない。外部システムとのやりとりは middleware が、人に見せるものは ui が吸収する。listener は I/O を伴わないつなぎが要るモジュールにだけ置く（今は無いが、仕組み（listener middleware・addAppListener・listen）は createStore に組んである）
- アクションは「起きたこと」だけにする（セッターや特定の middleware への命令にしない）。entry が dispatch するのは起動した（initialized）ことと、外界・人の出来事（hookReceived・paneFocused・destinationChosen・rowSelected・reloadPressed）だけ。ログの読み込み・生死の確認・スキャンなどは、出来事を受けた middleware がそれぞれ判断して行う
- 各モジュールの slice.ts は createSlice で出来事と reducer を持つ（他のモジュールの出来事への反応は extraReducers）。reducer の state の形（AgentsState など）は slice.ts、ドメインの型は types/
  - 出来事の type は記録されるので変えない（agents は name "agent"、reducers のキーは attached・started… で type は "agent/attached" など。export するときに agentAttached などへ名前を付け替える）
  - どの reducer も扱わない合図（hookReceived・paneFocused・reloadPressed。middleware だけが反応する）は createAction のまま。状態を変えない reducer を作らないため
- middleware と購読者の分担: 出来事に反応して外界とやりとりし、結果を出来事として戻すものは middleware（redux）。状態だけで決まり、人に見せるだけのもの（ステータスライン・通知・watch の画面）は store.subscribe の購読者（ui）。購読者は entry がログから状態を組み立て終えた後に購読させるので、流し直しでは動かない（middleware のような「流し直した出来事か」の判断が要らない）
- 手続きにしない: 「依頼して返事を受け取る」形（dispatch した直後に結果を読んで戻り値にする）にしない。人の操作は出来事として伝えるだけで、結果は状態の変化として受け取る（移動の結果は ui.visit、popup を閉じるかは selectShouldClose）。描画は状態を読むだけで書き換えない（選択中として出す行・スクロール位置は描画のたびに導く）。middleware は手順の台本にせず、関心ごとに出来事や状態の変化へ反応する（変更件数は表示する worktree が変わったら数え直す、リポジトリを取り直す時期は状態の時刻で決める）
- 時刻は出来事からだけ受け取る（initialized・ticked・hookReceived などの at）。いまの時刻は app.lifecycle.now にあり、描画も middleware もそれを使う。外界から時刻を取るのは entry の境界（cli.ts → Context）と clock だけ。環境変数・このプロセスの pid・OS も entry の境界でだけ読み、オプションとして middleware・購読者に渡す
- thunk は使わない（thunk middleware も外している）
- middleware は同期的に動くので、dispatch から戻った時点で I/O まで終わっている。entry はこれに頼って dispatch の直後に状態を読む
- どの middleware・購読者を組むかはコマンドごとに entry が決める。たとえば status は statusLine を購読させない（ステータスラインから呼ばれるので、描き直させると自分がまた呼ばれる）、通知（notifier）は hook だけ
- 記録（eventLog）は createStore の log として reducer の直前に組まれる。effects が出来事の途中で出した出来事（表示中の完了の確認など）より先に記録しないと、ログの順序が入れ替わり、流し直したときの状態が変わる（redux/__tests__/createStore.test.ts で確かめている）

## 設計判断とその理由
### 状態の持ち方
- エージェントの状態は出来事の積み重ねで決まる（イベントソーシング）。`~/.local/state/agent-ws/agents/<id>.jsonl` に出来事を追記し、読むたびに流し直す。追記だけなので、並列に動くサブエージェントの hook が同じログに書いてもロックが要らない
- 状態が変わらない出来事（実行中の本体の PostToolUse など）は記録しない。reducer は値が変わるときだけ書く（`put`）ので、immer が同じ参照を返すかで判定できる
- 流し直すときは、記録済みの目印（`meta.replayed`）を付けて出来事をそのまま dispatch する。同じ出来事に agents と attention の両方の reducer が反応する（たとえば turnFinished で agents はターンを終え、attention は未確認にする）。目印付きの出来事は記録も通知もしない
- 流し直しのコストは 1,000 出来事で約30ms、10,000 で約110ms。`<id>.snap.json` にある位置までの状態（エージェントと確認の状況）をスナップショットとして置き、そこから先だけ流す（200 出来事ごとに取り直す）。スナップショットはキャッシュなので同時に書かれても問題ない
- 出来事は発生時刻 `at` を持ち、reducer は現在時刻を見ない。流し直しても結果が同じになる
- 保存するのは変換後の出来事。hook の生の入力は `tool_response` にファイルの中身が入るなど大きい。生の入力を見たいときは `AGENT_WS_DUMP`
- 許可待ち・質問待ち・エラーは保存せず、ターンとサブエージェントの状況から selector（attentionOf）で求める。サブエージェントが2体同時に許可を待っていても、片方の許可でもう片方の待ちが消えない
- エージェントのプロセス・リポジトリ構成・変更件数も Store に入れるが、外から観測した「いまの値」なのでログには残さず、スキャンするたびに置き換える。エージェント以外のプロセスは扱わない
- SessionEnd とプロセスの消滅でログを消す。pid が分からないエージェントは、ログの更新が24時間途絶えたら閉じる
- 完了したサブエージェントは2分だけ表示に残す。バックグラウンドが残っていない完了で、まだ動いていることになっているサブエージェントは完了にする

### 画面の更新（subscribe）
- watch は Store を購読し、変化したら 1 フレーム（30ms）にまとめて描き直す
- 他のプロセス（hook）が書いたログは、eventLog がログのディレクトリを fs.watch で見張って差分だけ取り込む
- 時間の経過は clock の middleware が ticked として出す（watch だけが組む）。ticked を受けて、eventLog はログの取りこぼしを拾い、processes は生死の確認とプロセス一覧を、git は変更件数とリポジトリ構成（前回から15秒以上たっていれば）を、claude は中断の確認を行う。エージェントが増えて pid がプロセス一覧に無いとき・消えたときは、processes が interval を待たずにプロセスを取り直す（続けて届いても1回にまとめる。消えたときは SessionEnd がプロセスの終了より先に届くので1秒待つ）
- コマンドごとの違いは middleware のオプションで表す。たとえば status は processes() だけでプロセス一覧もリポジトリも調べない（生死の確認だけ）、list と watch は processes({ list: true })・git({ repos, dirty })、watch だけ eventLog({ follow: true }) と clock を組む
- hook も起動時に全エージェントのログを読む（エージェント10体でも1回あたり +3ms 程度）。claude の middleware は、そのエージェントのこれまでの状態が Store にある前提で hook を処理する
- tmux のステータスラインは、印が変わったときだけ statusLine の購読者が `tmux refresh-client -S` で描き直す（`#()` も再実行される。tmux 3.4 で確認）。
  比べるのは出来事の連鎖が終わってから（observe の settle。lib/debounce の待ち時間 0 でまとめる）。連鎖は同期的に進むので、途中の状態（表示中のペインで完了して確認済みになる間の ✓）は映さない。通知も同じwatch では、他のプロセスが記録した変化を取り込んだときも描き直す

### Claude Code の hook
- hook は全イベント共通の1コマンドにし、何が起きたかは `hook_event_name` で判断する。登録するイベントは redux/middlewares/claude/hook.ts の `HOOK_EVENTS`（SessionStart, UserPromptSubmit, PermissionRequest, PostToolUse, PostToolUseFailure, Notification, Stop, StopFailure, SubagentStart, SubagentStop, SessionEnd）
- claude 本体の pid は、hook プロセスの祖先を辿って agentAttached に記録する
- サブエージェントは本体プロセスの中で動くので、hook の `agent_id` でだけ観測できる。`agent_type` が空のもの（入力候補の先読みなど内部用）は無視する
- 許可待ちは PermissionRequest で記録する。Notification の permission_prompt は数秒遅れて届き、サブエージェント由来でも `agent_id` が付かないので使わない（matcher からも外した）
- 質問待ち: AskUserQuestion は許可待ちと同じ PermissionRequest で届く（ツール名で分ける）。MCP の elicitation_dialog も質問待ちにする
- Stop の時点でバックグラウンドのサブエージェントが動いていれば（`background_tasks`）、本体は終わったときに自動で再開するので未確認にも通知にもしない
- Esc での中断と許可の拒否では hook が1つも発火しない。どちらも会話ログ（`transcript_path`）に `[Request interrupted by user…]` が書かれるので、実行中・待ちのエージェントに限り、この状況になった後に会話ログが更新されていれば末尾 16KB を読み、この状況になった後の中断記録があれば、その記録の時刻で turnInterrupted を記録する。
  確かめるのは起動したとき・時間が経ったとき。watch では、実行中・待ちのエージェントの会話ログを fs.watch で見張り、書き換わったら（50ms まとめて）すぐ確かめる

### 完了と確認
- 「完了」はターンが完了して人がまだ見ていないもの。入力待ちをそのまま印にすると、手が空いている claude で常に点いてしまうため
- 確認したことにする経路: 次のプロンプト、pane-focus-in → `seen`、ポップアップからの移動（jump）、完了した時点でそのペインが表示中（クライアントが接続したセッションの、アクティブなウィンドウのアクティブなペイン）。`seen` はフォーカスのたびに呼ばれるので、未確認が無ければ ps も呼ばずに終わる

### その他
- エージェントがどの worktree にいるかは、プロセスの cwd で判定する（Linux は /proc/<pid>/cwd、macOS は lsof）
- リポジトリはメイン worktree のパスで束ねる。フラット展開の worktree が ghq 配下にあっても重複しない
- dirty 件数（git status）は表示する worktree だけ数える
- tmux は -F 出力中のタブ（ロケールによっては非 ASCII も）を `_` に置き換えるので、区切りは ASCII の `|~|` にしている
- 行き先: pid の祖先が pane_pid に当たるペイン → そのパスにいるペイン → （watch か --create のとき）新しいウィンドウ

## セットアップ
- `bun install && bun run build` で `dist/agent-ws.js` に bundle する（RTK を含めて1ファイル。`NODE_ENV=production`）。開発中は `bun src/entry/cli.ts …` でそのまま動く
- `bun dist/agent-ws.js hooks-config` の出力を `~/.claude/settings.json` の hooks にマージする（実行したファイルのパスが入る）
- tmux（~/.tmux.conf）:

      bind a display-popup -E -w 90% -h 80% "bun ~/path/agent-ws/dist/agent-ws.js watch --popup"
      set -g status-right "#(bun ~/path/agent-ws/dist/agent-ws.js status --tmux)"
      set -g focus-events on
      set-hook -g pane-focus-in 'run-shell -b "bun ~/path/agent-ws/dist/agent-ws.js seen #{pane_pid}"'

- 実行環境は Bun。依存は @reduxjs/toolkit だけ（bundle に含まれる）。開発時は typescript・@types/bun・@biomejs/biome も使う
- テストは対象のモジュールがある場所の `__tests__/` に置く（テストデータも `__tests__/fixtures/`）。層は「テスト」の節
- フォーマットと lint は Biome（Rome の後継）。設定は biome.json（スペース2・行幅140・ダブルクォート・セミコロンあり・末尾カンマあり、lint は推奨ルール、import の並べ替えも Biome に任せる）。tsconfig でも未使用の変数・引数・import を検出する
- 実装も手続き的にしない。lint で次を禁止している（テストも同じ）
  - 三項演算子（style/noTernary）: 分岐は早期 return の小さな関数か、対応表（Record）で書く
  - else（lint/no-else.grit）: ガード節で早期 return する
  - switch（lint/no-switch.grit）: 文字列のキーなら対応表（Record）、kind で分かれる型なら lib/match（全ケースを書かないと型エラー）
  - let（lint/no-let.grit）: const と式で書く（ループは map・filter・find・reduce・再帰、try/catch の結果は lib/attempt、途中経過は lib/scan）。
    呼び出しをまたいで状態を持つしかないものだけ、理由を書いて `// biome-ignore lint/plugin/no-let: 理由` で許す（今は lib/debounce・subscribers/observe・E2E のクライアントの3か所）
  - 引数への再代入（style/noParameterAssign）、認知的複雑度 10 を超える関数（complexity/noExcessiveCognitiveComplexity）
  - 独自ルールは Biome の GritQL プラグイン（lint/*.grit。biome.json の plugins）
- スクリプト: `bun run check`（Biome の検査・型チェック・テストをまとめて。失敗すれば終了コードが 0 以外）、`bun run fix`（フォーマット・lint の自動修正・import の並べ替え）、`e2e`（端末込みの E2E）、`smoke`（本物の Claude Code でのスモークテスト）、`lint`・`format`・`typecheck`・`test`・`build`
- Bun 固有の API は `Bun.spawnSync`（lib/run.ts）、`Bun.stdin`（entry/cli.ts）、`bun:test` だけで、残りは Bun が互換実装している node:* を使っている

## テスト
確認したいことに合わせて3つの層に分けている。下の層ほど本物に近く、重い。

| 層 | 場所 | 動かし方 | 本物 | 差し替え |
|---|---|---|---|---|
| 単体 | 各モジュールの `__tests__/` | `bun run check`（`bun test`） | slice・selector・middleware・描画 | middleware ごとの I/O |
| A. シナリオ | `src/entry/__tests__/scenarios.test.ts` | `bun run check` | entry から eventLog（一時ディレクトリ）まで全部 | tmux・ps・git・通知（`mock.module`） |
| B. 端末込みの E2E | `src/entry/__tests__/e2e/` | `bun run e2e`（AGENT_WS_E2E=1。check では飛ばす） | tmux（script で接続したクライアントつき）・ps・git・hooks-config | claude（記録した hook 入力を流す偽物） |
| C. スモーク | `scripts/smoke-claude.sh` | `bun run smoke [--dist] [--keep]`（手で動かす） | Claude Code も含めて全部 | なし（モデルを呼ぶ） |

- A は、本物の Claude Code から記録した hook 入力（`src/redux/middlewares/claude/__tests__/fixtures/claude-code-2.1.309-turns.jsonl` と、中断を書いた会話ログ `transcript-deny.jsonl`・`transcript-esc.jsonl`）を entry のコマンド（commands/*）に流して ui の表示で読み、印・一覧・通知・jump の行き先・popup が閉じるかを確かめる。1つのセッションの流れを、起動 → 完了 → フォーカスで確認 → 許可 → 表示中の完了 → 拒否 → 質問 → Esc → 終了の順にたどる
- B の偽の claude（`fake-claude.ts`）は `claude` という名前のシンボリックリンクから起動する。ps からは `bun …/claude` に見えるので本物と同じくエージェントとして見つかり、hook はその子として動くので本体の pid も本物と同じく祖先から分かる。hooks は `hooks-config` の出力を settings.json に置き、その matcher どおりに流す。tmux の設定は「セットアップ」と同じ。ステータスラインは status-right を `SR[…]` で囲み、クライアントの端末に描かれた中身から読む
  - 壊したら落ちることを確かめた: `refresh-client -S` を呼ばない → ステータスラインが消えない（A でも落ちる）、popup を閉じない → 閉じない
  - tmux の癖: `display-popup` はポップアップが閉じるまで戻らない。新しいペインのシェルはログインシェルなので /etc/profile が PATH を上書きする（default-command で避けている）
- C は、作業ディレクトリに分けた CLAUDE_CONFIG_DIR（初回の案内とフォルダの信頼を済ませたもの）で claude を起動し、hooks は `--settings` で渡す。使っている人の設定は触らない。認証は環境変数（ANTHROPIC_API_KEY か CLAUDE_CODE_OAUTH_TOKEN）。hook の入力は dump.jsonl に残すので、形が変わっていたら fixture を取り直す

## 検証状況
- 済み（本物の Claude Code 2.1.309 を、クライアントを接続した tmux 3.4 の中で対話実行。bundle した dist で確認）:
  - hook の入力の形。Notification の種別は `notification_type`。hooks 設定の `args` 形式は使える。入力は `src/redux/middlewares/claude/__tests__/fixtures/` に保存し、テストで再生している
  - 起動直後の入力待ちと本体 pid の特定、許可待ち（理由つき）、許可の拒否と応答中の Esc からの復帰、バックグラウンドのサブエージェントの許可待ち（本体は ⏳、詳細はサブエージェントの行）→許可→完了、AskUserQuestion で ❓、SessionEnd でログが消える
  - 完了と既読: 別ウィンドウを見ている間の完了で ✓ → そのウィンドウへ移ると pane-focus-in で消える、表示中のペインで完了したら ✓ を出さない、jump で既読
  - subscribe: `watch --interval=60` でも、許可待ち・他プロセスが記録した中断が即座に反映される。claude の起動は1秒以内、終了は約1秒で一覧に反映される
  - ステータスラインは状態が変わったときに描き直される（status-interval=600 でも `#()` が再実行される）
  - hook 1回の処理は約40ms（bundle 版。同じ条件で比べて、ドメインの再設計の前後で変わらない）。状態が変わらない PostToolUse はログに残らない
- 済み: tsc（strict）が通る。`bun run check` が通る（単体とシナリオで39件。E2E の9件は飛ばす。30回続けて通る）。`bun run e2e` の9件が通る（3回続けて。1回20秒ほど）。`bun run smoke` が本物の Claude Code 2.1.310 で19項目すべて通る（fixture は 2.1.309 で記録。hook の種類と順序は同じ）
- 未検証:
  - Notification の elicitation_dialog / agent_needs_input、StopFailure、PostToolUseFailure の実際の入力。確かめるときは `AGENT_WS_DUMP=<ファイル>` を付けて claude を起動すると hook の入力がそのまま追記される
  - バックグラウンドのサブエージェントの許可を拒否したときの本体側の状態
  - スナップショットが効く長いセッション（200 アクション超）の実地確認（単体テストのみ）
  - macOS での通知・lsof 経路・fs.watch
  - codex など claude 以外のエージェントの応答状況（現状は「? 状態不明」）

## 既知の制約
- 応答が始まる前に Esc で取り消すと、プロンプトが入力欄に戻るだけで hook も会話ログの記録も無い。次のプロンプトを送るまで「実行中」のまま残る
- 中断の検出は、watch 以外では会話ログを見に行ったときだけ（list / status / seen）。watch は会話ログを見張るので interval を待たない

## 保留中の論点
1. コード量: コメント・空行を除いて 1784 行（Redux 化の前は 1008 行。Biome の整形で import が複数行になった分を含む）。減らすなら機能を削る。候補は、--json、ghq が無い環境向けの走査、claude と codex 以外の判定（エージェント以外のプロセス表示はドメインの再設計で削った）
2. 子プロセスを ppid でエージェントの下にネストする案（リポジトリ > worktree > エージェント > 子プロセス）。提案したが未回答
3. ペインが無い worktree の新しいウィンドウを今いるセッションに作っている。リポジトリ名のセッションに作るかどうか

