#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

GAME_DIR=""
PRESET=""
CLIENT_URL=""
SERVER_CMD="npm start"
PORT="9091"
CPU_THROTTLE=""
OUTPUT=""
VERBOSE="false"

usage() {
  cat <<'EOF'
Usage:
  run-external-game-benchmark.sh --game-dir <path> --preset <name> --client-url <url> [options]

Required:
  --game-dir <path>      External game repo/worktree to benchmark
  --preset <name>        Built-in perf preset to run
  --client-url <url>     Client dev/prod URL used by the benchmark browser

Options:
  --server-cmd <cmd>     Command used to start the external game server (default: npm start)
  --port <port>          HTTPS port for the external game server (default: 9091)
  --cpu-throttle <rate>  Browser CPU throttle rate (example: 4, 16)
  --output <path>        Write benchmark JSON to this path
  --verbose              Enable verbose benchmark logging

Examples:
  bash packages/perf-tools/scripts/run-external-game-benchmark.sh \
    --game-dir /home/ab/GitHub/games/hyfire2-sdk-compat \
    --preset hyfire2-bots \
    --client-url http://localhost:4173 \
    --server-cmd "AUTO_START_WITH_BOTS=true hytopia start" \
    --port 8082 \
    --output perf-results/hyfire2-under-test.json

  bash packages/perf-tools/scripts/run-external-game-benchmark.sh \
    --game-dir /home/ab/GitHub/games/hytopia/zoo-game/work1 \
    --preset zoo-game-full \
    --client-url http://localhost:4173 \
    --output perf-results/zoo-pr2.json

  bash packages/perf-tools/scripts/run-external-game-benchmark.sh \
    --game-dir /home/ab/GitHub/games/hytopia/zoo-game/work1 \
    --preset zoo-game-observe \
    --client-url http://localhost:4173 \
    --cpu-throttle 4 \
    --verbose

For a long manual HyFire2 observation run instead of a measured benchmark:
  cd /home/ab/GitHub/games/hyfire2-sdk-compat
  PORT=8082 AUTO_START_WITH_BOTS=true hytopia start
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --game-dir)
      GAME_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --preset)
      PRESET="$2"
      shift 2
      ;;
    --client-url)
      CLIENT_URL="$2"
      shift 2
      ;;
    --server-cmd)
      SERVER_CMD="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --cpu-throttle)
      CPU_THROTTLE="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$GAME_DIR" || -z "$PRESET" || -z "$CLIENT_URL" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$GAME_DIR/package.json" ]]; then
  echo "Error: no package.json found in $GAME_DIR" >&2
  exit 1
fi

SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM "-$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "==> Linking current SDK checkout into external game"
bash "$SCRIPT_DIR/link-sdk.sh"
bash "$SCRIPT_DIR/setup-game.sh" "$GAME_DIR"

echo ""
echo "==> Starting external game server"
echo "Game dir: $GAME_DIR"
echo "Server cmd: $SERVER_CMD"
echo "Port: $PORT"

(
  cd "$GAME_DIR"
  exec setsid bash -lc "PORT=$PORT HYTOPIA_PERF_TOOLS=1 $SERVER_CMD"
) &
SERVER_PID=$!

echo ""
echo "==> Waiting for https://localhost:$PORT to become healthy"
READY="false"
for _ in $(seq 1 180); do
  if curl -skf "https://localhost:$PORT/" >/dev/null 2>&1; then
    READY="true"
    break
  fi

  sleep 1
done

if [[ "$READY" != "true" ]]; then
  echo "Error: external game server did not become healthy on port $PORT" >&2
  exit 1
fi

echo ""
echo "==> Running preset $PRESET against https://localhost:$PORT"
cd "$REPO_ROOT/packages/perf-tools"

BENCH_CMD=(
  npx tsx src/cli.ts run
  --preset "$PRESET"
  --external-server "https://localhost:$PORT"
  --with-client
  --client-dev-url "$CLIENT_URL"
)

if [[ -n "$CPU_THROTTLE" ]]; then
  BENCH_CMD+=(--cpu-throttle "$CPU_THROTTLE")
fi

if [[ -n "$OUTPUT" ]]; then
  BENCH_CMD+=(--output "$OUTPUT")
fi

if [[ "$VERBOSE" == "true" ]]; then
  BENCH_CMD+=(--verbose)
fi

"${BENCH_CMD[@]}"
