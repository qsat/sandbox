#!/usr/bin/env bash
# herdr-tools を手元の Mac に入れる。
#   ./install.sh            ws のビルドと配置、mod とレイアウトの配置
#   ./install.sh --dry-run  何をするかだけ表示
# ~/.tmux.conf と ~/.claude/settings.json は dotfiles（chezmoi）で管理しているので、ここでは書き換えず追記内容を表示する。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
run() { echo "+ $*"; [ "$DRY" = 1 ] || "$@"; }

BIN_DIR="${WS_BIN_DIR:-$HOME/.local/bin}"
APP_DIR="${HERDR_APP_DIR:-$HOME/.config/herdr-app}"

echo "== ws と mod をビルドする（dist/ws、dist/mods/agent-board/）"
run bash -c "cd '$HERE' && bun install --frozen-lockfile >/dev/null && bun run build"
echo "== ws を $BIN_DIR/ws に置く"
run mkdir -p "$BIN_DIR"
run cp "$HERE/dist/ws" "$BIN_DIR/ws"

echo "== mod（バンドル済みの main.js と mod.json）を $APP_DIR/mods/agent-board に置く"
run mkdir -p "$APP_DIR/mods/agent-board" "$APP_DIR/layouts"
run cp "$HERE/dist/mods/agent-board/"* "$APP_DIR/mods/agent-board/"
if [ -e "$APP_DIR/layouts/agents.json" ]; then
  echo "  (layouts/agents.json は既にあるので触らない)"
else
  run cp "$HERE/herdr-app/layouts/agents.json" "$APP_DIR/layouts/agents.json"
fi
if command -v herdr-app >/dev/null 2>&1; then
  run herdr-app check "$APP_DIR/mods/agent-board"
else
  echo "  (herdr-app が無いので check は省略。入れたら: herdr-app check $APP_DIR/mods/agent-board)"
fi

cat <<MSG

== 手で追記するもの（dotfiles 側）
--- ~/.tmux.conf ---
$(grep -v '^#' "$HERE/tmux/config/tmux.conf" | sed '/^$/d')

--- ~/.claude/settings.json（hooks に追加）---
$(cat "$HERE/ws/config/claude-settings.json")
MSG
