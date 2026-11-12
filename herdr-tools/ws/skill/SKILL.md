---
name: ws
description: ws の CLI で、この Mac で動いている Claude Code のエージェントと git の worktree を一覧し、新しいブランチの worktree を作り、別の worktree にエージェントを起動・停止・再開し、終わった worktree を片付ける。「ほかのエージェントは何をしている」「どの worktree が空いている」「この worktree に別のエージェントを起こして」「新しいブランチの worktree を作って」「プルリクエスト 12 の worktree を用意して」「止まったエージェントを再開して」「この worktree を片付けて」「差分を hunk で開いて」と頼まれたときと、同じリポジトリで並行して作業する worktree が要るときに使う。
---

# ws でエージェントと worktree を扱う

`ws` は、エージェントを workspace（リポジトリ）> worktree > agent の木で扱う CLI である。
**エージェントが自分の判断で呼んでよいのは、状態を読むサブコマンドだけである。** `ws` の多くのサブコマンドは
ユーザーの tmux の画面を別の場所へ移すか、ほかのセッションを止める。ユーザーが作業している画面を
エージェントが動かすと、ユーザーの入力が別のペインに入るので、頼まれたときだけ呼ぶ。

## 1. 使えるかを確かめる

```bash
which ws && ws list --json
```

`ws: hc connect closed: ...` と出たら、herdr-core につながっていない。Herdr app の起動をユーザーに頼む。
サブコマンドの引数は `ws --help` で確認する。

## 2. サブコマンドごとの、エージェントが呼んでよい条件

| サブコマンド | エージェントが呼んでよい条件 | 何が起きるか |
|---|---|---|
| `ws list --json` | いつでも | エージェントがいる worktree と、その状態を出す |
| `ws list --json --all` | いつでも | ghq のすべてのリポジトリの worktree を出す |
| `ws changes --json <worktree>...` | いつでも | worktree ごとの変更量（+/− の行数）を出す |
| `ws prune --dry-run` | いつでも | 場所が消えた worktree の、片付けの対象を出す |
| `ws next --list` / `ws step --list` | いつでも | 巡回の列・サイドバーの並びを出す。画面は移らない |
| `ws go <ref> --dry-run` | いつでも | 移動で行う操作（`op` と `target`）を JSON で出す。画面は移らない。`--dry-run` を必ず付ける |
| `ws create <branch> [<worktree>] [--from <rev>] --no-agent` | 今のセッションが作業する worktree が要るとき（ユーザーの設定かリポジトリが、並行作業を worktree で行うと決めているとき）と、ユーザーが worktree の作成を頼んだとき | worktree を本体の横に作る。エージェントは起動しない。画面は移らない（3 節） |
| `ws pr <番号> [<worktree>] --no-go` | ユーザーがプルリクエストの worktree を頼んだとき | worktree を作るか最新にする。`--no-go` を必ず付ける |
| `ws new <worktree> -- <claude の引数>` | ユーザーが別のエージェントの起動を頼んだとき | 画面を移さずに claude を起動する（3 節） |
| `ws create <branch> [<worktree>] -- <claude の引数>` | ユーザーが新しいブランチでのエージェントの起動を頼んだとき | worktree を作り、画面を移さずに claude を起動する（3 節） |
| `ws destroy <worktree> --dry-run` | いつでも | 止めるエージェント・消す worktree とブランチ・閉じる tmux セッションを出す |
| `ws destroy <worktree>` | ユーザーがその worktree の片付けを頼んだとき | エージェントを止め、worktree とマージ済みのブランチを消し、tmux セッションを閉じる（4 節） |
| `ws destroy <worktree> --force` | ユーザーが、未コミットの変更を捨てることを承知して頼んだとき | 未コミットの変更と追跡されていないファイルごと消す。戻せない |
| `ws resume <agent>` | ユーザーが再開を頼んだとき | 再開できるエージェントに `claude --resume` を送る |
| `ws stop <agent>` | ユーザーがそのエージェントの停止を頼んだとき | エージェントを止めて一覧から消す |
| `ws close [<ref>]` | ユーザーが頼んだとき | worktree の tmux セッションを閉じる。エージェントは止まらない |
| `ws prune --yes` | ユーザーが `--dry-run` の結果を見て頼んだとき | セッションとエージェントを片付ける |
| `ws hunk ...` / `ws edit ...` | ユーザーが「開いて」と頼んだとき | ユーザーの画面が hunk・エディタへ移る |
| `--dry-run` の無い `ws go`、`--list` の無い `ws next`・`ws step`、`ws panes`、`ws ui` | 呼ばない | ユーザーのキー操作用。ユーザーの画面が移る |
| `--client <name>` / `--from-app` を付けた呼び出し | 呼ばない | どのクライアントの画面を移すかの指定で、ユーザーのキー操作と Herdr app が使う |
| `--here` / `--attach` を付けた `ws new`・`ws create` | 呼ばない | 今の端末を claude に渡すか、ユーザーの画面が移る |
| `ws hook` / `ws statusline` | 呼ばない | Claude Code が呼ぶ |

## 3. worktree を作り、別のエージェントを起動する（ws new / ws create）

```bash
ws new <すでにある worktree の絶対パス> -- "<最初の依頼の文>"
ws create <新しいブランチ名> [<リポジトリのどれかの worktree>] [--from <rev>] -- "<最初の依頼の文>"
ws create <新しいブランチ名> [<リポジトリのどれかの worktree>] [--from <rev>] --no-agent
```

| 使うサブコマンド | 使う場面 | 標準出力 |
|---|---|---|
| `ws new` | すでにある worktree で、別のエージェントを起動する | `<エージェントの id>\t<名前>` の 1 行 |
| `ws create ... -- "<依頼の文>"` | 新しいブランチの worktree を作り、そこで別のエージェントを起動する | 1 行目に `worktree を作りました（…）: <場所>`、2 行目に `<エージェントの id>\t<名前>` |
| `ws create ... --no-agent` | 新しいブランチの worktree を作り、今のセッションがそこで作業する（エージェントは起動しない）| `worktree を作りました（…）: <場所>` の 1 行 |

- エージェントの id は `ws stop`・`ws resume` に渡す
- `--` の後ろは claude の引数になる。依頼の文のほかに `--model sonnet` などを渡せる
- `ws create` は worktree を本体のリポジトリの横（`<本体のフォルダー名>=<ブランチ名>`）に作る
- 新しいブランチを分ける元は、次の順で決まる（`ws --help`）。main から分けたいときは `--from main` を付ける

  | 順番 | 分ける元 | 使われる条件 |
  |---|---|---|
  | 1 番目 | `--from <rev>` | `--from` を付けたとき |
  | 2 番目 | origin の同じ名前のブランチ | `--from` が無く、origin に同じ名前のブランチがあるとき |
  | 3 番目 | `<worktree>`（既定は今のディレクトリ）の HEAD | 上の 2 つに当たらないとき |

- `--no-agent` で作った worktree では、今のセッションが、作られたディレクトリの絶対パスで読み書きとコマンドを行う
- `ws create` は、そのブランチの worktree が既にあると失敗する。そのときは、失敗の文に出た場所を `ws new` に渡す
- ユーザーの設定（CLAUDE.md）かリポジトリに、`ws create` とは別の worktree の作り方の決まりがあれば、それに従って worktree を作り、`ws new` を使う
- 起動したエージェントは、別の Claude Code のセッションである。こちらの会話の文脈は持たないので、
  依頼の文に目的・対象のパス・終わりの条件を書く。結果はこちらに返らない

### ws new と Agent ツール（サブエージェント）の使い分け

| 作業の性質 | 使うもの |
|---|---|
| 結果だけがこの会話に返ればよい（調査・点検・件数の数え直し）| Agent ツール |
| ユーザーが後からその会話に入って続きを指示する | `ws new` |
| 別のブランチの worktree で、こちらと並行して長く進める | `ws new` |

`ws new` で起こしたエージェントの完了は、こちらには通知されない。状態は `ws list --json` の `status` で確認する。

## 4. worktree を片付ける（ws destroy）

```bash
ws destroy <worktree の絶対パス> --dry-run   # 先に、何が止まり何が消えるかを確認する
ws destroy <worktree の絶対パス>
```

- **先に `--dry-run` の結果をユーザーに示す。** 止めるエージェントに `working` のものがあれば、それも伝える
- 未コミットの変更・追跡されていないファイル・submodule があると、何も止めずに失敗する。**失敗したからといって
  `--force` を付けて呼び直さない。** 失敗の文に出たファイルをユーザーに示し、捨ててよいかを確認する
- 本体の worktree と、自分自身が動いている worktree は消せない（`--force` でも失敗する）
- ブランチは、マージ済みのときだけ消える。残ったときは、残した理由が出力に出る。残ったブランチを `git branch -D` で消さない
- origin のブランチは消えない

## 5. ws list --json の形

```
workspaces[]            リポジトリ。path / name
  .worktrees[]          path / branch / isMain / exists
    .agents[]           id / name / status / message / claudeSessionId / contextUsedPercentage / resumable
      .tmux.current     true なら、ユーザーが今いるペインのエージェント
    .tmux.session       worktree の tmux セッション（無ければ null）
usage                   5 時間と 7 日の利用上限の使用率（fiveHour / sevenDay の usedPercentage）
```

`status` の値と意味:

| status | 意味 |
|---|---|
| `working` | 作業中 |
| `blocked` | ユーザーの返事か承認を待っている |
| `done` | 終わったが、ユーザーがまだ見ていない |
| `idle` | 終わっていて、ユーザーが見た |

- 自分自身は、`cwd` が今の作業ディレクトリで `claudeSessionId` が今のセッションの id の行である
- `<agent>` を取るサブコマンドには `id`（例: `t26`）か `name` を渡す
- ほかのエージェントがいる worktree のファイルは書き換えない。同じ worktree に `working` のエージェントが
  いたら、編集の前にユーザーに伝える
