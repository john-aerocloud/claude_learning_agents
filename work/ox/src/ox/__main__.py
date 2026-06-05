"""Entry point: `python -m ox` runs one game (human X vs perfect AI O) and
exits 0. The default players map (human X via stdin, ``ai_move`` for O) is
supplied by ``game.default_players``; this entry point is config-only."""
import sys

from .game import main

if __name__ == "__main__":
    sys.exit(main())
