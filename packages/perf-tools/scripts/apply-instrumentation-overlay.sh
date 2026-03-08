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
TARGET_WORLD_LOOP_TS="$TARGET_ENGINE_REPO/server/src/worlds/WorldLoop.ts"
TARGET_CONNECTION_TS="$TARGET_ENGINE_REPO/server/src/networking/Connection.ts"
TARGET_PLAYER_MANAGER_TS="$TARGET_ENGINE_REPO/server/src/players/PlayerManager.ts"
TARGET_PERF_BRIDGE_TS="$TARGET_ENGINE_REPO/client/src/core/PerfBridge.ts"
TARGET_PERF_HARNESS_ENTRY_TS="$TARGET_ENGINE_REPO/server/src/perf/perf-harness.ts"
TARGET_PERF_HARNESS_TS="$TARGET_ENGINE_REPO/server/src/perf/PerfHarness.ts"
TARGET_PERF_MONITOR_TS="$TARGET_ENGINE_REPO/server/src/metrics/PerformanceMonitor.ts"
TARGET_NETWORK_METRICS_TS="$TARGET_ENGINE_REPO/server/src/metrics/NetworkMetrics.ts"
MANIFEST_PATH="$TARGET_ENGINE_REPO/.perf-tools-overlay.json"

TARGET_ENGINE_REPO="$TARGET_ENGINE_REPO" \
SOURCE_ENGINE_REPO="$SOURCE_ENGINE_REPO" \
SOURCE_SERVER_PKG="$SOURCE_SERVER_PKG" \
TARGET_SERVER_PKG="$TARGET_SERVER_PKG" \
TARGET_GAME_TS="$TARGET_GAME_TS" \
TARGET_WEB_SERVER_TS="$TARGET_WEB_SERVER_TS" \
TARGET_WORLD_LOOP_TS="$TARGET_WORLD_LOOP_TS" \
TARGET_CONNECTION_TS="$TARGET_CONNECTION_TS" \
TARGET_PLAYER_MANAGER_TS="$TARGET_PLAYER_MANAGER_TS" \
TARGET_PERF_BRIDGE_TS="$TARGET_PERF_BRIDGE_TS" \
TARGET_PERF_HARNESS_ENTRY_TS="$TARGET_PERF_HARNESS_ENTRY_TS" \
TARGET_PERF_HARNESS_TS="$TARGET_PERF_HARNESS_TS" \
TARGET_PERF_MONITOR_TS="$TARGET_PERF_MONITOR_TS" \
TARGET_NETWORK_METRICS_TS="$TARGET_NETWORK_METRICS_TS" \
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
const targetWorldLoopPath = process.env.TARGET_WORLD_LOOP_TS;
const targetConnectionPath = process.env.TARGET_CONNECTION_TS;
const targetPlayerManagerPath = process.env.TARGET_PLAYER_MANAGER_TS;
const targetPerfBridgePath = process.env.TARGET_PERF_BRIDGE_TS;
const targetPerfHarnessEntryPath = process.env.TARGET_PERF_HARNESS_ENTRY_TS;
const targetPerfHarnessPath = process.env.TARGET_PERF_HARNESS_TS;
const targetPerfMonitorPath = process.env.TARGET_PERF_MONITOR_TS;
const targetNetworkMetricsPath = process.env.TARGET_NETWORK_METRICS_TS;
const manifestPath = process.env.MANIFEST_PATH;

const sourcePerfBridgePath = path.join(sourceRepo, 'client/src/core/PerfBridge.ts');
const sourcePerfHarnessEntryPath = path.join(sourceRepo, 'server/src/perf/perf-harness.ts');
const legacyPerfHarnessPath = path.join(sourceRepo, 'packages/perf-tools/overlays/legacy-server/PerfHarness.ts');
const minimalPerfHarnessPath = path.join(sourceRepo, 'packages/perf-tools/overlays/minimal-server/PerfHarness.ts');
const sourcePerfMonitorPath = path.join(sourceRepo, 'server/src/metrics/PerformanceMonitor.ts');
const sourceNetworkMetricsPath = path.join(sourceRepo, 'server/src/metrics/NetworkMetrics.ts');

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
    mode: 'none',
    webServerPatched: false,
    worldLoopPatched: false,
    connectionPatched: false,
    playerManagerPatched: false,
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

function replaceOnce(text, searchValue, replaceValue) {
  if (!text.includes(searchValue)) {
    return { text, changed: false };
  }

  return {
    text: text.replace(searchValue, replaceValue),
    changed: true,
  };
}

function replaceRegexOnce(text, pattern, replaceValue) {
  const nextText = text.replace(pattern, replaceValue);

  return {
    text: nextText,
    changed: nextText !== text,
  };
}

function patchGame() {
  if (!exists(targetGamePath)) {
    return false;
  }

  let text = read(targetGamePath);
  let changed = false;

  if (!text.includes("import PerfBridge from './core/PerfBridge';")) {
    const replaced = replaceRegexOnce(
      text,
      /(import PerformanceMetricsManager from '\.\/core\/PerformanceMetricsManager';\n)/,
      `$1import PerfBridge from './core/PerfBridge';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('readonly inPerfMode')) {
    const replaced = replaceRegexOnce(
      text,
      /(  readonly inDebugMode = [^\n]+;\n)/,
      `$1  readonly inPerfMode = new URLSearchParams(window.location.search).get('perf') === '1';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('new PerfBridge(this);')) {
    const replaced = replaceRegexOnce(
      text,
      /(    this\._chunkWorkerClient = new ChunkWorkerClient\(\);\n)/,
      `$1\n    if (this.inPerfMode) {\n      new PerfBridge(this);\n    }\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
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
    const replaced = replaceRegexOnce(
      text,
      /(import PlayerManager from '@\/players\/PlayerManager';\n)/,
      `$1import PerfHarness from '@/perf/PerfHarness';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('PerfHarness.enableIfConfigured();')) {
    const replaced = replaceRegexOnce(
      text,
      /(    this\._server = http2\.createSecureServer\(\{ key: SSL_KEY, cert: SSL_CERT, allowHTTP1: true \}\);\n)/,
      `    PerfHarness.enableIfConfigured();\n\n$1`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('PerfHarness.handleWebRequest(req, res)')) {
    const replaced = replaceRegexOnce(
      text,
      /(    \/\/ Health check\n)/,
      `    if (PerfHarness.handleWebRequest(req, res)) {\n      return;\n    }\n\n$1`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
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

function hasLegacyPerformanceBaseline() {
  return exists(path.join(targetRepo, 'server/src/metrics/PerformanceBaseline.ts'));
}

function patchWorldLoop() {
  if (!exists(targetWorldLoopPath)) {
    return false;
  }

  let text = read(targetWorldLoopPath);
  let changed = false;

  if (!text.includes("import PerformanceMonitor from '@/metrics/PerformanceMonitor';")) {
    const replaced = replaceRegexOnce(
      text,
      /(import PlayerManager from '@\/players\/PlayerManager';\n)/,
      `$1import PerformanceMonitor from '@/metrics/PerformanceMonitor';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('const perfMon = PerformanceMonitor.instance;')) {
    const replaced = replaceRegexOnce(
      text,
      /(    const tickStart = performance\.now\(\);\n)/,
      `${[
        '$1',
        '    const perfMon = PerformanceMonitor.instance;',
        '    const profiling = perfMon.isEnabled;',
        '',
        '    if (profiling) {',
        '      perfMon.beginTick(',
        '        this._currentTick,',
        '        this._world.entityManager.entityCount,',
        '        PlayerManager.instance.playerCount,',
        '        this._world.id,',
        '      );',
        '    }',
        '',
      ].join('\n')}`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes("perfMon.recordPhase('entities_tick'")) {
    const replaced = replaceOnce(
      text,
      "      }, () => this._world.entityManager.tickEntities(tickDeltaMs));",
      [
        "      }, () => {",
        '        const phaseStart = profiling ? performance.now() : 0;',
        '        this._world.entityManager.tickEntities(tickDeltaMs);',
        "        if (profiling) perfMon.recordPhase('entities_tick', performance.now() - phaseStart, this._world.id);",
        '      });',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes("perfMon.recordPhase('simulation_step'")) {
    const replaced = replaceOnce(
      text,
      "      }, () => this._world.simulation.step(tickDeltaMs));",
      [
        "      }, () => {",
        '        const phaseStart = profiling ? performance.now() : 0;',
        '        this._world.simulation.step(tickDeltaMs);',
        "        if (profiling) perfMon.recordPhase('simulation_step', performance.now() - phaseStart, this._world.id);",
        '      });',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes("perfMon.recordPhase('entities_emit_updates'")) {
    const replaced = replaceOnce(
      text,
      "      }, () => this._world.entityManager.checkAndEmitUpdates());",
      [
        "      }, () => {",
        '        const phaseStart = profiling ? performance.now() : 0;',
        '        this._world.entityManager.checkAndEmitUpdates();',
        "        if (profiling) perfMon.recordPhase('entities_emit_updates', performance.now() - phaseStart, this._world.id);",
        '      });',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes("perfMon.recordPhase('network_synchronize'")) {
    const replaced = replaceOnce(
      text,
      "        }, () => this._world.networkSynchronizer.synchronize());",
      [
        '        }, () => {',
        '          const phaseStart = profiling ? performance.now() : 0;',
        '          this._world.networkSynchronizer.synchronize();',
        "          if (profiling) perfMon.recordPhase('network_synchronize', performance.now() - phaseStart, this._world.id);",
        '        });',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('perfMon.endTick(this._world.id);')) {
    const replaced = replaceRegexOnce(
      text,
      /(\n    this\._currentTick\+\+;\n)/,
      `\n    if (profiling) {\n      perfMon.endTick(this._world.id);\n    }$1`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (changed) {
    write(targetWorldLoopPath, text);
  }

  return changed;
}

function patchConnection() {
  if (!exists(targetConnectionPath)) {
    return false;
  }

  let text = read(targetConnectionPath);
  let changed = false;

  if (!text.includes("import NetworkMetrics from '@/metrics/NetworkMetrics';")) {
    const replaced = replaceRegexOnce(
      text,
      /(import EventRouter from '@\/events\/EventRouter';\n)/,
      `$1import NetworkMetrics from '@/metrics/NetworkMetrics';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('netMetrics.recordSerialization(')) {
    let replaced = replaceOnce(
      text,
      "    }, span => {\n      let outputBuffer = msgpackr.pack(packets);",
      [
        '    }, span => {',
        '      const netMetrics = NetworkMetrics.instance;',
        '      const recordNetwork = netMetrics.isEnabled;',
        '      const start = recordNetwork ? performance.now() : 0;',
        '',
        '      let outputBuffer = msgpackr.pack(packets);',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;

    replaced = replaceOnce(
      text,
      '      if (outputBuffer.byteLength > 64 * 1024) { // Compress packets larger than 64kb, mainly chunks.',
      [
        '      const shouldCompress = outputBuffer.byteLength > 64 * 1024;',
        '',
        '      if (shouldCompress) { // Compress packets larger than 64kb, mainly chunks.',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;

    replaced = replaceOnce(
      text,
      '\n      return outputBuffer;\n    });',
      [
        '',
        '      if (recordNetwork) {',
        '        netMetrics.recordSerialization(performance.now() - start);',
        '        if (shouldCompress) {',
        '          netMetrics.recordCompression();',
        '        }',
        '      }',
        '',
        '      return outputBuffer;',
        '    });',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('netMetrics.recordBytesSent(bytesSent);')) {
    let replaced = replaceOnce(
      text,
      '        if (wtConnected) {',
      [
        '        const netMetrics = NetworkMetrics.instance;',
        '        const recordNetwork = netMetrics.isEnabled;',
        '',
        '        let bytesSent = serializedBuffer.byteLength;',
        '',
        '        if (wtConnected) {',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;

    replaced = replaceOnce(
      text,
      '            this._wtReliableWriter?.write(protocol.framePacketBuffer(serializedBuffer)).catch(() => {',
      [
        '            const framed = protocol.framePacketBuffer(serializedBuffer);',
        '            bytesSent = framed.byteLength;',
        '',
        '            this._wtReliableWriter?.write(framed).catch(() => {',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;

    replaced = replaceOnce(
      text,
      '\n        this.emitWithGlobal(ConnectionEvent.PACKETS_SENT, {',
      [
        '',
        '        if (recordNetwork) {',
        '          netMetrics.recordBytesSent(bytesSent);',
        '          for (let i = 0; i < packets.length; i++) {',
        '            netMetrics.recordPacketSent();',
        '          }',
        '        }',
        '',
        '        this.emitWithGlobal(ConnectionEvent.PACKETS_SENT, {',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('netMetrics.recordBytesReceived(data.byteLength);')) {
    const replaced = replaceOnce(
      text,
      "  private _onMessage = (data: Buffer): void => {\n    try {\n      const packet = this._deserialize(data);",
      [
        '  private _onMessage = (data: Buffer): void => {',
        '    const netMetrics = NetworkMetrics.instance;',
        '    const recordNetwork = netMetrics.isEnabled;',
        '',
        '    if (recordNetwork) {',
        '      netMetrics.recordBytesReceived(data.byteLength);',
        '      netMetrics.recordPacketReceived();',
        '    }',
        '',
        '    try {',
        '      const packet = this._deserialize(data);',
      ].join('\n'),
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (changed) {
    write(targetConnectionPath, text);
  }

  return changed;
}

function patchPlayerManager() {
  if (!exists(targetPlayerManagerPath)) {
    return false;
  }

  let text = read(targetPlayerManagerPath);
  let changed = false;

  if (!text.includes("import NetworkMetrics from '@/metrics/NetworkMetrics';")) {
    const replaced = replaceRegexOnce(
      text,
      /(import ErrorHandler from '@\/errors\/ErrorHandler';\n)/,
      `$1import NetworkMetrics from '@/metrics/NetworkMetrics';\n`,
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (!text.includes('NetworkMetrics.instance.setConnectedPlayers(this.playerCount);')) {
    let replaced = replaceOnce(
      text,
      '    this._connectionPlayers.set(connection, player);\n',
      '    this._connectionPlayers.set(connection, player);\n    NetworkMetrics.instance.setConnectedPlayers(this.playerCount);\n',
    );
    text = replaced.text;
    changed = changed || replaced.changed;

    replaced = replaceOnce(
      text,
      '      this._connectionPlayers.delete(connection);\n',
      '      this._connectionPlayers.delete(connection);\n      NetworkMetrics.instance.setConnectedPlayers(this.playerCount);\n',
    );
    text = replaced.text;
    changed = changed || replaced.changed;
  }

  if (changed) {
    write(targetPlayerManagerPath, text);
  }

  return changed;
}

if (path.resolve(sourceRepo) === path.resolve(targetRepo)) {
  console.log('Instrumentation overlay manifest: none (source and target are the same checkout)');
  process.exit(0);
}

if (hasModernServerPerfHarness()) {
  manifest.server.perfHarness = 'existing';
  manifest.server.mode = 'modern-existing';
  manifest.server.snapshotApi = true;
  manifest.server.actionApi = true;
} else if (hasLegacyPerformanceBaseline()) {
  write(targetPerfHarnessPath, read(legacyPerfHarnessPath));
  manifest.applied = true;
  manifest.server.perfHarness = 'overlay';
  manifest.server.mode = 'legacy-baseline';

  if (patchWebServer()) {
    manifest.applied = true;
    manifest.server.webServerPatched = true;
  }

  manifest.server.snapshotApi = true;
  manifest.server.actionApi = false;
} else {
  write(targetPerfHarnessPath, read(minimalPerfHarnessPath));
  write(targetPerfMonitorPath, read(sourcePerfMonitorPath));
  write(targetNetworkMetricsPath, read(sourceNetworkMetricsPath));
  manifest.applied = true;
  manifest.server.perfHarness = 'overlay';
  manifest.server.mode = 'telemetry-minimal';

  if (patchWebServer()) {
    manifest.applied = true;
    manifest.server.webServerPatched = true;
  }

  if (patchWorldLoop()) {
    manifest.applied = true;
    manifest.server.worldLoopPatched = true;
  }

  if (patchConnection()) {
    manifest.applied = true;
    manifest.server.connectionPatched = true;
  }

  if (patchPlayerManager()) {
    manifest.applied = true;
    manifest.server.playerManagerPatched = true;
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
