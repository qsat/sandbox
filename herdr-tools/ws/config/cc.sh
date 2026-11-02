# ~/.zshrc などから source する
cc() {
  if [ -n "${HC_TERMINAL_ID:-}" ]; then command claude "$@"; else ws new --here -- "$@"; fi
}
