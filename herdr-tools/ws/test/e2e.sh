#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
SOCK="ws-e2e-$$"

export HC_BIN="$ROOT/../ws-core/test/fake-hc/hc"
export FAKE_HC_STATE="$TMP/hc.json"
export WS_TMUX_SOCKET="$SOCK"
export GHQ_ROOT="$TMP/ghq"
export GHQ_BIN="ghq-not-installed"
export WS_PANES_MAX=8
unset TMUX TMUX_PANE

ws() { bun "$ROOT/cli.ts" "$@"; }
# -f /dev/null: 利用者の ~/.tmux.conf（prefix が C-Space、hook あり）を読まない。設定は後で tmux/config/tmux.conf だけを source-file する
t() { tmux -f /dev/null -L "$SOCK" "$@"; }
state() { jq -r "$1" "$FAKE_HC_STATE"; }
edit_state() { jq "$1" "$FAKE_HC_STATE" >"$TMP/s" && mv "$TMP/s" "$FAKE_HC_STATE"; }
pass=0
ok() { pass=$((pass + 1)); printf '  \033[32mok\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mNG\033[0m %s\n' "$1" >&2; exit 1; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1: expected [$3] got [$2]"; fi; }

# util-linux の script は -c でコマンドを受け取り、BSD（macOS）の script は引数の残りをコマンドとして受け取る
if script -qec true /dev/null >/dev/null 2>&1; then
  in_pty() { script -qec "$1" /dev/null; }
else
  in_pty() { script -q /dev/null sh -c "$1"; }
fi

# ws ui は pty の出力に一覧が出てからキーを送る（固定の sleep だと、起動が遅いとき一覧が出る前のキーが捨てられる）。
# 使い方: ui_drive <出力ファイル> <キー | wait:<出力に現れるのを待つ文字列> | sleep:<秒>>...
# 一覧が出ない・待つ文字列が現れないときは 15 秒で待つのをやめて残りのキー（最後の q）を送るので、止まらず、後続の check が失敗として出る
without_cr() { tr -d '\r' <"$1"; }
out_has() { [ "$(without_cr "$1" | grep -cF -- "$2")" -gt 0 ]; }
wait_out() { for _ in $(seq 150); do out_has "$1" "$2" && return 0; sleep 0.1; done; return 0; }
ui_drive() {
  local out="$1"; shift
  : >"$out"
  {
    trap '' PIPE # ui が先に閉じたあとに送るキーは捨てる
    wait_out "$out" 'api-feat-auth'
    for item in "$@"; do
      case "$item" in
        wait:*) wait_out "$out" "${item#wait:}" ;;
        sleep:*) sleep "${item#sleep:}" ;;
        *) printf '%s' "$item" 2>/dev/null || true ;;
      esac
    done
  } | in_pty "bun $ROOT/cli.ts ui --client '$CLIENT'" >"$out"
}

cleanup() {
  t kill-server 2>/dev/null || true
  [ -n "${CLIENT_PID:-}" ] && kill "$CLIENT_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
[ -n "${E2E_KEEP_TMP:-}" ] || trap cleanup EXIT

create_repo_and_worktrees_side_by_side_like_gwq() {
  API="$GHQ_ROOT/github.com/o/api"
  FEAT="$GHQ_ROOT/github.com/o/api=feat-auth"
  GONE="$GHQ_ROOT/github.com/o/api=gone"
  mkdir -p "$API"
  git -C "$API" init -q -b main
  git -C "$API" -c user.email=e2e@example.com -c user.name=e2e commit -q --allow-empty -m init
  git -C "$API" worktree add -q -b feat-auth "$FEAT"
  git -C "$API" worktree add -q -b gone "$GONE"
  API="$(cd "$API" && pwd -P)"; FEAT="$(cd "$FEAT" && pwd -P)"; GONE="$(cd "$GONE" && pwd -P)"
}

start_control_mode_client_on_session_api() {
  t new-session -d -s api -c "$API"
  mkfifo "$TMP/client.in"
  (t -C attach -t api <"$TMP/client.in" >/dev/null 2>&1) &
  CLIENT_PID=$!
  exec 9>"$TMP/client.in"
  for _ in $(seq 50); do [ -n "$(t list-clients -F '#{client_name}')" ] && break; sleep 0.1; done
  CLIENT="$(t list-clients -F '#{client_name}' | head -1)"
  [ -n "$CLIENT" ] || fail "tmux クライアントが作れない"
}

client_session() { t list-clients -F '#{client_name} #{client_session}' | awk -v c="$CLIENT" '$1==c{print $2}'; }

create_repo_and_worktrees_side_by_side_like_gwq

echo "list"
check "最初は空" "$(ws list --json | jq '.workspaces | length')" "0"
check "--all で ghq の全エントリ" "$(ws list --json --all | jq '[.workspaces[].worktrees[]] | length')" "3"
check "repo と repo=branch が同じ workspace" "$(ws list --json --all | jq '.workspaces | length')" "1"

start_control_mode_client_on_session_api

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
check "worktree 3つ（セッションのある api、エージェントのいる feat、どちらも無い gone も並べる）" "$(jq '[.workspaces[].worktrees[]] | length' <<<"$J")" "3"
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
edit_state '.terminals[0].foreground = {"name":"zsh"}'
check "再開できると判定" "$(ws list --json | jq '.workspaces[0].worktrees[].agents[] | .resumable')" "true"
ws go t1 --client "$CLIENT"
check "go は勝手に再開しない" "$(state '[.log[] | select(.[0]=="terminal.send")] | length')" "0"
check "resume で claude --resume を送る" "$(ws resume t1)" "resumed t1 (sess-1)"
check "送った文" "$(state '[.log[] | select(.[0]=="terminal.send")][0][1].text')" "claude --resume sess-1"
check "再開後は再開の対象でない" "$(ws list --json | jq '.workspaces[0].worktrees[].agents[] | .resumable')" "false"
check "2回目の resume は何もしない" "$(ws resume t1)" "skip t1: running"
check "send は1回だけ" "$(state '[.log[] | select(.[0]=="terminal.send")] | length')" "1"

echo "go --dry-run"
check "計画だけ出す" "$(ws go "$API" --client "$CLIENT" --dry-run | jq -r '.[0].op')" "switchClient"

echo "panes（worktree のエージェントを並べる）"
(cd "$FEAT" && ws new >/dev/null && ws new >/dev/null)
check "重複名は -2, -3" "$(state '[.terminals[].name] | join(",")')" "api-feat-auth,api-feat-auth-2,api-feat-auth-3"
edit_state '.terminals[2].parent = "t1"'
PANE="$(t list-panes -t '=api=feat-auth:agents' -F '#{pane_id}' | head -1)"
ELSEWHERE="$(t new-window -d -P -F '#{pane_id}' -t '=api=feat-auth:' -n other "$HC_BIN attach t2")"
t set-option -p -t "$ELSEWHERE" @ws_agent t2
check "既定は子を含めない。別のウィンドウの会話ペインは集める" "$(ws panes --pane "$PANE")" "ws panes: 0 開いた / 1 集めた / 1 表示済み"
check "集めたペインは agents ウィンドウへ移る（開き直さない）" "$(t display -p -t "$ELSEWHERE" '#{session_name}:#{window_name}') $(t list-panes -a -F '#{@ws_agent}' | grep -c '^t2$')" "api=feat-auth:agents 1"
check "空になったウィンドウは閉じる" "$(t list-windows -t '=api=feat-auth' -F '#{window_name}' | grep -c '^other$' || true)" "0"
check "-a で子も" "$(ws panes -a --pane "$PANE")" "ws panes: 1 開いた / 0 集めた / 2 表示済み"
check "もう開くものは無い" "$(ws panes -a --pane "$PANE")" "ws panes: 0 開いた / 0 集めた / 3 表示済み"
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

echo "stop（エージェントを止めて一覧から消す）"
check "止めた" "$(ws stop t4)" "stopped t4"
check "herdr-core から消えた" "$(state '[.terminals[] | select(.address=="t4")] | length')" "0"
check "無いものは止めない" "$(ws stop t4 || true)" "skip t4: not-found"

echo "statusline（Claude Code の rate_limits を herdr-core に記録して表示）"
NOW="$(date +%s)"
IN_2H30M=$((NOW + 2 * 3600 + 30 * 60 + 30))
IN_3D5H30M=$((NOW + 3 * 86400 + 5 * 3600 + 30 * 60 + 30))
status_line_json() { printf '{"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":41.2,"resets_at":%s}}}' "$1" "$IN_2H30M" "$IN_3D5H30M"; }
without_color() { sed 's/\x1b\[[0-9;]*m//g'; }
OUT="$(status_line_json 23.5 | ws statusline | without_color)"
check "消費した % とリセットまでの残り時間（5時間枠 → 週、週は分なし）" "$(without_color <<<"$OUT")" "24% 0d 2h 30m 41% 3d 5h"
check "herdr-core の doc（claude-usage）に記録" "$(state '.docs["claude-usage"].value.fiveHour.usedPercentage')" "23.5"
check "ws list --json に usage" "$(ws list --json | jq '.usage.sevenDay.usedPercentage')" "41.2"
check "ws list の先頭行に出す" "$(ws list | head -1 | without_color)" "24% 0d 2h 30m 41% 3d 5h"
status_line_json 23.5 | ws statusline >/dev/null
check "同じ値なら書き直さない" "$(state '.docs["claude-usage"].version')" "1"
status_line_json 30 | ws statusline >/dev/null
check "変わったら書く" "$(state '.docs["claude-usage"].version')" "2"
check "--quiet は記録だけで何も出さない" "$(status_line_json 31 | ws statusline --quiet)" ""
check "rate_limits が無い入力（API アカウントなど）でも失敗しない" "$(echo '{}' | ws statusline >/dev/null; echo $?)" "0"
printf '{"context_window":{"used_percentage":41.6}}' | HC_TERMINAL_ID=t1 ws statusline --quiet
check "context 使用率を自分の端末のラベルに記録（整数）" "$(state '.terminals[] | select(.address=="t1") | .labels["claude.context"]')" "42"
check "ws list --json のエージェントに contextUsedPercentage" "$(ws list --json | jq '[.workspaces[].worktrees[].agents[] | select(.id=="t1") | .contextUsedPercentage][0]')" "42"
check "一覧のエージェントの行に ctx 42%" "$(ws list | without_color | grep -c 'ctx 42%')" "1"

echo "list（テキスト）"
ws list

echo "ui（pty で開いてキー操作）"
ws go "$API" --client "$CLIENT"
UI="$TMP/ui.out"
# Enter のあとに q も送る: Enter が効かなくても ui が閉じ、止まらずに次の check の失敗として出る
ui_drive "$UI" $'\r' sleep:1 q
check "一覧に worktree とエージェントが出る" "$(out_has "$UI" 'api-feat-auth' && echo 1 || echo 0)" "1"
check "先頭の行（エージェントが動いている api=feat-auth）で Enter → そこへ移動して閉じる" "$(client_session)" "api=feat-auth"
UI_EXIT=0
ui_drive "$UI" jjq || UI_EXIT=$?
check "q で閉じる" "exit=$UI_EXIT" "exit=0"

echo "close（tmux セッションを閉じる。エージェントは止めない）"
has_session() { if t has-session -t "=$1" 2>/dev/null; then echo yes; else echo no; fi; }
check "閉じる前は api のセッションがある" "$(has_session api)" "yes"
# 最後の行は main の下のペインの行（移動だけで x は効かない）なので、k で 1 つ上の main の worktree の行に移ってから x を押す
ui_drive "$UI" Gkxn sleep:1 q
check "一覧で x のあと y 以外を押すと閉じない" "$(has_session api)" "yes"
ui_drive "$UI" Gkxy 'wait:閉じました: api' q
check "一覧で x → y で閉じる" "$(has_session api)" "no"
check "閉じたことを一覧に出す" "$(out_has "$UI" '閉じました: api' && echo 1 || echo 0)" "1"
check "セッションが無ければ何もしない" "$(ws close "$API")" "skip $API: no-session"
ws go "$API" --client "$CLIENT"
check "ws close で worktree のセッションを閉じる" "$(ws close "$FEAT")" "closed api=feat-auth"
check "api=feat-auth のセッションが消えた" "$(has_session api=feat-auth)" "no"
check "エージェントは herdr-core に残る" "$(state '[.terminals[] | select(.state=="live")] | length > 0')" "true"

echo "ui の s（エージェントを止めて一覧から消す）"
terminal_count() { state '[.terminals[]] | length'; }
BEFORE="$(terminal_count)"
ui_drive "$UI" jsn sleep:1 q
check "一覧で s のあと y 以外を押すと止めない" "$(terminal_count)" "$BEFORE"
ui_drive "$UI" jsy 'wait:停止しました' q
check "一覧で s → y で止めて herdr-core から消す" "$(terminal_count)" "$((BEFORE - 1))"
check "止めたことを一覧に出す" "$(out_has "$UI" '停止しました' && echo 1 || echo 0)" "1"

echo "new --here（今のペインで会話する）"
HERE_PANE="$(t new-window -d -P -F '#{pane_id}' -t '=api:' -c "$FEAT")"
pane_agent() { t show-options -p -t "$HERE_PANE" -v @ws_agent 2>/dev/null || true; }
t send-keys -t "$HERE_PANE" "bun $ROOT/cli.ts new --here" Enter
for _ in $(seq 100); do [ -n "$(pane_agent)" ] && break; sleep 0.1; done
HERE_ID="$(pane_agent)"
check "今のペインに会話の印（@ws_agent）を付ける" "$([ -n "$HERE_ID" ] && echo yes)" "yes"
check "今の worktree で herdr-core に起動" "$(state ".terminals[] | select(.address==\"$HERE_ID\") | .labels.wt")" "$FEAT"
sleep 0.5
check "今のペインで hc attach" "$(t capture-pane -p -t "$HERE_PANE" | grep -c "attached to $HERE_ID")" "1"
check "一覧では会話中" "$(ws list --json | jq -r --arg id "$HERE_ID" '.workspaces[].worktrees[].agents[] | select(.id==$id) | .tmux.attached')" "true"
t send-keys -t "$HERE_PANE" C-c
sleep 0.3
check "Ctrl+C は claude に届き、会話は続く" "$(pane_agent)" "$HERE_ID"

echo "prefix C-\\（会話中のペインから抜ける）"
t source-file "$ROOT/../tmux/config/tmux.conf"
focus_pane() { t select-window -t "$1"; t select-pane -t "$1"; t switch-client -c "$CLIENT" -t "$1"; }
focus_pane "$HERE_PANE"
t send-keys -K -c "$CLIENT" C-b 'C-\'
for _ in $(seq 50); do [ -z "$(pane_agent)" ] && break; sleep 0.1; done
check "抜けて印を外し、エージェントは動き続ける" "$(pane_agent)|$(state ".terminals[] | select(.address==\"$HERE_ID\") | .state")" "|live"
sleep 0.3
check "ペインは元のシェルに戻る（ws が終わる）" "$(t display -p -t "$HERE_PANE" '#{pane_current_command}' | grep -cv '^bun$')" "1"
PLAIN_PANE="$(t new-window -d -P -F '#{pane_id}' -t '=api:' 'cat -v')"
focus_pane "$PLAIN_PANE"
t send-keys -K -c "$CLIENT" C-b 'C-\'
sleep 0.3
check "会話中でないペインには送らない（SIGQUIT でプログラムを落とさない）" "$(t display -p -t "$PLAIN_PANE" '#{pane_id} #{pane_current_command}')" "$PLAIN_PANE cat"

echo
echo "E2E: $pass checks passed"
