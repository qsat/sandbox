#!/usr/bin/env bash
# E2E: スタブの herdr-core（ws-core/test/stub/hc）と実際の tmux（専用ソケット）で ws の全コマンドを通す。
#   bash ws/test/e2e.sh（または herdr-tools で bun run e2e）
# 必要なもの: bun, tmux 3.2+, git, jq
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
SOCK="ws-e2e-$$"

export HC_BIN="$ROOT/../ws-core/test/stub/hc"
export HC_STUB_STATE="$TMP/hc.json"
export WS_TMUX_SOCKET="$SOCK"
export GHQ_ROOT="$TMP/ghq"
export GHQ_BIN="/nonexistent-ghq" # ghq が無いときの走査で一覧を作る
export WS_PANES_MAX=8
unset TMUX TMUX_PANE

ws() { bun "$ROOT/cli.ts" "$@"; }
t() { tmux -L "$SOCK" "$@"; }
state() { jq -r "$1" "$HC_STUB_STATE"; }
pass=0
ok() { pass=$((pass + 1)); printf '  \033[32mok\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mNG\033[0m %s\n' "$1" >&2; exit 1; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1: expected [$3] got [$2]"; fi; }

cleanup() {
  t kill-server 2>/dev/null || true
  [ -n "${CLIENT_PID:-}" ] && kill "$CLIENT_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
# E2E_DEBUG=1 なら一時ディレクトリと tmux サーバを残す
if [ -n "${E2E_DEBUG:-}" ]; then trap - EXIT; fi

# --- 作業場所: ghq + gwq と同じ並び（repo と repo=branch が横並び） ---
API="$GHQ_ROOT/github.com/o/api"
FEAT="$GHQ_ROOT/github.com/o/api=feat-auth"
GONE="$GHQ_ROOT/github.com/o/api=gone"
mkdir -p "$API"
git -C "$API" init -q -b main
git -C "$API" -c user.email=e2e@example.com -c user.name=e2e commit -q --allow-empty -m init
git -C "$API" worktree add -q -b feat-auth "$FEAT"
git -C "$API" worktree add -q -b gone "$GONE"
API="$(cd "$API" && pwd -P)"; FEAT="$(cd "$FEAT" && pwd -P)"; GONE="$(cd "$GONE" && pwd -P)"

echo "list"
check "最初は空" "$(ws list --json | jq '.workspaces | length')" "0"
check "--all で ghq の全エントリ" "$(ws list --json --all | jq '[.workspaces[].worktrees[]] | length')" "3"
check "repo と repo=branch が同じ workspace" "$(ws list --json --all | jq '.workspaces | length')" "1"

# --- tmux: セッションと、切り替え対象のクライアント（コントロールモード） ---
t new-session -d -s api -c "$API"
mkfifo "$TMP/client.in"
(t -C attach -t api <"$TMP/client.in" >/dev/null 2>&1) &
CLIENT_PID=$!
exec 9>"$TMP/client.in"
for _ in $(seq 50); do [ -n "$(t list-clients -F '#{client_name}')" ] && break; sleep 0.1; done
CLIENT="$(t list-clients -F '#{client_name}' | head -1)"
[ -n "$CLIENT" ] || fail "tmux クライアントが作れない"
client_session() { t list-clients -F '#{client_name} #{client_session}' | awk -v c="$CLIENT" '$1==c{print $2}'; }

echo "new / hook"
out="$(cd "$FEAT/" && ws new)"
check "ws new は <address> <name>" "$out" "$(printf 't1\tapi-feat-auth')"
check "ラベル ws" "$(state '.terminals[0].labels.ws')" "$API"
check "ラベル wt" "$(state '.terminals[0].labels.wt')" "$FEAT"
check "--keep で、待たずに起動" "$(state '[.log[] | select(.[0]=="terminal.run")][0][1] | "\(.keep) \(.wait)"')" "true false"
echo '{"session_id":"sess-1","source":"startup"}' | HC_TERMINAL_ID=t1 ws hook session-start
check "hook がセッションIDを記録" "$(state '.terminals[0].labels["claude.session"]')" "sess-1"
check "hook は core の外では何もしない" "$(echo '{"session_id":"x"}' | ws hook session-start; echo $?)" "0"
check "hook は壊れた入力でも失敗しない" "$(echo 'not json' | HC_TERMINAL_ID=t1 ws hook session-start; echo $?)" "0"

echo "list（core × tmux × git）"
J="$(ws list --json)"
check "worktree 2つ（セッションのある api、エージェントのいる feat）" "$(jq '[.workspaces[].worktrees[]] | length' <<<"$J")" "2"
check "エージェントは feat に入る" "$(jq -r '.workspaces[0].worktrees[] | select(.agents|length>0) | .path' <<<"$J")" "$FEAT"
check "未 attach" "$(jq '.workspaces[0].worktrees[].agents[] | .tmux.attached' <<<"$J")" "false"

echo "go（agent・セッション無し → 作成・agents ウィンドウ・切り替え）"
ws go t1 --client "$CLIENT"
check "tm 規則のセッション" "$(t list-sessions -F '#{session_name}' | grep -c '^api=feat-auth$')" "1"
check "agents ウィンドウに @ws_agent=t1 のペイン" "$(t list-panes -a -F '#{session_name}:#{window_name} #{@ws_agent}' | grep -c '^api=feat-auth:agents t1$')" "1"
check "クライアントが移動" "$(client_session)" "api=feat-auth"
check "ペインで hc attach が動く" "$(sleep 0.5; t capture-pane -p -t '=api=feat-auth:agents' | grep -c 'attached to t1')" "1"

echo "go（agent・attach 済み → 二重に attach しない）"
ws go t1 --client "$CLIENT"
check "ペインは1つのまま" "$(t list-panes -a -F '#{@ws_agent}' | grep -c '^t1$')" "1"

echo "go（worktree）"
ws go "$API" --client "$CLIENT"
check "api に移動" "$(client_session)" "api"
ws go "$FEAT/" --client "$CLIENT"
check "パス指定でも移動（末尾 / 付き）" "$(client_session)" "api=feat-auth"

echo "resume（claude を失って --keep のシェルに置き換わった状態）"
jq '.terminals[0].foreground = {"name":"zsh","argv":["zsh"],"cwd":"/"}' "$HC_STUB_STATE" >"$TMP/s" && mv "$TMP/s" "$HC_STUB_STATE"
check "要再開と判定" "$(ws list --json | jq '.workspaces[0].worktrees[].agents[] | .needsResume')" "true"
ws go t1 --client "$CLIENT"
check "go の中で claude --resume を送る" "$(state '[.log[] | select(.[0]=="terminal.send")][0][1].text')" "claude --resume sess-1"
check "再開後は要再開でない" "$(ws list --json | jq '.workspaces[0].worktrees[].agents[] | .needsResume')" "false"
check "2回目の resume は何もしない" "$(ws resume t1)" "skip t1: running"
check "send は1回だけ" "$(state '[.log[] | select(.[0]=="terminal.send")] | length')" "1"

echo "go --dry-run"
check "計画だけ出す" "$(ws go "$API" --client "$CLIENT" --dry-run | jq -r '.[0].op')" "switchClient"

echo "panes（worktree のエージェントを並べる）"
(cd "$FEAT" && ws new >/dev/null && ws new >/dev/null)
check "重複名は -2, -3" "$(state '[.terminals[].name] | join(",")')" "api-feat-auth,api-feat-auth-2,api-feat-auth-3"
jq '.terminals[2].parent = "t1"' "$HC_STUB_STATE" >"$TMP/s" && mv "$TMP/s" "$HC_STUB_STATE"
PANE="$(t list-panes -t '=api=feat-auth:agents' -F '#{pane_id}' | head -1)"
check "既定は子を含めない" "$(ws panes --pane "$PANE")" "ws panes: 1 開いた / 1 表示済み"
check "-a で子も" "$(ws panes -a --pane "$PANE")" "ws panes: 1 開いた / 2 表示済み"
check "もう開くものは無い" "$(ws panes -a --pane "$PANE")" "ws panes: 0 開いた / 3 表示済み"
check "agents ウィンドウに3ペイン" "$(t list-panes -t '=api=feat-auth:agents' | wc -l | tr -d ' ')" "3"

echo "new --attach"
BEFORE="$(state '.log | length')"
(cd "$API" && ws new --attach --client "$CLIENT")
check "hc への接続は1本を使い回す" "$(state ".log[$BEFORE:] | map(select(.[0]==\"connect\")) | length")" "1"
check "一覧は名前決めと移動先の木の2回だけ（起動後に引き直さない）" "$(state ".log[$BEFORE:] | map(select(.[0]==\"terminal.list\")) | length")" "2"
check "起動して会話ペインへ" "$(client_session)" "api"
check "api の agents ウィンドウに t4" "$(t list-panes -a -F '#{session_name}:#{window_name} #{@ws_agent}' | grep -c '^api:agents t4$')" "1"

echo "prune（ディレクトリごと消された worktree）"
(cd "$GONE" && ws new >/dev/null)
ws go "$GONE" --client "$CLIENT"
ws go "$API" --client "$CLIENT"
rm -rf "$GONE"
P="$(ws prune --dry-run)"
check "場所消失のセッションを挙げる" "$(grep -c '^tmux session: api=gone$' <<<"$P")" "1"
check "場所消失のエージェントを挙げる" "$(grep -c '^agent: t5 ' <<<"$P")" "1"
check "場所消失と表示" "$(ws list --json | jq '[.workspaces[].worktrees[] | select(.exists==false)] | length')" "1"
ws prune --yes >/dev/null
check "セッションを閉じた" "$(t list-sessions -F '#{session_name}' | grep -c '^api=gone$' || true)" "0"
check "エージェントを終了・削除" "$(state '[.terminals[] | select(.address=="t5")] | length')" "0"

echo "list（テキスト）"
ws list

echo "ui（pty で開いてキー操作）"
ws go "$FEAT" --client "$CLIENT"
# 先頭の選択行は api（main worktree）。Enter で ws go が走り、popup は閉じる
UI_OUT="$( (sleep 2.5; printf '\r') | script -qec "bun $ROOT/cli.ts ui --client '$CLIENT'" /dev/null | tr -d '\r')"
check "一覧に worktree とエージェントが出る" "$(grep -c 'api-feat-auth' <<<"$UI_OUT" | awk '{print ($1>0)}')" "1"
check "Enter で選択行へ移動" "$(client_session)" "api"
UI_OUT="$( (sleep 2.5; printf 'jjq') | script -qec "bun $ROOT/cli.ts ui --client '$CLIENT'" /dev/null; echo "exit=$?")"
check "q で閉じる" "$(grep -o 'exit=[0-9]*' <<<"$UI_OUT" | tail -1)" "exit=0"

echo
echo "E2E: $pass checks passed"
