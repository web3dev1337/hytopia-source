# Headless Testing, Browser Automation & Performance Infrastructure Research

**Date:** 2026-03-05
**Scope:** HyFire2 (all branches + worktrees) and HYTOPIA SDK engine repo
**Researcher:** AI agent reviewing all branches and codebases

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [HyFire2 Branch Inventory](#hyfire2-branch-inventory)
3. [Headless Browser Automation (Puppeteer)](#headless-browser-automation-puppeteer)
4. [Chrome DevTools Trace Analysis](#chrome-devtools-trace-analysis)
5. [CPU Profile Analysis Scripts](#cpu-profile-analysis-scripts)
6. [Sentry Performance Monitoring](#sentry-performance-monitoring)
7. [Server-Side Performance Monitoring](#server-side-performance-monitoring)
8. [Mobile Device Testing](#mobile-device-testing)
9. [ARM64 Production Simulation](#arm64-production-simulation)
10. [HYTOPIA SDK Engine Performance Code](#hytopia-sdk-engine-performance-code)
11. [CI/CD Performance Regression Plans](#cicd-performance-regression-plans)
12. [General Techniques Reference](#general-techniques-reference)
13. [Gaps and Recommendations](#gaps-and-recommendations)

---

## Executive Summary

HyFire2 has an extensive but fragmented performance testing ecosystem spread across 15+ branches. The work includes:

- **Puppeteer headless browser scripts** (6 scripts, `test/headless-browser-automation` branch) for automating game client connections through hytopia.com/play
- **Chrome DevTools trace analysis** (3 Python scripts, `feature/mobile-performance-analysis` branch) for parsing Performance tab JSON exports from mobile Chrome
- **CPU profile analysis** (6+ Node.js scripts, `investigation/perf-monitoring-analysis` branch) for parsing `--cpu-prof` V8 profiles with WASM function mapping
- **Sentry telemetry** (1593-line service, `sentry-testing` branch) with dual Hytopia SDK + direct Sentry integration for production error/performance monitoring
- **Server-side profiling** (`PerformanceMonitor.ts`, `PerformanceProfiler.ts`, `PerformanceManager.ts`) for real-time metrics, flame graphs, and spike detection
- **Mobile debug UI** (`feature/mobile-debug-ui` branch) with drag-to-reposition mobile controls tester
- **ARM64 Docker simulation** (`test/arm64-simulation` branch) for testing on AWS Graviton3-equivalent environment
- **Performance testing infrastructure doc** (1244-line planning document, `docs/performance-testing-infrastructure` branch) with full roadmap

**HYTOPIA SDK** has built-in `performance.mark`/`performance.measure` calls in the client (NetworkManager, ChunkManager), a `PerformanceMetricsManager` for FPS/memory tracking, a server-side `Telemetry` class wrapping Sentry spans, and a `DebugPanel` exposing WebGL draw calls, entity counts, chunk stats, and GLTF stats. It has NO headless browser tests, NO Puppeteer/Playwright, and NO GitHub Actions for performance testing.

**Critical gap:** None of the headless browser work has been merged to master. The scripts exist only on feature branches. There is no CI/CD integration for automated performance regression detection.

---

## HyFire2 Branch Inventory

### Branches with performance/testing code (vs master)

| Branch | Key Files | Status |
|--------|-----------|--------|
| `test/headless-browser-automation` | 6 Puppeteer scripts + server log | +951 lines, unmerged |
| `feature/mobile-performance-analysis` | 3 Python trace analyzers, analysis docs | +66,578 lines, unmerged |
| `feature/comprehensive-mobile-performance` | Per-frame budget analysis docs | Already merged to master |
| `feature/mobile-debug-ui` | Mobile controls debug JS/CSS/HTML tester | +1,322 lines, unmerged |
| `test/arm64-simulation` | ARM64 Docker runner + docs | +3,228 lines, unmerged |
| `sentry-testing` | SentryTelemetryService rewrite + analysis | +941 lines, unmerged |
| `investigation/perf-monitoring-analysis` | CPU profile scripts, WASM mappings, guides | +8,701 lines, unmerged |
| `docs/performance-testing-infrastructure` | 1244-line infrastructure planning doc | +1,244 lines, unmerged |
| `feature/sentry-telemetry` | Earlier Sentry integration attempt | Unmerged |
| `feature/sentry-review` | Sentry usage guide + config fixes | +130 lines, unmerged |
| `feature/player-stats-sentry-logging` | Player stats backup via Sentry | +64 lines, unmerged |
| `fix/device-info-from-ui-load` | Device info handshake for mobile detection | Already merged to master |

### Branches that were merged/identical to master
- `test/performance-testing` (merged)
- `feat/performance-testing-infrastructure` (merged)
- `feature/comprehensive-mobile-performance` (merged)
- `fix/device-info-from-ui-load` (merged)
- `merge/performance-testing-with-master` (merged)

### Worktrees (all on unrelated feature branches)
- `work1`: `test/sdk015-mapcomp`
- `work2`: `feature/gun-game-mode`
- `work3`: `feature/multi-world-investigation`
- `work4`: `feature/arena-queue-mode`
- `work5`: `feature/update-hytopia`
- `work6`: `fix/practice-arena-popup-investigation`
- `work7`: `fix/investigate-sensitivity-override`
- `work8`: `feature/gungame-deathmatch-20250905`

None of the worktrees contain performance testing code.

---

## Headless Browser Automation (Puppeteer)

### Branch: `test/headless-browser-automation`

Six TypeScript scripts using Puppeteer to automate connecting a browser client to HyFire2 through hytopia.com/play.

#### Scripts

**`scripts/working-headless-test.ts`** (245 lines) -- The most complete script.
- Launches Puppeteer with WebGL flags for WSL2
- Navigates to `https://hytopia.com/play?localhost:8081`
- Handles connection dialogs (clicks OK buttons, types server address)
- Waits for game to load (checks `window.localPlayer`, `window.world`)
- Takes screenshots at each step
- 30-second observation window

Key Puppeteer launch args for WebGL in WSL2:
```
--use-gl=egl
--use-angle=swiftshader-webgl
--override-use-software-gl-for-headless
--enable-unsafe-swiftshader
--enable-webgl
--enable-webgl2
```

Important: Uses `headless: false` (visible mode), not true headless. True headless Chrome has WebGL issues in WSL2.

**`scripts/diagnose-browser.ts`** (148 lines) -- Diagnostic tool.
- Captures ALL console messages, network requests, page errors
- Saves diagnostics to `/tmp/browser-diagnostics.json`
- Reports element counts (buttons, inputs, canvases, divs)
- Useful for debugging why game client fails to load

**`scripts/interactive-test.ts`** (165 lines) -- Button interaction test.
- Searches for buttons by text content (Play, Connect, OK, Continue, Join, Start)
- Searches for input fields and types server address
- Takes screenshots after each interaction step
- Progressive screenshot capture every 5 seconds

**`scripts/working-automated-test.ts`** (108 lines) -- Keyboard-driven automation.
- Uses `page.keyboard.press('Enter')` instead of DOM clicks
- Handles first OK dialog, server input dialog, skip intro, team selection
- Simpler approach that works when button selectors are unreliable

**`scripts/simple-headless-test.ts`** (79 lines) -- Minimal test.
- True `headless: true` mode (no WebGL flags)
- Navigates, waits 10 seconds, takes screenshot
- Checks `window.localPlayer`, `window.world`, `[data-team]`, `.buy-menu`
- Good for testing if basic connection works

**`scripts/simple-wait-and-screenshot.ts`** (72 lines) -- Screenshot-only test.
- No page evaluation, no clicking
- Takes screenshots at 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90 second intervals
- Useful for visual debugging of loading progress

#### Server Test Log
`test-logs/server-2025-10-05T22-22-25-688Z.log` confirms the server successfully started during a headless test session, loaded 182 models, initialized WebRTC.

#### Limitations Found
1. WSL2 requires `headless: false` with SwiftShader for WebGL
2. hytopia.com/play has connection dialogs that need automated interaction
3. Certificate issues with localhost:8081 (HTTPS self-signed)
4. No performance metric extraction yet -- scripts only test connectivity
5. No CDP protocol usage beyond Puppeteer's high-level API

---

## Chrome DevTools Trace Analysis

### Branch: `feature/mobile-performance-analysis`

Three Python scripts for analyzing Chrome DevTools Performance tab trace JSON exports.

#### `analyze-trace.py` (429 lines) -- `TraceAnalyzer` class
Parses Chrome trace JSON (`traceEvents` array) and analyzes:
- **Long tasks** (>50ms) that block the main thread
- **JavaScript execution** by category (EvaluateScript, v8.compile, v8.run, FunctionCall)
- **Rendering performance** (Layout, UpdateLayoutTree, Paint, CompositeLayers)
- **Frame times and jank detection**

Key technique: Chrome trace events use `ph: 'X'` (complete events) with `dur` in microseconds. The script groups by `name` and `cat` fields.

#### `analyze-frame-budget.py` (386 lines) -- `FrameBudgetAnalyzer` class
Per-frame analysis focused on individual calls that exceed the 16ms budget:
- Groups expensive calls (>16ms) by function name: count, min, max, avg
- Finds DrawFrame/Frame/BeginMainThreadFrame events for actual frame timing
- Compares against 60fps (16.67ms) and 30fps (33.33ms) targets
- Identifies which operations are present in slow frames

#### `analyze-recurring-blockers.py` (372 lines) -- `RecurringBlockerAnalyzer` class
Focused on RECURRING issues (not one-offs):
- Skips first 5 seconds (startup/profiler initialization)
- Filters to operations >5ms that happen 3+ times during gameplay
- Calculates impact score: `count * avg_duration`
- Identifies periodic patterns (e.g., GC every N seconds)

#### Supporting Data
- `mobile-a14-trace.json` -- Actual Chrome trace from Apple A14 device
- `recurring_blockers_raw_data.json` (61,007 lines) -- Raw extracted data from trace
- Several analysis markdown docs (MOBILE_PERFORMANCE_ANALYSIS.md, ACTUAL_CODE_ANALYSIS.md, etc.)

#### Key Findings from Analysis
- 418 long tasks blocking main thread (>50ms each)
- Weapon viewmodel rendering: 17.7s total, 32.8ms average (2x frame budget)
- Blood effects NOT disabled on mobile (50-300 particles per hit)
- GPU tasks taking 30-73ms in worst frames
- Major GC pauses up to 528ms during gameplay

---

## CPU Profile Analysis Scripts

### Branch: `investigation/perf-monitoring-analysis`

Node.js scripts for analyzing V8 `--cpu-prof` output (`.cpuprofile` JSON files) from the game server.

#### `scripts/master-performance-analysis.cjs` (768 lines) -- Primary tool
Six analysis categories:
1. **Single Worst Spikes** -- Absolute worst individual function calls
2. **Spike Cascade Analysis** -- Full call stack breakdown when a function spikes
3. **Frequent Medium Spikes** -- Regular 0.2-3ms offenders (impact = avg * count)
4. **Death by 1000 Cuts** -- Functions called >5% of samples with <0.5ms individual cost
5. **Correlated Tick Overruns** -- Ticks exceeding 16ms budget with contributor breakdown
6. **Code Classification** -- Categorizes into game-hyfire, hytopia-sdk, physics-wasm, node, gc, idle

Loads `CODEBASE_REF.md` for function-to-class mapping. Loads `wasm-mappings-report.json` for Rapier physics WASM function names.

#### `scripts/final-complete-analysis.cjs` (3,374 lines) -- CSV-oriented analysis
Complete analysis with built-in WASM mapping of 6,684 Rapier physics operations. Outputs CSV file for external analysis. Advanced categorization with parent context for anonymous functions.

#### `scripts/update-wasm-mappings.cjs` (363 lines)
Auto-discovers and maps WASM functions from CPU profiles. Uses context patterns to identify physics operations (collision, broad-phase, narrow-phase, joint, body, shape, solver, etc.). Updates mapping JSON.

#### `scripts/export-spikes-csv.cjs` (90 lines)
Simple CSV export of all CPU spikes with tick number, duration, category, function name.

#### `scripts/profile-full-report.cjs` (303 lines)
Generates markdown report from CPU profile. Includes tick window analysis (busy time per tick, spike count, largest spike).

#### `wasm-mappings-report.json` (2,977 lines)
Pre-computed mapping of WASM function IDs to human-readable Rapier physics operation names.

#### Usage Pattern
```bash
# Generate CPU profile
NODE_OPTIONS="--cpu-prof --cpu-prof-interval=100" hytopia start
# Let run 3-5 minutes with activity, then Ctrl+C

# Analyze
node scripts/master-performance-analysis.cjs CPU.*.cpuprofile 16
```

---

## Sentry Performance Monitoring

### Branch: `sentry-testing` (primary), also `feature/sentry-telemetry`, `feature/sentry-review`

#### `src/services/SentryTelemetryService.ts` (1,593 lines)

Dual integration approach:
1. **Hytopia's Telemetry class** -- Auto tick monitoring, slow-tick filtering (>17-50ms threshold)
2. **Direct Sentry SDK v10.10.0** -- Custom transactions, enriched context, manual spans

Key capabilities:
- `measurePerformance(name, callback)` -- Wraps functions in Sentry spans
- `trackGameOperation(op, callback, options)` -- Auto-warns when exceeding expected duration
- `startProfiling(name)` / `stopProfiling(name)` -- Manual span control with memory delta tracking
- `backupPlayerDataIfNeeded()` -- Sends player stats to Sentry as backup
- `backupGlobalLeaderboardIfNeeded()` -- Raw data dump of leaderboard state
- Periodic metrics reporting (every 60s)
- Memory tracking (every 30s) with heap baseline comparison

Game-specific span operations:
```
GAME_TICK, ROUND_PROCESS, BOT_TICK_ALL, BOT_BRAIN_THINK,
BOT_NAVIGATION, BOT_PATHFINDING, BOT_COMBAT_SYSTEM,
BOT_STRATEGY_SELECTION, PLAYER_DAMAGE_CALC, PLAYER_SPAWN,
PLAYER_DEATH, WEAPON_FIRE, ECONOMY_PURCHASE, UI_UPDATE,
BOMB_PLANT, BOMB_DEFUSE, BOMB_EXPLOSION,
ZONE_NAVIGATION_PATH, ZONE_PATHFIND_ALGORITHM,
AUDIO_PRIORITY_CALC, REPLAY_FRAME_CAPTURE, etc.
```

Configuration via `game-features.yaml` or environment variables:
- `SENTRY_DSN`, `SENTRY_ENABLED`, `FORCE_SENTRY_ENABLED`
- Sample rate, threshold, environment selection
- Toggle player action capture, bot decision capture, memory metrics

#### SENTRY_USAGE.md (from `feature/sentry-review`)
- Sentry disabled by default in development
- Enable via `npm run start:sentry` or `FORCE_SENTRY_ENABLED=true`
- Production: always enabled with 1% transaction sampling

#### SENTRY_INTEGRATION_ANALYSIS.md
- Documents the dual-init approach (Hytopia Telemetry + direct Sentry)
- Sentry queries: `transaction:"game.tick"`, `op:"metrics.report"`, `message:"Performance Metrics Report"`
- Files: `index.ts` (init), `SentryTelemetryService.ts` (implementation), `BotTickService.ts` (game tick wrapping)

---

## Server-Side Performance Monitoring

### On HyFire2 master (merged)

#### `src/utils/PerformanceMonitor.ts`
- `process.hrtime.bigint()` high-precision timing
- Memory tracking (heap, RSS, external)
- Event loop lag detection with rolling averages
- Per-operation stats (p50, p95, p99)
- 1-second sampling interval, 10-minute history

#### `src/utils/PerformanceProfiler.ts`
- Manual call stack tracking for flame graphs
- Function wrapping for automatic profiling
- 1ms sampling profiler
- Exports collapsed stack format for external tools (speedscope, flamegraph.pl)

#### `src/profiling/PerformanceManager.ts`
- Spike threshold detection (default 50ms)
- Auto-triggers CPU profiling on spike
- Heap snapshots at 800MB threshold
- Signal handlers: SIGUSR1 (CPU profile), SIGUSR2 (perf report)

#### `scripts/profile-server-auto.ts`
- Auto-saving performance monitor for WSL/non-interactive terminals
- Saves reports every 30 seconds to `performance-reports/` directory

#### `scripts/benchmark-game.ts`
- Automated performance benchmarking using Bun-specific APIs
- Runs scenarios, collects metrics (avgTickTime, maxTickTime, memory, event loop lag)
- Outputs JSON results

---

## Mobile Device Testing

### Branch: `feature/mobile-debug-ui`

#### `assets/ui/components/mobile-controls-debug.js` (537 lines)
In-game debug UI for mobile controls:
- Only active in Deathmatch FFA mode
- F8 key toggles debug mode
- Drag-to-reposition all mobile control elements
- Slider-based resizing of buttons/joystick
- Tracks all control elements: joystick, fire, jump, crouch, reload, drop, buy, bomb, scope, etc.
- Saves/restores custom positions

#### `assets/ui/components/mobile-controls-debug.css` (376 lines)
CSS for the debug panel overlay.

#### `mobile-controls-tester.html` (349 lines)
Standalone HTML page for testing mobile controls outside the game. Mock game background with all mobile control elements rendered.

#### `serve-mobile-tester.sh` (26 lines)
Simple HTTP server to serve the mobile tester HTML locally.

### Branch: `feature/mobile-performance-analysis`
The mobile performance analysis (Chrome traces from A14 device) is covered in the trace analysis section above.

### Branch: `fix/device-info-from-ui-load` (merged to master)
Device detection handshake:
- Loads `device-detector.js` and `team-config.js` from CDN
- Client sends `device_detector_ready`, responds to `request-device-info`
- Server starts 5s timeout on ready, sends single request
- Anchored to UI LOAD event (no postMessage/fallbacks)

---

## ARM64 Production Simulation

### Branch: `test/arm64-simulation`

#### `run-arm64-server.sh` (87 lines)
Docker-based ARM64 emulation matching AWS m7g.large:
- `--platform linux/arm64` with QEMU emulation
- `--cpus="2.0" --memory="8g"` resource limits
- Base image: `arm64v8/node:20`
- Installs Bun with 3-attempt retry logic
- Caches Bun in Docker volume
- Maps port 8080

#### `ARM64_PRODUCTION_TESTING.md` (139 lines)
Documentation covering:
- Expected 10-50x slower than native due to emulation overhead
- Good for compatibility testing, NOT for performance testing
- Quick start, monitoring commands, troubleshooting

---

## HYTOPIA SDK Engine Performance Code

### Client-Side (`/home/ab/GitHub/hytopia/work1/client/src/`)

#### `core/PerformanceMetricsManager.ts`
- FPS measurement using Three.js Clock
- Refresh rate estimation (samples 30 frames, trims outliers, snaps to common rates)
- Memory tracking via `performance.memory` (Chrome only)
- Common refresh rates: 30, 60, 72, 90, 120, 144, 165, 240, 300, 360

#### `core/DebugPanel.ts`
Exposes via lil-gui:
- Player/camera position
- Server protocol info
- WebGL stats: drawCalls, geometries, programs, textures, triangles
- Entity stats: count, frustumCulled, animationPlay, lightLevelUpdate, etc.
- Chunk stats: visible, blockCount, opaque/transparent/liquid faces
- GLTF stats: fileCount, sourceMesh, clonedMesh, instancedMesh, drawCallsSaved
- SceneUI, Arrow, Audio stats

#### `network/NetworkManager.ts` -- Performance marks
```typescript
performance.mark('NetworkManager:connecting');
performance.mark('NetworkManager:connected');
performance.measure('NetworkManager:connected-time', ...);
performance.mark('NetworkManager:world-packet-received');
performance.measure('NetworkManager:connected-to-first-packet-time', ...);
performance.measure('NetworkManager:game-ready-time', ...);
```

#### `chunks/ChunkManager.ts` -- Performance marks
```typescript
performance.mark('ChunkManager:first-chunk-batch-built');
performance.measure('ChunkManager:first-chunk-batch-built-time', 'NetworkManager:connected', ...);
```

### Server-Side (`/home/ab/GitHub/hytopia/work1/server/src/`)

#### `metrics/Telemetry.ts` (252 lines)
- `TelemetrySpanOperation` enum: BUILD_PACKETS, ENTITIES_TICK, PHYSICS_STEP, NETWORK_SYNCHRONIZE, WORLD_TICK, etc.
- `Telemetry.initializeSentry(dsn, threshold)` -- Initializes Sentry with tick-time filtering
- `Telemetry.startSpan(options, callback)` -- Zero-overhead span wrapping (no-op without Sentry)
- `Telemetry.getProcessStats()` -- Heap, RSS, usage percentage
- `Telemetry.sentry()` -- Direct Sentry SDK access
- `beforeSendTransaction` filters to only send TICKER_TICK spans exceeding threshold

### No Headless Testing
- `server/test/_setup.ts` contains only a placeholder comment
- No `client/test/` directory exists
- No Puppeteer/Playwright in any `package.json`
- No GitHub Actions workflows in the engine repo

---

## CI/CD Performance Regression Plans

### Branch: `docs/performance-testing-infrastructure`

A 1,244-line planning document (`docs/PERFORMANCE_TESTING_INFRASTRUCTURE.md`) outlines a 5-phase roadmap:

#### Phase 1: Foundation
- Install Puppeteer
- Create headless browser test scaffold
- Add test hooks to server (`ENABLE_TEST_HOOKS` env var)
- Baseline capture and comparison scripts

#### Phase 2: Specific Fix Validation
- Test grenade death spike with automated scenario
- Before/after comparison with metrics proof

#### Phase 3: Automated Testing Suite
- YAML scenario definitions (spawn bots, force loadout, kill player, measure)
- Scenario runner with action executors
- 5 core test scenarios planned

#### Phase 4: CI/CD Integration
Proposed GitHub Actions workflow:
```yaml
# .github/workflows/performance-test.yml
on:
  pull_request:
    branches: [master]

steps:
  - Checkout master baseline
  - Capture baseline metrics
  - Checkout PR branch
  - Capture PR metrics
  - Compare (block merge if >10% regression)
```

#### Phase 5: Continuous Monitoring
- Production spike alerting
- Weekly performance reports
- Automatic profiling triggers

**Current status:** Planning only. None of this CI/CD infrastructure has been built.

---

## General Techniques Reference

### Parsing Chrome DevTools Performance Traces

Chrome Performance tab exports a JSON file with `traceEvents` array. Each event has:
- `name`: Operation name (FunctionCall, Paint, Layout, etc.)
- `cat`: Category (devtools.timeline, v8, blink, etc.)
- `ph`: Phase (`X` = complete, `B`/`E` = begin/end, `I` = instant)
- `ts`: Timestamp in microseconds
- `dur`: Duration in microseconds (for `ph: 'X'`)
- `args`: Event-specific data (URL, function name, etc.)
- `tid`: Thread ID
- `pid`: Process ID

To find frame budget violations: filter for `ph === 'X'` events where `dur / 1000 > 16.67`.

### Capturing Performance Metrics from Three.js with Puppeteer

```javascript
const page = await browser.newPage();
await page.goto(gameUrl);

// Extract Three.js renderer stats via CDP
const stats = await page.evaluate(() => {
  // Access Three.js renderer info
  const renderer = /* get renderer reference */;
  return {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length || 0,
    fps: /* from PerformanceMetricsManager */,
    memory: performance.memory ? {
      usedHeap: performance.memory.usedJSHeapSize,
      totalHeap: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit
    } : null
  };
});
```

For continuous monitoring, use `setInterval` inside `page.evaluate` and collect data via `page.exposeFunction`.

### Measuring WebTransport/WebSocket Latency

Client-side approach using the existing heartbeat packet:
```typescript
// The HYTOPIA protocol already has bidirectional Heartbeat packets
// Client sends heartbeat, server echoes, measure round-trip

const t0 = performance.now();
sendHeartbeat();
onHeartbeatResponse(() => {
  const rtt = performance.now() - t0;
  // rtt is the round-trip latency
});
```

For automated testing, inject timing via Puppeteer:
```javascript
await page.evaluate(() => {
  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    performance.mark('ws-send-' + Date.now());
    return originalSend.call(this, data);
  };
});
```

### Running Headless Game Clients for Stress Testing

Pattern for multi-client stress testing:
```javascript
const browsers = await Promise.all(
  Array(clientCount).fill(null).map(() =>
    puppeteer.launch({
      headless: 'new',  // New headless mode
      args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader']
    })
  )
);

// Each browser connects to the game server
for (const browser of browsers) {
  const page = await browser.newPage();
  await page.goto(gameUrl);
  // Automate connection flow...
}

// Monitor server-side metrics while clients are connected
```

Note: In WSL2, SwiftShader is required for WebGL. Each headless Chrome uses 300-400MB RAM. For 10+ clients, consider running on a machine with ample memory.

### Collecting GPU/Renderer Stats from Three.js

Available via `renderer.info`:
```javascript
{
  render: {
    calls: number,      // Draw calls per frame
    triangles: number,  // Triangles rendered
    points: number,
    lines: number,
    frame: number       // Frame counter
  },
  memory: {
    geometries: number, // Active geometries
    textures: number    // Active textures
  },
  programs: WebGLProgram[] // Active shader programs
}
```

Reset per frame with `renderer.info.reset()` to get per-frame stats.

For GPU timing (Chrome-only, requires `EXT_disjoint_timer_query_webgl2`):
```javascript
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
if (ext) {
  const query = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
  // render...
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  // Read result next frame (async)
  const elapsed = gl.getQueryParameter(query, gl.QUERY_RESULT);
  const gpuTimeMs = elapsed / 1e6;
}
```

### Network Throttling with Puppeteer CDP

```javascript
const client = await page.target().createCDPSession();

// Simulate 3G network
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  downloadThroughput: 1.5 * 1024 * 1024 / 8,  // 1.5 Mbps
  uploadThroughput: 750 * 1024 / 8,              // 750 Kbps
  latency: 40                                     // 40ms RTT
});

// Device emulation
await client.send('Emulation.setDeviceMetricsOverride', {
  width: 375,
  height: 812,
  deviceScaleFactor: 3,
  mobile: true
});

// CPU throttling (4x slowdown)
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
```

### Lighthouse Integration

```javascript
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
const result = await lighthouse(gameUrl, {
  port: chrome.port,
  onlyCategories: ['performance'],
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 4
  }
});
// result.lhr.categories.performance.score
```

Note: Lighthouse is designed for page load, not persistent game sessions. Use for initial load metrics only.

---

## Gaps and Recommendations

### Critical Gaps

1. **No merged headless testing** -- All 6 Puppeteer scripts are on unmerged branches. No automated way to test client behavior.

2. **No CI/CD performance gates** -- The `docs/performance-testing-infrastructure` branch has a full plan but zero implementation.

3. **No client-side automated testing** -- HYTOPIA SDK has `server/test/_setup.ts` (empty placeholder) and no client test directory at all.

4. **No WebTransport/WebSocket latency monitoring** -- The protocol has heartbeat packets but no automated latency measurement.

5. **No GPU profiling pipeline** -- The DebugPanel exposes WebGL stats but there's no automated way to collect them over time.

6. **Sentry not merged** -- The comprehensive SentryTelemetryService (1,593 lines) is still on `sentry-testing` branch.

### What Exists and Works

1. **Server CPU profiling** -- Mature toolchain with WASM mapping (6,684 Rapier functions), 6 analysis categories
2. **Server real-time monitoring** -- PerformanceMonitor, PerformanceProfiler, PerformanceManager all on master
3. **Client performance marks** -- NetworkManager and ChunkManager use `performance.mark`/`measure`
4. **Mobile trace analysis** -- Complete Python toolchain for Chrome DevTools trace JSON
5. **Sentry integration** -- Fully implemented, just needs to be merged and enabled

### Recommended Next Steps

1. Merge `sentry-testing` branch -- Production monitoring with zero effort
2. Merge `test/headless-browser-automation` -- Foundation for all future automation
3. Build on Puppeteer scripts to extract `renderer.info` stats over time
4. Implement the Phase 1 items from `docs/performance-testing-infrastructure`
5. Add `performance.measure` calls around entity rendering, chunk meshing, and network deserialization in the client
6. Create a simple CI action that runs headless browser connection test on every PR
