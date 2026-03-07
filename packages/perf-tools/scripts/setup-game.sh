#!/bin/bash
# Usage: ./setup-game.sh <game-dir>
# Links our modified SDK into a game directory
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ -z "$1" ]; then
  echo "Usage: $0 <game-dir>"
  echo "Examples:"
  echo "  $0 /home/ab/GitHub/games/hyfire2-sdk-compat"
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

for SDK_RUNTIME_DEP in \
  "@fails-components/webtransport" \
  "@fails-components/webtransport-transport-http3-quiche"
do
  SDK_RUNTIME_SOURCE="$REPO_ROOT/node_modules/$SDK_RUNTIME_DEP"

  if [ ! -e "$SDK_RUNTIME_SOURCE" ]; then
    SDK_RUNTIME_SOURCE="$REPO_ROOT/server/node_modules/$SDK_RUNTIME_DEP"
  fi

  if [ ! -e "$SDK_RUNTIME_SOURCE" ]; then
    echo "Error: runtime dependency $SDK_RUNTIME_DEP is missing from local SDK workspace"
    exit 1
  fi

  mkdir -p "$GAME_DIR/node_modules/$(dirname "$SDK_RUNTIME_DEP")"
  rm -rf "$GAME_DIR/node_modules/$SDK_RUNTIME_DEP"
  ln -s "$SDK_RUNTIME_SOURCE" "$GAME_DIR/node_modules/$SDK_RUNTIME_DEP"
done

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
