#!/usr/bin/env bash

set -euo pipefail

required_node_major=24

node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'Number(process.versions.node.split(".")[0])'
}

has_required_node() {
  local current_major
  current_major="$(node_major 2>/dev/null || true)"
  [[ "$current_major" =~ ^[0-9]+$ ]] && ((current_major >= required_node_major))
}

select_node() {
  if has_required_node; then
    return
  fi

  local nvm_directory="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_directory/nvm.sh" ]]; then
    export NVM_DIR="$nvm_directory"
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
    nvm use --silent >/dev/null 2>&1 || true
  fi

  if has_required_node; then
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    local homebrew_node_prefix
    homebrew_node_prefix="$(brew --prefix node@24 2>/dev/null || true)"
    if [[ -n "$homebrew_node_prefix" ]]; then
      export PATH="$homebrew_node_prefix/bin:$PATH"
    fi
  fi
}

select_node

if ! has_required_node; then
  cat >&2 <<'MESSAGE'
Node.js 24 以上が必要です。
`.nvmrc` を使って Node.js 24 を導入するか、macOS では `brew install node@24` を実行してください。
MESSAGE
  exit 1
fi

if (($# == 0)); then
  printf 'usage: %s <command> [args...]\n' "$0" >&2
  exit 2
fi

exec "$@"
