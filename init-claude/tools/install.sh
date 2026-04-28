#!/usr/bin/env bash
# Installs the _claude template to ~/.claude
# Usage: ./tools/install.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE="$REPO_ROOT/_claude"
TARGET="$HOME/.claude"
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

log() { echo "[$( $DRY_RUN && echo DRY-RUN || echo INSTALL)] $*"; }

# Files/dirs to copy (never clobber runtime data)
COPY_ITEMS=(
  "CLAUDE.md"
  "settings.json"
  "keybindings.json"
  "mcp.json"
  "commands"
  "hooks"
  "skills"
)

mkdir -p "$TARGET"

for ITEM in "${COPY_ITEMS[@]}"; do
  SRC="$SOURCE/$ITEM"
  DST="$TARGET/$ITEM"

  [[ ! -e "$SRC" ]] && continue

  if $DRY_RUN; then
    log "Would copy: $SRC → $DST"
  else
    if [[ -d "$SRC" ]]; then
      cp -r "$SRC" "$DST"
    else
      cp "$SRC" "$DST"
    fi
    log "Copied: $ITEM"
  fi
done

# Make hooks executable
if ! $DRY_RUN; then
  find "$TARGET/hooks" -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true
  log "Hooks made executable"
fi

log "Done. Restart Claude Code to apply changes."
echo ""
echo "Next steps:"
echo "  1. RTK hook script: run 'rtk init -g' to install ~/.claude/hooks/rtk-rewrite.sh"
echo "     (settings.json already references it — hook is inactive until rtk is installed)"
echo "  2. Figma MCP: first connection will open browser OAuth"
