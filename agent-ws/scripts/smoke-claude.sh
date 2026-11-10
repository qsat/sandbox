#!/usr/bin/env bash
# 本物の Claude Code でのスモークテスト（手で動かす。bun run check・bun run e2e には含めない）
#
# 専用の tmux サーバの中で claude を起動してプロンプトを送り、agent-ws の一覧と印が追従するかを確かめる。
# テストで再生している hook 入力の記録（fixture）が、いまの Claude Code でも通用するかを確かめるためのもの。
#
#   bun run smoke [--dist] [--keep]
#     --dist  bundle した dist/agent-ws.js で確かめる（既定はソースの src/entry/cli.ts）
#     --keep  成功しても作業ディレクトリと tmux を残す（失敗したときは常に残す）
#
# - 必要なもの: claude・tmux・git・bun。モデルを呼ぶ（短いプロンプトを5回）
# - 使っている人の設定を汚さないよう、作業ディレクトリに分けた CLAUDE_CONFIG_DIR で動かす（初回の案内とフォルダの信頼は済ませておく）。
#   hooks は --settings で渡す。認証は環境変数から: ANTHROPIC_API_KEY か CLAUDE_CODE_OAUTH_TOKEN（`claude setup-token` で発行）
# - hook の入力は作業ディレクトリの dump.jsonl に残る（AGENT_WS_DUMP）。形が変わっていたら fixture を取り直す
set -u

DIST=0
KEEP=0
for a in "$@"; do
  case $a in
    --dist) DIST=1 ;;
    --keep) KEEP=1 ;;
    *) echo "不明な引数: $a" >&2; exit 2 ;;
  esac
done
for c in claude tmux git bun; do
  command -v "$c" >/dev/null || { echo "$c が見つかりません" >&2; exit 2; }
done

PROJECT=$(cd "$(dirname "$0")/.." && pwd -P)
if [ $DIST = 1 ]; then
  (cd "$PROJECT" && bun run build >/dev/null) || exit 2
  ENTRY=$PROJECT/dist/agent-ws.js
else
  ENTRY=$PROJECT/src/entry/cli.ts
fi

X=$(mktemp -d "${TMPDIR:-/tmp}/agent-ws-smoke-XXXXXX")
X=$(cd "$X" && pwd -P)
REPO=$X/ghq/github.com/acme/api
FEATURE=$X/ghq/github.com/acme/api-feat

# 呼び出し元が Claude Code の中でも、別の claude として動かす
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID CLAUDE_CODE_REMOTE_SESSION_ID TMUX
export TMUX_TMPDIR=$X AGENT_WS_STATE_DIR=$X/state GHQ_ROOT=$X/ghq AGENT_WS_NOTIFY= AGENT_WS_DUMP=$X/dump.jsonl CLAUDE_CONFIG_DIR=$X/claude
export PATH=$X/bin:$PATH # ghq があっても GHQ_ROOT を見させる
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=smoke GIT_AUTHOR_EMAIL=smoke@example.com GIT_COMMITTER_NAME=smoke GIT_COMMITTER_EMAIL=smoke@example.com

mkdir -p "$X/bin" "$X/claude" "$REPO"
printf '#!/bin/sh\nexit 1\n' >"$X/bin/ghq" && chmod +x "$X/bin/ghq"
(cd "$REPO" && git init -q -b main && echo smoke >README.md && git add . && git commit -q -m init && git worktree add -q -b feat "$FEATURE")
printf '{"hasCompletedOnboarding":true,"theme":"dark","projects":{"%s":{"hasTrustDialogAccepted":true,"hasCompletedProjectOnboarding":true}}}\n' "$FEATURE" >"$X/claude/.claude.json"
bun "$ENTRY" hooks-config >"$X/hooks.json"

aws() { bun "$ENTRY" "$@"; }
PASS=0
FAIL=0
pass() { echo "  PASS $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }
# wait_for <説明> <秒> <コマンド…>: コマンドが成功するまで待つ
wait_for() {
  local what=$1 secs=$2 i
  shift 2
  for ((i = 0; i < secs * 2; i++)); do
    if "$@" >/dev/null 2>&1; then pass "$what"; return 0; fi
    sleep 0.5
  done
  fail "$what（最後の一覧: $(aws list | grep -E 'claude|⤷' | head -1)／印: [$(aws status)]）"
  return 1
}
screen() { tmux capture-pane -p -t smoke; }
screen_has() { screen | grep -q -- "$1"; }
list_has() { aws list | grep -q -- "$1"; }
status_is() { [ "$(aws status)" = "$1" ]; }
no_logs() { [ -z "$(ls "$X/state" 2>/dev/null)" ]; }
send() { tmux send-keys -t smoke -l "$1" && sleep 0.5 && tmux send-keys -t smoke Enter; }
seen() { aws seen "$(tmux display-message -p -t smoke '#{pane_pid}')"; }

finish() {
  echo
  echo "hook の入力（$X/dump.jsonl）:"
  grep -oE '"hook_event_name": ?"[A-Za-z]+"' "$X/dump.jsonl" 2>/dev/null | sed -E 's/.*"([A-Za-z]+)"$/\1/' | sort | uniq -c | sed 's/^/  /'
  echo
  echo "PASS $PASS / FAIL $FAIL  （claude $(claude --version 2>/dev/null)）"
  if [ $FAIL -gt 0 ] || [ $KEEP = 1 ]; then
    echo "残した: $X"
    echo "  画面を見る: TMUX_TMPDIR=$X tmux attach -t smoke"
    echo "  片付ける:   TMUX_TMPDIR=$X tmux kill-server; rm -rf $X"
  else
    tmux kill-server
    rm -rf "$X"
  fi
  [ $FAIL = 0 ]
  exit $?
}

echo "== 起動"
tmux -f /dev/null new-session -d -s smoke -x 160 -y 45 -c "$FEATURE" "claude --settings '$X/hooks.json'; sleep 3600"
if ! wait_for "入力待ちで一覧に出る（hook から本体の pid が分かる）" 60 list_has "入力待ち"; then
  screen_has -i "log in\|login\|sign in\|api key" && echo "  認証できていません。ANTHROPIC_API_KEY か CLAUDE_CODE_OAUTH_TOKEN を設定してください"
  finish
fi
wait_for "印は無い" 5 status_is ""

echo "== 完了（クライアントが無いので、誰も見ていない）"
send "1+1は？数字だけ答えて"
wait_for "完了すると ✓" 120 status_is "✓"
wait_for "一覧に完了" 5 list_has "✓ 完了"
seen
wait_for "そのペインにフォーカスすると確認済み" 5 status_is ""

echo "== 許可して実行"
send 'Bash で `echo a > approve.txt` を実行して、終わったら一言で報告して'
wait_for "許可を求めると ⏳" 120 status_is "⏳"
wait_for "一覧に許可待ちの理由" 5 list_has "echo a > approve.txt"
tmux send-keys -t smoke 1
wait_for "許可すると実行して完了" 120 status_is "✓"
wait_for "コマンドが実行された" 5 test -f "$FEATURE/approve.txt"
seen

echo "== 拒否"
send 'Bash で `echo b > deny.txt` を実行して'
wait_for "許可を求めると ⏳" 120 status_is "⏳"
NO=$(screen | grep -oE '[0-9]\. No' | head -1 | cut -c1)
tmux send-keys -t smoke "${NO:-3}"
wait_for "拒否すると中断（会話ログから検出）" 30 list_has "中断しました"
wait_for "印は無い" 5 status_is ""

echo "== 質問"
send 'AskUserQuestion ツールで「好きな色は？」と、赤・青の2択で質問して。答えを聞いたら一言で返して'
wait_for "質問すると ❓" 120 status_is "❓"
for _ in 1 2 3; do # 選択肢を選び、確認の画面があれば送る
  tmux send-keys -t smoke Enter
  sleep 3
  status_is "❓" || break
done
wait_for "答えると完了" 120 status_is "✓"
seen

echo "== Esc で中断"
send 'ツールは使わずに、日本の47都道府県それぞれについて3文ずつ説明して'
wait_for "応答中は実行中" 60 list_has "実行中"
wait_for "応答が出はじめる" 120 screen_has "北海道"
tmux send-keys -t smoke Escape
wait_for "Esc で中断（会話ログから検出）" 30 list_has "中断しました"

echo "== 終了"
send "/exit"
wait_for "SessionEnd で記録が消える" 30 no_logs
wait_for "一覧から消える" 10 sh -c "! bun '$ENTRY' list | grep -q 'claude'"

finish
