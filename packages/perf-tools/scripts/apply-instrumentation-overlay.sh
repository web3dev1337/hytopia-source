#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_SOURCE_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SOURCE_ENGINE_REPO="$DEFAULT_SOURCE_REPO"
TARGET_ENGINE_REPO=""

usage() {
  cat <<'EOF'
Usage:
  apply-instrumentation-overlay.sh --target-engine-repo <path> [options]

Options:
  --source-engine-repo <path>  Repo providing the current overlay sources
  --target-engine-repo <path>  Engine repo/worktree to patch temporarily
  -h, --help                   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-engine-repo)
      SOURCE_ENGINE_REPO="$(cd "$2" && pwd)"
      shift 2
      ;;
    --target-engine-repo)
      TARGET_ENGINE_REPO="$(cd "$2" && pwd)"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_ENGINE_REPO" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -d "$SOURCE_ENGINE_REPO" || ! -d "$TARGET_ENGINE_REPO" ]]; then
  echo "Error: source and target engine repos must both exist" >&2
  exit 1
fi

SOURCE_SERVER_PKG="$SOURCE_ENGINE_REPO/server/package.json"
TARGET_SERVER_PKG="$TARGET_ENGINE_REPO/server/package.json"
TARGET_GAME_TS="$TARGET_ENGINE_REPO/client/src/Game.ts"
TARGET_WEB_SERVER_TS="$TARGET_ENGINE_REPO/server/src/networking/WebServer.ts"
TARGET_PERF_BRIDGE_TS="$TARGET_ENGINE_REPO/client/src/core/PerfBridge.ts"
TARGET_PERF_HARNESS_ENTRY_TS="$TARGET_ENGINE_REPO/server/src/perf/perf-harness.ts"
TARGET_PERF_HARNESS_TS="$TARGET_ENGINE_REPO/server/src/perf/PerfHarness.ts"
MANIFEST_PATH="$TARGET_ENGINE_REPO/.perf-tools-overlay.json"

TARGET_ENGINE_REPO="$TARGET_ENGINE_REPO" \
SOURCE_ENGINE_REPO="$SOURCE_ENGINE_REPO" \
SOURCE_SERVER_PKG="$SOURCE_SERVER_PKG" \
TARGET_SERVER_PKG="$TARGET_SERVER_PKG" \
TARGET_GAME_TS="$TARGET_GAME_TS" \
TARGET_WEB_SERVER_TS="$TARGET_WEB_SERVER_TS" \
TARGET_PERF_BRIDGE_TS="$TARGET_PERF_BRIDGE_TS" \
TARGET_PERF_HARNESS_ENTRY_TS="$TARGET_PERF_HARNESS_ENTRY_TS" \
TARGET_PERF_HARNESS_TS="$TARGET_PERF_HARNESS_TS" \
MANIFEST_PATH="$MANIFEST_PATH" \
node <<'NODE'
const fs = require('fs');
const path = require('path');

const sourceRepo = process.env.SOURCE_ENGINE_REPO;
const targetRepo = process.env.TARGET_ENGINE_REPO;
const sourceServerPkgPath = process.env.SOURCE_SERVER_PKG;
const targetServerPkgPath = process.env.TARGET_SERVER_PKG;
const targetGamePath = process.env.TARGET_GAME_TS;
const targetWebServerPath = process.env.TARGET_WEB_SERVER_TS;
const targetPerfBridgePath = process.env.TARGET_PERF_BRIDGE_TS;
const targetPerfHarnessEntryPath = process.env.TARGET_PERF_HARNESS_ENTRY_TS;
const targetPerfHarnessPath = process.env.TARGET_PERF_HARNESS_TS;
const manifestPath = process.env.MANIFEST_PATH;

const sourcePerfBridgePath = path.join(sourceRepo, 'client/src/core/PerfBridge.ts');
const sourcePerfHarnessEntryPath = path.join(sourceRepo, 'server/src/perf/perf-harness.ts');
const legacyPerfHarnessPath = path.join(sourceRepo, 'packages/perf-tools/overlays/legacy-server/PerfHarness.ts');

const manifest = {
  sourceEngineRepo: sourceRepo,
  targetEngineRepo: targetRepo,
  applied: false,
  client: {
    perfBridge: 'none',
    gamePatched: false,
  },
  server: {
    perfHarness: 'none',
    perfHarnessEntry: 'none',
    webServerPatched: false,
    buildScriptPatched: false,
    snapshotApi: false,
    actionApi: false,
  },
};

function exists(filePath) {
  return filePath && fs.existsSync(filePath);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyIfMissing(sourcePath, targetPath) {
  if (exists(targetPath)) {
    return false;
  }

  write(targetPath, read(sourcePath));
  return true;
}

function patchGame() {
  if (!exists(targetGamePath)) {
    return false;
  }

  let text = read(targetGamePath);
  let changed = false;

  if (!text.includes("import PerfBridge from './core/PerfBridge';")) {
    const anchor = "import PerformanceMetricsManager from './core/PerformanceMetricsManager';";
    if (text.includes(anchor)) {
      text = text.replace(anchor, `${anchor}\nimport PerfBridge from './core/PerfBridge';`);
      changed = true;
    }
  }

  if (!text.includes('readonly inPerfMode')) {
    const anchor = "readonly inDebugMode = new URLSearchParams(window.location.search).has(DEBUG_QUERY_STRINGS);";
    if (text.includes(anchor)) {
      text = text.replace(anchor, `${anchor}\n  readonly inPerfMode = new URLSearchParams(window.location.search).get('perf') === '1';`);
      changed = true;
    }
  }

  if (!text.includes('new PerfBridge(this);')) {
    const anchor = '    this._chunkWorkerClient = new ChunkWorkerClient();';
    if (text.includes(anchor)) {
      text = text.replace(anchor, `${anchor}\n\n    if (this.inPerfMode) {\n      new PerfBridge(this);\n    }`);
      changed = true;
    }
  }

  if (changed) {
    write(targetGamePath, text);
  }

  return changed;
}

function patchWebServer() {
  if (!exists(targetWebServerPath)) {
    return false;
  }

  let text = read(targetWebServerPath);
  let changed = false;

  if (!text.includes("import PerfHarness from '@/perf/PerfHarness';")) {
    const anchor = "import PlayerManager from '@/players/PlayerManager';";
    if (text.includes(anchor)) {
      text = text.replace(anchor, `${anchor}\nimport PerfHarness from '@/perf/PerfHarness';`);
      changed = true;
    }
  }

  if (!text.includes('PerfHarness.enableIfConfigured();')) {
    const anchor = "    if (this._server) {\n      return ErrorHandler.warning('WebServer.start(): already started');\n    }\n";
    if (text.includes(anchor)) {
      text = text.replace(anchor, `${anchor}\n    PerfHarness.enableIfConfigured();\n`);
      changed = true;
    }
  }

  if (!text.includes('PerfHarness.handleWebRequest(req, res)')) {
    const anchor = '    // Health check';
    if (text.includes(anchor)) {
      text = text.replace(anchor, "    if (PerfHarness.handleWebRequest(req, res)) {\n      return;\n    }\n\n    // Health check");
      changed = true;
    }
  }

  if (changed) {
    write(targetWebServerPath, text);
  }

  return changed;
}

function patchBuildScript() {
  if (!exists(sourceServerPkgPath) || !exists(targetServerPkgPath)) {
    return false;
  }

  const sourcePkg = JSON.parse(read(sourceServerPkgPath));
  const targetPkg = JSON.parse(read(targetServerPkgPath));
  const buildScript = sourcePkg.scripts?.['build:perf-harness'];

  if (!buildScript || targetPkg.scripts?.['build:perf-harness']) {
    return false;
  }

  targetPkg.scripts = targetPkg.scripts || {};
  targetPkg.scripts['build:perf-harness'] = buildScript;
  write(targetServerPkgPath, `${JSON.stringify(targetPkg, null, 2)}\n`);
  return true;
}

function hasModernServerPerfHarness() {
  if (!exists(targetPerfHarnessPath)) {
    return false;
  }

  const text = read(targetPerfHarnessPath);
  return text.includes('/__perf/action') && text.includes('/__perf/snapshot');
}

if (path.resolve(sourceRepo) === path.resolve(targetRepo)) {
  console.log('Instrumentation overlay manifest: none (source and target are the same checkout)');
  process.exit(0);
}

if (hasModernServerPerfHarness()) {
  manifest.server.perfHarness = 'existing';
  manifest.server.snapshotApi = true;
  manifest.server.actionApi = true;
} else {
  write(targetPerfHarnessPath, read(legacyPerfHarnessPath));
  manifest.applied = true;
  manifest.server.perfHarness = 'overlay';

  if (patchWebServer()) {
    manifest.applied = true;
    manifest.server.webServerPatched = true;
  }

  manifest.server.snapshotApi = true;
  manifest.server.actionApi = false;
}

if (exists(sourcePerfHarnessEntryPath)) {
  if (copyIfMissing(sourcePerfHarnessEntryPath, targetPerfHarnessEntryPath)) {
    manifest.applied = true;
    manifest.server.perfHarnessEntry = 'overlay';
  } else if (exists(targetPerfHarnessEntryPath)) {
    manifest.server.perfHarnessEntry = 'existing';
  }
}

if (patchBuildScript()) {
  manifest.applied = true;
  manifest.server.buildScriptPatched = true;
}

if (exists(targetPerfBridgePath)) {
  manifest.client.perfBridge = 'existing';
} else if (exists(sourcePerfBridgePath)) {
  write(targetPerfBridgePath, read(sourcePerfBridgePath));
  manifest.applied = true;
  manifest.client.perfBridge = 'overlay';
}

if (patchGame()) {
  manifest.applied = true;
  manifest.client.gamePatched = true;
}

write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Instrumentation overlay manifest: ${manifestPath}`);
NODE
