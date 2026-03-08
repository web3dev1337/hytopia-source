#!/bin/bash
# Build modified SDK and npm-link it for use by external games
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ROOT="$DEFAULT_REPO_ROOT"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-repo)
      REPO_ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--engine-repo <path>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

bash "$SCRIPT_DIR/ensure-node-modules.sh" \
  --source-repo "$DEFAULT_REPO_ROOT" \
  --target-repo "$REPO_ROOT" \
  --packages "server,protocol,sdk"

echo "Building SDK from $REPO_ROOT/server ..."
cd "$REPO_ROOT/server"

SERVER_BUILD_SCRIPT=$(node - <<'NODE'
const pkg = require('./package.json');

if (pkg.scripts && pkg.scripts['build:server']) {
  console.log('build:server');
  process.exit(0);
}

console.log('build');
NODE
)

npm run "$SERVER_BUILD_SCRIPT"

echo "Linking SDK from $REPO_ROOT/sdk ..."
cd "$REPO_ROOT/sdk"
npm link

SDK_VERSION=$(node -e "console.log(require('./package.json').version)")
echo ""
echo "SDK v${SDK_VERSION} linked globally."
echo "In game directories, run: npm link hytopia"
