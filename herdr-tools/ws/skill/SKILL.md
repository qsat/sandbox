---
name: ws
description: ws の CLI で、この Mac で動いている Claude Code のエージェントと git の worktree を一覧し、別の worktree にエージェントを起動・停止・再開する。「ほかのエージェントは何をしている」「どの worktree が空いている」「この worktree に別のエージェントを起こして」「プルリクエスト 12 の worktree を用意して」「止まったエージェントを再開して」「差分を hunk で開いて」と頼まれたときに使う。
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
| `ws pr <番号> [<worktree>] --no-go` | ユーザーがプルリクエストの worktree を頼んだとき | worktree を作るか最新にする。`--no-go` を必ず付ける |
| `ws new <worktree> -- <claude の引数>` | ユーザーが別のエージェントの起動を頼んだとき | 画面を移さずに claude を起動する（3 節） |
| `ws resume <agent>` | ユーザーが再開を頼んだとき | 再開できるエージェントに `claude --resume` を送る |
| `ws stop <agent>` | ユーザーがそのエージェントの停止を頼んだとき | エージェントを止めて一覧から消す |
| `ws close [<ref>]` | ユーザーが頼んだとき | worktree の tmux セッションを閉じる。エージェントは止まらない |
| `ws prune --yes` | ユーザーが `--dry-run` の結果を見て頼んだとき | セッションとエージェントを片付ける |
| `ws hunk ...` / `ws edit ...` | ユーザーが「開いて」と頼んだとき | ユーザーの画面が hunk・エディタへ移る |
| `ws go` / `ws next` / `ws step` / `ws panes` / `ws ui` | 呼ばない | ユーザーのキー操作用。ユーザーの画面が移る |
| `ws new --here` / `ws new --attach` | 呼ばない | 今の端末を claude に渡すか、ユーザーの画面が移る |
| `ws hook` / `ws statusline` | 呼ばない | Claude Code が呼ぶ |

## 3. 別のエージェントを起動する（ws new）

```bash
ws new <worktree の絶対パス> -- "<最初の依頼の文>"
```

- 標準出力に `<エージェントの id>\t<名前>` を 1 行出す。この id を `ws stop`・`ws resume` に渡す
- `--` の後ろは claude の引数になる。依頼の文のほかに `--model sonnet` などを渡せる
- `ws` は worktree を作らない（作るのは `ws pr` だけ）。**`ws new` には、すでにある worktree のパスを渡す。**
  新しいブランチで並行させるときは、先に worktree を作る。作り方はユーザーの設定（CLAUDE.md）と
  リポジトリの決まりに従い、どちらにも無ければ `git worktree add` を使う
- 起動したエージェントは、別の Claude Code のセッションである。こちらの会話の文脈は持たないので、
  依頼の文に目的・対象のパス・終わりの条件を書く。結果はこちらに返らない

### ws new と Agent ツール（サブエージェント）の使い分け

| 作業の性質 | 使うもの |
|---|---|
| 結果だけがこの会話に返ればよい（調査・点検・件数の数え直し）| Agent ツール |
| ユーザーが後からその会話に入って続きを指示する | `ws new` |
| 別のブランチの worktree で、こちらと並行して長く進める | `ws new` |

`ws new` で起こしたエージェントの完了は、こちらには通知されない。状態は `ws list --json` の `status` で確認する。

## 4. ws list --json の形

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
