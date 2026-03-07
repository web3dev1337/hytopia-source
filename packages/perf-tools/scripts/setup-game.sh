#!/bin/bash
# Usage: ./setup-game.sh <game-dir>
# Links our modified SDK into a game directory
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <game-dir>"
  echo "Examples:"
  echo "  $0 /home/ab/GitHub/games/hyfire2"
  echo "  $0 /home/ab/GitHub/games/hytopia/zoo-game/work1"
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

SDK_VERSION=$(node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

let dir = path.dirname(require.resolve('hytopia'));

while (dir !== path.dirname(dir)) {
  const pkgPath = path.join(dir, 'package.json');

  if (fs.existsSync(pkgPath)) {
    console.log(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version);
    process.exit(0);
  }

  dir = path.dirname(dir);
}

process.exit(1);
NODE
)
echo ""
echo "Game at $GAME_DIR now using local SDK v${SDK_VERSION}"
echo ""
echo "Launch with:"
echo "  HYTOPIA_PERF_TOOLS=1 hytopia start"
