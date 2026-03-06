#!/bin/bash
# Usage: ./setup-game.sh <game-dir>
# Links our modified SDK into a game directory
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <game-dir>"
  echo "Example: $0 ~/GitHub/games/hytopia/games/HyFire2/work1"
  exit 1
fi

GAME_DIR="$(cd "$1" && pwd)"

if [ ! -f "$GAME_DIR/package.json" ]; then
  echo "Error: No package.json found in $GAME_DIR"
  exit 1
fi

echo "Linking hytopia SDK into $GAME_DIR ..."
cd "$GAME_DIR"
npm link hytopia

SDK_VERSION=$(node -e "console.log(require('hytopia/package.json').version)")
echo ""
echo "Game at $GAME_DIR now using local SDK v${SDK_VERSION}"
echo ""
echo "Launch with:"
echo "  HYTOPIA_PERF_TOOLS=1 hytopia start"
