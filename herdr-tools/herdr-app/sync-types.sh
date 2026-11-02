#!/usr/bin/env bash
# Herdr app が生成した mod の型定義（gpui-kit.d.ts。"herdr" モジュールを含む）を herdr-app/types/ に写す。
# 生成物はアプリの版ごとに変わり、アプリ自身も「コミットせず gitignore に入れる」よう指示しているので、リポジトリには置かない。
#   出力: 写したら 0。Herdr app が無い（d.ts が見つからない）ときは理由を出して 1
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

for candidate in "$APP_DIR/mods/agent-board/gpui-kit.d.ts" "$APP_DIR/mods/agents/gpui-kit.d.ts"; do
  if [ -f "$candidate" ]; then
    mkdir -p "$HERE/types"
    cp "$candidate" "$HERE/types/gpui-kit.d.ts"
    echo "types: $candidate → herdr-app/types/gpui-kit.d.ts"
    exit 0
  fi
done

echo "types: $APP_DIR/mods/*/gpui-kit.d.ts が無い。Herdr app を一度起動してから実行する" >&2
exit 1
