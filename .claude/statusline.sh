#!/bin/sh
# Cross-platform launcher for the Claude Code status line.
#
# Why this exists: statusline.py needs a *real* Python interpreter, but the
# command in settings.json is shared between machines (macOS + Windows) and the
# interpreter differs:
#   - macOS:   `python3` is a real interpreter on PATH.
#   - Windows: `python` / `python3` are Microsoft Store ALIAS STUBS that print
#              nothing and exit 0 (this silently blanks the status bar). The
#              real Python here is provided by the `uv` version manager.
#
# We probe in order, run the first real interpreter found (skipping the
# WindowsApps stub), and CACHE its path so later refreshes skip the slow
# `uv` resolution (~200ms -> ~95ms). stdin (Claude Code's status JSON) is
# passed straight through. The cache is machine-local (gitignored).
dir=$(dirname "$0")
script="$dir/statusline.py"
cache="$dir/cache/python-path"

# --- fast path: reuse a previously-resolved interpreter -----------------------
if [ -f "$cache" ]; then
  read -r cached < "$cache"
  if [ -n "$cached" ] && [ -x "$cached" ]; then
    exec "$cached" "$script"
  fi
fi

remember() {   # $1 = interpreter to cache + run
  mkdir -p "$dir/cache" 2>/dev/null
  printf '%s\n' "$1" > "$cache" 2>/dev/null
  exec "$1" "$script"
}

# 1. A real python3 / python on PATH (macOS, Linux, genuine Windows install).
for py in python3 python; do
  p=$(command -v "$py" 2>/dev/null) || continue
  case "$p" in *WindowsApps*) continue ;; esac   # skip the MS Store alias stub
  remember "$p"
done

# 2. Version-manager Python (uv on Windows): resolve the exe once and cache it.
if command -v uv >/dev/null 2>&1; then
  pyexe=$(uv python find 2>/dev/null)
  if [ -n "$pyexe" ]; then
    command -v cygpath >/dev/null 2>&1 && pyexe=$(cygpath -u "$pyexe")
    remember "$pyexe"
  fi
  exec uv run --no-project python "$script"   # last resort if `find` failed
fi

# Nothing usable — emit a hint instead of a silent blank bar.
printf 'statusline: no python interpreter found (install python3, or `uv`)'
