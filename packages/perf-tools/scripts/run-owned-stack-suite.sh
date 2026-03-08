#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TOOLS_REPO="$REPO_ROOT"
INVOCATION_CWD="$(pwd)"

ENGINE_REPO="$REPO_ROOT"
ENGINE_REF=""
CLIENT_URL=""
CLIENT_PORT="4173"
CPU_THROTTLE=""
OUTPUT_ROOT="$REPO_ROOT/packages/perf-tools/perf-results/owned-stack"
INTERNAL_PRESETS="idle,stress,stress-walkthrough"
EXTERNAL_GAMES="zoo,hyfire2"
ZOO_DIR="/home/ab/GitHub/games/hytopia/zoo-game/work1"
ZOO_PRESET="zoo-game-full"
ZOO_PORT="9091"
HYFIRE2_DIR="/home/ab/GitHub/games/hyfire2-sdk-compat"
HYFIRE2_PRESET="hyfire2-bots"
HYFIRE2_PORT="8082"
HYFIRE2_SERVER_CMD="AUTO_START_WITH_BOTS=true hytopia start"
KEEP_WORKTREE="false"
INSTRUMENTATION_OVERLAY="true"

WORKTREE_DIR=""
ACTIVE_ENGINE_REPO="$ENGINE_REPO"
RESOLVED_COMMIT=""
RESOLVED_LABEL=""
SUMMARY_PATH=""
CLIENT_SERVER_PID=""
CLIENT_SERVER_LOG=""
OVERLAY_MANIFEST=""

declare -a SUMMARY_ROWS=()

usage() {
  cat <<'EOF'
Usage:
  run-owned-stack-suite.sh [options]

Runs the HYTOPIA perf stack against the owned games and core synthetic presets
using either the current checkout or a specific engine ref / PR.

Options:
  --engine-ref <ref>         Git ref, commit, branch, or PR number / pr:<n>
  --engine-repo <path>       Engine repo to test (default: current repo)
  --client-url <url>         Browser client URL for all client-side runs
  --client-port <port>       Port to use when auto-launching client dev server
  --cpu-throttle <rate>      Browser CPU throttle rate for client runs
  --output-root <path>       Root directory for suite outputs
  --internal-presets <list>  Comma-separated built-in presets, or none
  --external-games <list>    Comma-separated games: zoo,hyfire2, or none
  --zoo-dir <path>           Zoo Game repo/worktree
  --zoo-preset <name>        Zoo preset to run
  --zoo-port <port>          Zoo external server port
  --hyfire2-dir <path>       HyFire2 repo/worktree
  --hyfire2-preset <name>    HyFire2 preset to run
  --hyfire2-port <port>      HyFire2 external server port
  --no-instrumentation-overlay
                             Do not patch older target refs with temporary perf hooks
  --keep-worktree            Leave the temporary engine worktree on disk
  -h, --help                 Show this help

Examples:
  bash packages/perf-tools/scripts/run-owned-stack-suite.sh \
    --engine-ref pr:2 \
    --client-port 4173

  bash packages/perf-tools/scripts/run-owned-stack-suite.sh \
    --engine-ref feature/blob-shadows \
    --cpu-throttle 4 \
    --output-root /tmp/hytopia-bench

  bash packages/perf-tools/scripts/run-owned-stack-suite.sh \
    --internal-presets idle,stress,stress-walkthrough,join-storm \
    --external-games zoo,hyfire2
EOF
}

sanitize_slug() {
  echo "$1" | tr '/: ' '---' | tr -cd '[:alnum:]._-' | cut -c1-80
}

join_by() {
  local sep="$1"
  shift
  local first="true"

  for item in "$@"; do
    if [[ "$first" == "true" ]]; then
      printf '%s' "$item"
      first="false"
    else
      printf '%s%s' "$sep" "$item"
    fi
  done
}

cleanup() {
  if [[ -n "$CLIENT_SERVER_PID" ]]; then
    kill -TERM "-$CLIENT_SERVER_PID" >/dev/null 2>&1 || true
    wait "$CLIENT_SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$WORKTREE_DIR" && -d "$WORKTREE_DIR" && "$KEEP_WORKTREE" != "true" ]]; then
    git -C "$ENGINE_REPO" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-ref)
      ENGINE_REF="$2"
      shift 2
      ;;
    --engine-repo)
      ENGINE_REPO="$(cd "$2" && pwd)"
      ACTIVE_ENGINE_REPO="$ENGINE_REPO"
      shift 2
      ;;
    --client-url)
      CLIENT_URL="$2"
      shift 2
      ;;
    --client-port)
      CLIENT_PORT="$2"
      shift 2
      ;;
    --cpu-throttle)
      CPU_THROTTLE="$2"
      shift 2
      ;;
    --output-root)
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --internal-presets)
      INTERNAL_PRESETS="$2"
      shift 2
      ;;
    --external-games)
      EXTERNAL_GAMES="$2"
      shift 2
      ;;
    --zoo-dir)
      ZOO_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --zoo-preset)
      ZOO_PRESET="$2"
      shift 2
      ;;
    --zoo-port)
      ZOO_PORT="$2"
      shift 2
      ;;
    --hyfire2-dir)
      HYFIRE2_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --hyfire2-preset)
      HYFIRE2_PRESET="$2"
      shift 2
      ;;
    --hyfire2-port)
      HYFIRE2_PORT="$2"
      shift 2
      ;;
    --keep-worktree)
      KEEP_WORKTREE="true"
      shift
      ;;
    --no-instrumentation-overlay)
      INSTRUMENTATION_OVERLAY="false"
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

if [[ ! -d "$ENGINE_REPO/.git" && ! -f "$ENGINE_REPO/.git" ]]; then
  echo "Error: $ENGINE_REPO is not a git repo" >&2
  exit 1
fi

if [[ "$OUTPUT_ROOT" != /* ]]; then
  OUTPUT_ROOT="$INVOCATION_CWD/$OUTPUT_ROOT"
fi

prepare_engine_checkout() {
  bash "$TOOLS_REPO/packages/perf-tools/scripts/ensure-node-modules.sh" \
    --source-repo "$ENGINE_REPO" \
    --target-repo "$ACTIVE_ENGINE_REPO" \
    --packages "server,client,protocol"
}

apply_instrumentation_overlay() {
  if [[ "$INSTRUMENTATION_OVERLAY" != "true" ]]; then
    return
  fi

  bash "$TOOLS_REPO/packages/perf-tools/scripts/apply-instrumentation-overlay.sh" \
    --source-engine-repo "$TOOLS_REPO" \
    --target-engine-repo "$ACTIVE_ENGINE_REPO"

  if [[ -f "$ACTIVE_ENGINE_REPO/.perf-tools-overlay.json" ]]; then
    OVERLAY_MANIFEST="$ACTIVE_ENGINE_REPO/.perf-tools-overlay.json"
  else
    OVERLAY_MANIFEST=""
  fi
}

start_client_server() {
  if [[ -n "$CLIENT_URL" ]]; then
    return
  fi

  while lsof -iTCP:"$CLIENT_PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; do
    CLIENT_PORT="$((CLIENT_PORT + 1))"
  done

  CLIENT_URL="http://localhost:$CLIENT_PORT"
  CLIENT_SERVER_LOG="$OUTPUT_DIR/client-dev.log"

  (
    cd "$ACTIVE_ENGINE_REPO/client"
    exec setsid npm run dev -- --host 0.0.0.0 --port "$CLIENT_PORT" --strictPort
  ) >"$CLIENT_SERVER_LOG" 2>&1 &
  CLIENT_SERVER_PID=$!

  for _ in $(seq 1 180); do
    if curl -sf "$CLIENT_URL" >/dev/null 2>&1; then
      return
    fi

    sleep 1
  done

  echo "Error: client dev server did not become healthy at $CLIENT_URL" >&2
  exit 1
}

can_run_internal_presets() {
  [[ -f "$ACTIVE_ENGINE_REPO/server/src/perf/perf-harness.ts" ]] || return 1

  node -e "const pkg=require(process.argv[1]); process.exit(pkg.scripts && pkg.scripts['build:perf-harness'] ? 0 : 1)" \
    "$ACTIVE_ENGINE_REPO/server/package.json" >/dev/null 2>&1
}

server_supports_action_api() {
  if [[ -n "$OVERLAY_MANIFEST" && -f "$OVERLAY_MANIFEST" ]]; then
    node -e "const data=require(process.argv[1]); process.exit(data.server?.actionApi ? 0 : 1)" \
      "$OVERLAY_MANIFEST" >/dev/null 2>&1
    return
  fi

  [[ -f "$ACTIVE_ENGINE_REPO/server/src/perf/PerfHarness.ts" ]] || return 1
  rg -q '/__perf/action' "$ACTIVE_ENGINE_REPO/server/src/perf/PerfHarness.ts"
}

preset_requires_server_actions() {
  local preset="$1"
  local preset_path="$TOOLS_REPO/packages/perf-tools/src/presets/${preset}.yaml"

  [[ -f "$preset_path" ]] || return 1

  rg -q 'type: (spawn_bots|despawn_bots|load_map|generate_blocks|spawn_entities|despawn_entities|start_block_churn|stop_block_churn|create_worlds|set_default_world|clear_world)' "$preset_path"
}

resolve_engine_checkout() {
  if [[ -z "$ENGINE_REF" ]]; then
    ACTIVE_ENGINE_REPO="$ENGINE_REPO"
    RESOLVED_COMMIT="$(git -C "$ENGINE_REPO" rev-parse HEAD)"
    local branch_name
    branch_name="$(git -C "$ENGINE_REPO" rev-parse --abbrev-ref HEAD)"
    RESOLVED_LABEL="$(sanitize_slug "${branch_name}-$(git -C "$ENGINE_REPO" rev-parse --short HEAD)")"
    return
  fi

  local fetch_target=""

  if [[ "$ENGINE_REF" =~ ^pr:[0-9]+$ ]]; then
    fetch_target="pull/${ENGINE_REF#pr:}/head"
  elif [[ "$ENGINE_REF" =~ ^[0-9]+$ ]]; then
    fetch_target="pull/${ENGINE_REF}/head"
  fi

  if [[ -n "$fetch_target" ]]; then
    git -C "$ENGINE_REPO" fetch origin "$fetch_target"
    RESOLVED_COMMIT="$(git -C "$ENGINE_REPO" rev-parse FETCH_HEAD)"
    RESOLVED_LABEL="$(sanitize_slug "pr-${fetch_target#pull/}")"
    RESOLVED_LABEL="${RESOLVED_LABEL%-head}"
  elif git -C "$ENGINE_REPO" rev-parse --verify "${ENGINE_REF}^{commit}" >/dev/null 2>&1; then
    RESOLVED_COMMIT="$(git -C "$ENGINE_REPO" rev-parse "${ENGINE_REF}^{commit}")"
    RESOLVED_LABEL="$(sanitize_slug "${ENGINE_REF}-$(git -C "$ENGINE_REPO" rev-parse --short "$RESOLVED_COMMIT")")"
  else
    git -C "$ENGINE_REPO" fetch origin "$ENGINE_REF"
    RESOLVED_COMMIT="$(git -C "$ENGINE_REPO" rev-parse FETCH_HEAD)"
    RESOLVED_LABEL="$(sanitize_slug "${ENGINE_REF}-$(git -C "$ENGINE_REPO" rev-parse --short "$RESOLVED_COMMIT")")"
  fi

  WORKTREE_DIR="$(mktemp -d "/tmp/hytopia-owned-stack-${RESOLVED_LABEL}-XXXXXX")"
  git -C "$ENGINE_REPO" worktree add --detach "$WORKTREE_DIR" "$RESOLVED_COMMIT" >/dev/null
  ACTIVE_ENGINE_REPO="$WORKTREE_DIR"
}

run_and_capture() {
  local label="$1"
  local category="$2"
  local output_path="$3"
  shift 3

  echo ""
  echo "==> Running $label"
  echo "Output: $output_path"

  set +e
  "$@"
  local status=$?
  set -e

  SUMMARY_ROWS+=("| $label | $category | $status | $output_path |")

  if [[ $status -ne 0 ]]; then
    echo "WARNING: $label failed with exit code $status" >&2
  fi

  return $status
}

write_summary() {
  local output_dir="$1"
  local internal_display="$2"
  local external_display="$3"
  local resolved_ref="${ENGINE_REF:-current-checkout}"

  cat > "$SUMMARY_PATH" <<EOF
# Owned Stack Perf Suite

- Engine repo: \`$ENGINE_REPO\`
- Engine ref requested: \`$resolved_ref\`
- Engine checkout used: \`$ACTIVE_ENGINE_REPO\`
- Resolved commit: \`$RESOLVED_COMMIT\`
- Client URL: \`$CLIENT_URL\`
- CPU throttle: \`${CPU_THROTTLE:-none}\`
- Instrumentation overlay: \`${INSTRUMENTATION_OVERLAY}\`
- Overlay manifest: \`${OVERLAY_MANIFEST:-none}\`
- Internal presets: \`$internal_display\`
- External games: \`$external_display\`
- Output dir: \`$output_dir\`

## Results

| Target | Type | Exit Code | Output |
| --- | --- | --- | --- |
EOF

  for row in "${SUMMARY_ROWS[@]}"; do
    echo "$row" >> "$SUMMARY_PATH"
  done

  cat >> "$SUMMARY_PATH" <<EOF

## Re-run

\`\`\`bash
bash packages/perf-tools/scripts/run-owned-stack-suite.sh \\
  --engine-ref "$resolved_ref" \\
  --client-url "$CLIENT_URL"$(if [[ -n "$CPU_THROTTLE" ]]; then printf ' \\\n  --cpu-throttle "%s"' "$CPU_THROTTLE"; fi)$(if [[ "$internal_display" != "none" ]]; then printf ' \\\n  --internal-presets "%s"' "$internal_display"; fi)$(if [[ "$external_display" != "none" ]]; then printf ' \\\n  --external-games "%s"' "$external_display"; fi)
\`\`\`
EOF
}

resolve_engine_checkout
apply_instrumentation_overlay
prepare_engine_checkout

OUTPUT_DIR="$OUTPUT_ROOT/$RESOLVED_LABEL-$(date +%Y%m%d-%H%M%S)"
SUMMARY_PATH="$OUTPUT_DIR/README.md"
mkdir -p "$OUTPUT_DIR"

start_client_server

IFS=',' read -r -a INTERNAL_PRESET_ARRAY <<< "$INTERNAL_PRESETS"
IFS=',' read -r -a EXTERNAL_GAME_ARRAY <<< "$EXTERNAL_GAMES"

internal_display="none"
external_display="none"

if [[ "$INTERNAL_PRESETS" != "none" ]]; then
  internal_display="$(join_by ',' "${INTERNAL_PRESET_ARRAY[@]}")"
fi

if [[ "$EXTERNAL_GAMES" != "none" ]]; then
  external_display="$(join_by ',' "${EXTERNAL_GAME_ARRAY[@]}")"
fi

echo "Engine checkout: $ACTIVE_ENGINE_REPO"
echo "Resolved commit: $RESOLVED_COMMIT"
echo "Output dir: $OUTPUT_DIR"
echo "Client URL: $CLIENT_URL"

overall_status=0

if [[ "$INTERNAL_PRESETS" != "none" ]]; then
  if can_run_internal_presets; then
    for preset in "${INTERNAL_PRESET_ARRAY[@]}"; do
      [[ -z "$preset" ]] && continue

      if ! server_supports_action_api && preset_requires_server_actions "$preset"; then
        echo "WARNING: skipping $preset because the target ref only has snapshot/reset perf overlay support" >&2
        SUMMARY_ROWS+=("| $preset | internal | skipped | server action API unavailable |")
        continue
      fi

      cmd=(
        npx tsx src/cli.ts run
        --preset "$preset"
        --server-cwd "$ACTIVE_ENGINE_REPO/server"
        --with-client
        --client-dev-url "$CLIENT_URL"
        --output "$OUTPUT_DIR/${preset}.json"
      )

      if [[ -n "$CPU_THROTTLE" ]]; then
        cmd+=(--cpu-throttle "$CPU_THROTTLE")
      fi

      if ! run_and_capture "$preset" "internal" "$OUTPUT_DIR/${preset}.json" bash -lc "cd '$TOOLS_REPO/packages/perf-tools' && ${cmd[*]@Q}"; then
        overall_status=1
      fi
    done
  else
    echo "WARNING: skipping internal presets because $ACTIVE_ENGINE_REPO does not contain perf-harness support" >&2
    for preset in "${INTERNAL_PRESET_ARRAY[@]}"; do
      [[ -z "$preset" ]] && continue
      SUMMARY_ROWS+=("| $preset | internal | skipped | perf-harness missing |")
    done
  fi
fi

if [[ "$EXTERNAL_GAMES" != "none" ]]; then
  for game in "${EXTERNAL_GAME_ARRAY[@]}"; do
    [[ -z "$game" ]] && continue

    case "$game" in
      zoo)
        game_cmd=(
          bash "$TOOLS_REPO/packages/perf-tools/scripts/run-external-game-benchmark.sh"
          --engine-repo "$ACTIVE_ENGINE_REPO"
          --game-dir "$ZOO_DIR"
          --preset "$ZOO_PRESET"
          --client-url "$CLIENT_URL"
          --port "$ZOO_PORT"
          --output "$OUTPUT_DIR/${ZOO_PRESET}.json"
        )

        if [[ -n "$CPU_THROTTLE" ]]; then
          game_cmd+=(--cpu-throttle "$CPU_THROTTLE")
        fi

        if ! run_and_capture "zoo:$ZOO_PRESET" "external" "$OUTPUT_DIR/${ZOO_PRESET}.json" "${game_cmd[@]}"; then
          overall_status=1
        fi
        ;;
      hyfire2)
        game_cmd=(
          bash "$TOOLS_REPO/packages/perf-tools/scripts/run-external-game-benchmark.sh"
          --engine-repo "$ACTIVE_ENGINE_REPO"
          --game-dir "$HYFIRE2_DIR"
          --preset "$HYFIRE2_PRESET"
          --client-url "$CLIENT_URL"
          --server-cmd "$HYFIRE2_SERVER_CMD"
          --port "$HYFIRE2_PORT"
          --output "$OUTPUT_DIR/${HYFIRE2_PRESET}.json"
        )

        if [[ -n "$CPU_THROTTLE" ]]; then
          game_cmd+=(--cpu-throttle "$CPU_THROTTLE")
        fi

        if ! run_and_capture "hyfire2:$HYFIRE2_PRESET" "external" "$OUTPUT_DIR/${HYFIRE2_PRESET}.json" "${game_cmd[@]}"; then
          overall_status=1
        fi
        ;;
      *)
        echo "Unknown external game: $game" >&2
        exit 1
        ;;
    esac
  done
fi

write_summary "$OUTPUT_DIR" "$internal_display" "$external_display"

echo ""
echo "Suite summary: $SUMMARY_PATH"

exit "$overall_status"
