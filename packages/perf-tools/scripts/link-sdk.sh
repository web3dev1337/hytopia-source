#!/bin/bash
# Build modified SDK and npm-link it for use by external games
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "Building SDK from $REPO_ROOT/server ..."
cd "$REPO_ROOT/server"
npm run build

echo "Linking SDK from $REPO_ROOT/sdk ..."
cd "$REPO_ROOT/sdk"
npm link

SDK_VERSION=$(node -e "console.log(require('./package.json').version)")
echo ""
echo "SDK v${SDK_VERSION} linked globally."
echo "In game directories, run: npm link hytopia"
