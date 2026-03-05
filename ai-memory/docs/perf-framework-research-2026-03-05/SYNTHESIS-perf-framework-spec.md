# HYTOPIA Performance Framework - Research Synthesis & Specification

**Date:** 2026-03-05
**Sources:** 6 research documents covering HyFire2 (100+ perf branches, 63 curated PRs) and HYTOPIA SDK engine
**Scope:** Server profiling, client profiling, network monitoring, headless automation, mobile testing, CI/CD regression detection

---

## Executive Summary

### What Exists

The HYTOPIA ecosystem already has substantial performance infrastructure, but it is **fragmented across repos, branches, and merge states**:

- **HYTOPIA SDK (engine):** Built-in Sentry-based server telemetry (zero-overhead when disabled), client FPS/memory tracking via `PerformanceMetricsManager`, startup performance marks (`performance.mark`/`measure`), WebGL debug stats panel, automatic quality adjustment, and RTT measurement via SyncRequest/SyncResponse. The SDK provides the foundational hooks but no aggregation, no local dev profiling (Sentry-only), and no automated benchmarks.

- **HyFire2 (game):** 63 curated performance PRs across 4 months (July-October 2025), 300+ hours of work. On master: a full profiling suite (`PerformanceManager`, `PerformanceMonitor`, `PerformanceProfiler`, `FrameBudgetMonitor`), 16+ analysis scripts, headless browser test scaffolding, baseline capture/comparison tools, YAML test scenarios, and 82 unique instrumentation points. Unmerged: 26 PRs including the most advanced monitoring (flame charts, spike detection with game state snapshots, Python trace analyzers, Excel analysis pipeline, particle stress tester).

### What's Missing

1. **No reusable performance framework** -- All tools are game-specific (HyFire2) or engine-specific (SDK). No shared toolkit exists for any HYTOPIA game developer.
2. **No local SDK profiling** -- `Telemetry.startSpan()` is a no-op without Sentry. Developers have zero built-in performance visibility during local development.
3. **No automated benchmarks** -- The `big-world` SDK example loads a large map but has no timing or measurement. No stress test example exists.
4. **No CI/CD performance gates** -- A 1,244-line infrastructure plan exists on an unmerged branch but nothing is built.
5. **No client frame breakdown** -- FPS is tracked but not frame-time components (render, JS, network, GC).
6. **No GPU profiling** -- WebGL draw calls and triangle counts are shown but no GPU millisecond timing.
7. **No cross-device pipeline** -- Chrome trace analysis scripts exist but require manual capture. No automated device testing.
8. **No server-to-client perf telemetry** -- No protocol packet carries server tick time or entity count to the client.

### What We Need

A **HYTOPIA Performance Framework** consisting of:
1. An SDK-level performance module (built into the engine, usable by any game)
2. A standalone benchmark runner (CLI tool for repeatable tests)
3. A headless device testing pipeline (Puppeteer/Playwright-based)
4. Trace analysis tools (Python/Node scripts for Chrome trace + CPU profile parsing)
5. A regression detector (CI/CD integration with baseline comparison)
6. A dashboard/reporter (HTML reports with historical comparisons)

---

## Inventory of Existing Performance Code

### Already Merged (Ready to Use)

#### HYTOPIA SDK Engine (server + client)

| Component | File | What It Does |
|-----------|------|-------------|
| Telemetry (Sentry spans) | `server/src/metrics/Telemetry.ts` | Wraps Sentry spans around tick subsystems. Zero-overhead no-op without Sentry. 12 span operations defined. |
| WorldLoop timing | `server/src/worlds/WorldLoop.ts` | Emits `TICK_END` with `tickDurationMs` every tick. SDK event any game can listen to. |
| Simulation timing | `server/src/worlds/physics/Simulation.ts` | Emits `STEP_END` with `stepDurationMs` for physics. |
| Ticker safeguards | `server/src/shared/classes/Ticker.ts` | `TICK_SLOW_UPDATE_CAP=2`, `MAX_ACCUMULATOR_TICK_MULTIPLE=3`. Prevents spiral-of-death. |
| IterationMap | `server/src/shared/classes/IterationMap.ts` | Custom Map+Array hybrid for ~2x faster iteration. Used in all sync queues. |
| Connection packet cache | `server/src/networking/Connection.ts` | Encode-once, send-to-N serialization cache. Gzip at level 1 for >64KB packets. |
| Network sync (30Hz) | `server/src/networking/NetworkSynchronizer.ts` | GC-aware queue clearing, reliable/unreliable packet splitting, lazy cache clearing. |
| SyncRequest/SyncResponse | `server/src/networking/`, protocol | RTT measurement every 2s. Server sends `r`, `s`, `p`, `n` timestamps. |
| PerformanceMetricsManager | `client/src/core/PerformanceMetricsManager.ts` | FPS (1s window), delta time, memory (Chrome-only `performance.memory`), refresh rate estimation. |
| DebugPanel | `client/src/core/DebugPanel.ts` | Stats.js FPS/MS/MB/RTT panels. lil-gui folders for WebGL, Entity, Chunk, GLTF, Audio, SceneUI, Arrow stats. |
| Stats classes | `client/src/entities/EntityStats.ts`, `chunks/ChunkStats.ts`, `gltf/GLTFStats.ts`, `audio/AudioStats.ts`, `arrows/ArrowStats.ts`, `ui/SceneUIStats.ts` | Per-subsystem static counters, reset each frame. |
| Startup marks | `client/src/network/NetworkManager.ts`, `client/src/chunks/ChunkManager.ts` | `performance.mark`/`measure` for connecting, connected, first-packet, first-chunk-batch, game-ready. |
| Quality auto-adjust | `client/src/settings/SettingsManager.ts` | ULTRA/HIGH/MEDIUM/LOW/POWER_SAVING presets. Auto-adjusts based on FPS with warmup, bounce protection, mobile cap. |
| View distance + frustum culling | `client/src/entities/Entity.ts`, `EntityManager.ts` | Squared distance checks, frustum culling, update skipping. |
| Renderer optimization | `client/src/core/Renderer.ts` | `matrixAutoUpdate=false` on all scenes, manual resets, FPS cap, custom transparent sort. |

#### HyFire2 Game (on master)

| Component | File | What It Does |
|-----------|------|-------------|
| PerformanceManager | `src/profiling/PerformanceManager.ts` | Spike detection (>50ms), auto CPU profiling on spike, heap snapshots at 800MB, SIGUSR1/SIGUSR2 signal handlers. Event loop lag detection. |
| InspectorCpuProfiler | `src/profiling/InspectorCpuProfiler.ts` | V8 Inspector API (`Profiler` domain) wrapper. Outputs `.cpuprofile` files compatible with Chrome DevTools. Signal-based profiling. |
| @Monitor decorator | `src/profiling/decorators.ts` | `@Monitor`, `@MonitorClass`, `monitorBlock()`, `monitorAsyncBlock()`. Wraps methods in `performanceManager.measure()`. |
| PerformanceMonitor | `src/utils/PerformanceMonitor.ts` | Sampling-based metrics with p50/p95/p99. Memory and event loop lag. 1s sampling, 10-min history. (Sampling currently DISABLED due to OOM.) |
| PerformanceProfiler | `src/utils/PerformanceProfiler.ts` | Manual call stack profiler. Exports collapsed stack format for flame graphs. 1ms sampling. |
| FrameBudgetMonitor | `src/utils/FrameBudgetMonitor.ts` | 16.66ms frame budget tracking. Spike threshold 8ms. Worst frame tracking. Top offenders. 82 unique `measure()` calls across codebase. |
| ClientPerformanceReporter | `src/utils/ClientPerformanceReporter.ts` | Server-side FPS report aggregator from clients. Issue detection (<30 FPS, >50ms frame time, >1GB memory). Performance tier classification. |
| ZoneVisibilityMonitor | `src/utils/ZoneVisibilityMonitor.ts` | Raycast skip rate tracking. 30s report interval. |
| benchmark-game.ts | `scripts/benchmark-game.ts` | Automated benchmarks: idle, 5v5_combat, 10v10_full, stress_test scenarios. JSON output. |
| profile-server-auto.ts | `scripts/profile-server-auto.ts` | Auto-saving ANSI dashboard. 30s auto-save to `performance-reports/`. |
| capture-baseline.sh | `scripts/capture-baseline.sh` | 5-min server run with bots, extracts perf.* events, calculates stats, saves JSON baseline. |
| compare-baselines.ts | `scripts/compare-baselines.ts` | Compares two baseline JSONs. Flags regressions >5%. Exit code 1 on regression. CI-ready. |
| analyze-performance.cjs | `scripts/analyze-performance.cjs` | Parses .cpuprofile, builds call tree, top 20 hot functions by self time. |
| analyze-full-profile.cjs | `scripts/analyze-full-profile.cjs` | Top 100 functions from CPU profile. Game vs system categorization. |
| map-profile-to-code.cjs | `scripts/map-profile-to-code.cjs` | Maps V8 profile functions to source code via CODEBASE_REF.md. |
| generate-flamegraph.ts | `scripts/generate-flamegraph.ts` | Interactive HTML flame graphs from collapsed stack format. |
| generate-flame-chart.cjs | `scripts/generate-flame-chart.cjs` | HTML flame chart from performance-reports JSON. |
| visualize-perf.js | `scripts/visualize-perf.js` | ASCII bar charts sorted by P99 latency. |
| analyze-bottleneck.js | `scripts/analyze-bottleneck.js` | Worst-frame JSON analysis. |
| analyze-entity-lookups.sh | `scripts/analyze-entity-lookups.sh` | Audits inefficient entity lookup patterns. |
| analyze-latest-session.ts | `scripts/analyze-latest-session.ts` | Latest session log analysis with full stat breakdown. |
| test-grenade-spike.ts | `scripts/test-grenade-spike.ts` | Automated Puppeteer test: buys grenades, dies, measures handleDeath. |
| headless-player.ts | `scripts/lib/headless-player.ts` | Puppeteer headless browser player for automated testing. |
| server-controller.ts | `scripts/lib/server-controller.ts` | Server lifecycle management for tests. |
| metrics-extractor.ts | `scripts/lib/metrics-extractor.ts` | NDJSON log parser with stat calculation. |
| scenario-types.ts | `scripts/lib/scenario-types.ts` | TypeScript types for YAML test scenarios. |
| grenade-death.yaml | `scenarios/grenade-death.yaml` | YAML scenario with thresholds and pass/fail criteria. |
| analyze-frame-budget.py | `analyze-frame-budget.py` | Chrome trace frame budget analysis. 60fps and 30fps targets. |
| analyze-recurring-blockers.py | `analyze-recurring-blockers.py` | Recurring frame blockers (>3 occurrences, skips startup). Impact scoring. |
| Debug UI config | `src/config/DebugUIConfig.ts` | Cached flag lookups for perf-relevant debug toggles. |

### Unmerged (Needs Cherry-Picking)

Ranked by value for a reusable framework, highest first.

#### Tier 1: High Value, Ready to Adapt

| Branch | Key Content | Lines Added | Why It Matters |
|--------|-------------|-------------|---------------|
| `feature/add-game-performance-monitoring` | FlameChartRecorder (Chrome Trace Event format), enhanced SpikeDetector with bot state snapshots, D3.js flame chart viewer, 12 analysis scripts | +10,306 | **Only source of Chrome Trace Event format output.** FlameChartRecorder is directly reusable for any HYTOPIA game. |
| `feature/performance-monitoring-improvements` | Enhanced FrameBudgetMonitor with hierarchical tracking, self-time calculation, interactive flamechart HTML export, performance context (strategy, zone, enemies) | +4,405 | **Self-time and hierarchy are critical for meaningful profiling.** Current FrameBudgetMonitor on master has flat operation tracking only. |
| `feature/performance-monitoring-ui` | PerformanceMetricsService, FunctionProfiler, SessionSpikeTracker, SystemProfiler, F9 client overlay | +2,311 | **The only real-time visual monitoring UI.** F9 overlay with Overview/Spikes/Logs/Operations tabs. |
| `feature/performance-analysis-combined` | 200+ per-function spike analyses, instrumentation guide with ROI ranking, actual code fixes with A/B validation report, 1.6M-line codebase call graph | +1,785,915 | **Most comprehensive analysis ever done.** The INSTRUMENTATION_GUIDE.md methodology is directly reusable. |
| `test/headless-browser-automation` | 6 Puppeteer scripts for automating game client through hytopia.com/play | +951 | **Foundation for all headless testing.** Working scripts with WSL2 WebGL workarounds documented. |
| `fix/memory-optimizations` | PathfindingCache (pool of 20 Maps/Sets), PlayerCache (pre-categorized, readonly), BotManager readonly array return | Unmerged PR | **Object pooling patterns** directly applicable to framework benchmarks. |

#### Tier 2: Valuable, Needs Adaptation

| Branch | Key Content | Lines Added | Why It Matters |
|--------|-------------|-------------|---------------|
| `feature/performance-analysis-tools` | Python CSV-to-Excel analysis pipeline. Generates XLSX with pivot tables, high-variance functions, spike details | +3,333 | **Structured analysis for non-developers.** Excel output is shareable with stakeholders. |
| `feature/particle-stress-tester` | ParticleStressTester class (8 scenarios: weapons, smoke, HE, molotov, flash, blood, stress, ramp), F2 menu | +831 | **Only particle stress testing tool.** Directly reusable pattern for framework stress scenarios. |
| `feature/performance-monitoring-hybrid` | PerformanceLagDetector (CPU polling every 50ms, spike snapshots), PerformanceMonitoringConfig interface | +698 | **Production-safe polling approach.** Alternative to function wrapping when overhead matters. |
| `feature/bot-cover-micro-profiler` | Prototype patching with Symbol guard, env-var gating (`BOT_COVER_PROF=1`), JSON report on exit | +1,269 | **Cleanest opt-in profiler design.** Symbol-guarded prototype patching prevents double-wrap. |
| `feature/mobile-performance-analysis` | 3 Python trace analyzers (TraceAnalyzer, FrameBudgetAnalyzer, RecurringBlockerAnalyzer) | +66,578 | **Mobile-specific analysis tools.** Chrome trace parsing for mobile device profiling. |
| `feature/baseline-lag-optimization` | Mobile frame skipping (30fps on mobile), viewmodel bob disable | +64,772 | **Mobile optimization patterns.** Frame skipping technique applicable to quality presets. |
| `investigation/perf-monitoring-analysis` | master-performance-analysis.cjs (768 lines, 6 analysis categories), WASM function mapping (6,684 Rapier functions), final-complete-analysis.cjs (3,374 lines) | +8,701 | **Deepest CPU profile analysis.** WASM mapping is unique -- only tool that can identify Rapier physics functions in profiles. |
| `sentry-testing` | SentryTelemetryService (1,593 lines), dual SDK integration, 30+ game-specific span operations | +941 | **Production monitoring.** Fully implemented, just needs merge and enable. |
| `fix/10v10-performance-analysis` | DistanceCullingService, OptimizedBroadcastService, tiered update rates by distance | Unmerged PR | **Network optimization patterns** for scaling to many players. |
| `test/arm64-simulation` | Docker ARM64 emulation matching AWS m7g.large | +3,228 | **Production environment simulation.** Good for compatibility (not performance) testing. |

#### Tier 3: Documentation / Planning Only

| Branch | Content |
|--------|---------|
| `docs/performance-testing-infrastructure` | 1,244-line roadmap for CI/CD perf testing. Phase 1-5 plan. GitHub Actions workflow template. |
| `docs/performance-monitoring-ultrathink-analysis` | 93KB technical deep-dive. Smart spike aggregation, tree filtering, Chrome Trace/Speedscope export research. |
| `analysis/performance-work-3mo` | 3-month retrospective. 63 curated PRs. 26 unmerged PR analysis. Quantified improvements. |
| `docs/performance-analysis-outputs` | CPU profile correlation with Trello cards. Dependency graph of 219 perf records. Baseline capture scripts. |
| `analysis/performance-monitoring-strategy` | 4-phase monitoring strategy. PerformanceLagDetector design. Sentry dual-SDK setup docs. |
| `analysis/code-hotspots-metrics` | Static hotspot analysis with before/after code examples. Spatial grid indexing proposal. |

### Key Files & Locations

#### HYTOPIA SDK Engine

```
/home/ab/GitHub/hytopia/work1/
├── server/src/
│   ├── metrics/Telemetry.ts                    # Sentry span wrapper (12 operations)
│   ├── worlds/WorldLoop.ts                     # TICK_START/TICK_END events
│   ├── worlds/physics/Simulation.ts            # STEP_START/STEP_END events
│   ├── shared/classes/Ticker.ts                # Fixed timestep with safeguards
│   ├── shared/classes/IterationMap.ts           # Fast-iteration Map+Array
│   ├── networking/NetworkSynchronizer.ts        # 30Hz sync, GC-aware clearing
│   ├── networking/Connection.ts                 # Packet cache, gzip, MTU handling
│   └── GameServer.ts                           # Start timing
├── client/src/
│   ├── core/PerformanceMetricsManager.ts        # FPS, memory, refresh rate
│   ├── core/DebugPanel.ts                      # Stats.js + lil-gui overlay
│   ├── core/Renderer.ts                        # WebGL stats, FPS cap, matrix opt
│   ├── settings/SettingsManager.ts              # Quality auto-adjust
│   ├── network/NetworkManager.ts               # RTT, performance marks
│   ├── chunks/ChunkManager.ts                  # Chunk performance marks
│   ├── entities/EntityStats.ts                 # Entity counters
│   ├── chunks/ChunkStats.ts                    # Chunk counters
│   ├── gltf/GLTFStats.ts                       # GLTF counters
│   ├── audio/AudioStats.ts                     # Audio counters
│   ├── arrows/ArrowStats.ts                    # Arrow counters
│   └── ui/SceneUIStats.ts                      # SceneUI counters
└── protocol/
    ├── packets/inbound/SyncRequest.ts           # RTT request
    ├── packets/outbound/SyncResponse.ts         # RTT response
    └── packets/inbound/DebugConfig.ts           # Physics debug toggle
```

#### HyFire2 Game (master)

```
~/GitHub/games/hyfire2/
├── src/profiling/
│   ├── PerformanceManager.ts                   # Spike detection, auto CPU profiling
│   ├── InspectorCpuProfiler.ts                 # V8 Inspector API wrapper
│   └── decorators.ts                           # @Monitor, @MonitorClass, monitorBlock
├── src/utils/
│   ├── PerformanceMonitor.ts                   # Sampling metrics, percentiles
│   ├── PerformanceProfiler.ts                  # Call stack profiler, flame graphs
│   ├── FrameBudgetMonitor.ts                   # Frame budget tracking (82 measure points)
│   ├── ClientPerformanceReporter.ts            # Client FPS aggregation
│   └── ZoneVisibilityMonitor.ts                # Raycast optimization monitoring
├── scripts/
│   ├── benchmark-game.ts                       # Automated scenarios
│   ├── profile-server-auto.ts                  # ANSI dashboard + auto-save
│   ├── capture-baseline.sh                     # Baseline JSON capture
│   ├── compare-baselines.ts                    # Baseline regression comparison
│   ├── analyze-performance.cjs                 # CPU profile analysis
│   ├── analyze-full-profile.cjs                # Top 100 functions
│   ├── map-profile-to-code.cjs                 # Profile-to-source mapping
│   ├── generate-flamegraph.ts                  # HTML flame graph
│   ├── generate-flame-chart.cjs                # HTML flame chart
│   ├── visualize-perf.js                       # ASCII bar charts
│   ├── analyze-bottleneck.js                   # Worst-frame analysis
│   ├── analyze-entity-lookups.sh               # Entity lookup audit
│   ├── analyze-latest-session.ts               # Session log analysis
│   ├── test-grenade-spike.ts                   # Puppeteer perf test
│   └── lib/
│       ├── headless-player.ts                  # Puppeteer game client
│       ├── server-controller.ts                # Server lifecycle
│       ├── metrics-extractor.ts                # NDJSON log parser
│       └── scenario-types.ts                   # YAML scenario types
├── scenarios/
│   └── grenade-death.yaml                      # Test scenario definition
├── analyze-frame-budget.py                     # Chrome trace analysis
└── analyze-recurring-blockers.py               # Recurring blocker analysis
```

---

## Techniques Catalog

### Server-Side Profiling

#### 1. V8 Inspector CPU Profiling
**Source:** HyFire2 `src/profiling/InspectorCpuProfiler.ts`

Uses Node.js `inspector.Session` to capture V8 CPU profiles programmatically. Output is `.cpuprofile` JSON, loadable in Chrome DevTools or analyzable with custom scripts.

```typescript
const session = new inspector.Session();
session.connect();
session.post('Profiler.enable');
session.post('Profiler.start');
// ... run for duration ...
session.post('Profiler.stop', (err, { profile }) => {
  fs.writeFileSync('profile.cpuprofile', JSON.stringify(profile));
});
```

**Auto-trigger:** PerformanceManager triggers a 5s CPU profile capture (with 30s cooldown) when any operation exceeds the spike threshold. SIGUSR1 signal toggles manual profiling.

#### 2. performance.now() Checkpoint Instrumentation
**Source:** HyFire2 `src/entities/GamePlayerEntity.ts` (50+ calls)

The most common profiling pattern. Places `performance.now()` at section boundaries within a function, logs checkpoint data when total exceeds threshold.

```typescript
function handleDeath() {
  const perfStart = performance.now();
  const checkpoints: Record<string, number> = {};

  // Section 1
  const s1 = performance.now();
  doLogging();
  checkpoints.logging = performance.now() - s1;

  // Section 2
  const s2 = performance.now();
  calcHealth();
  checkpoints.healthCalc = performance.now() - s2;

  const total = performance.now() - perfStart;
  if (total > 0.5) {
    eventLogger.info('perf.handleDeath', { totalMs: total.toFixed(3), checkpoints });
  }
}
```

**Overhead:** Negligible (~0.001ms per `performance.now()` call). The conditional logging threshold prevents log spam.

#### 3. @Monitor Decorators
**Source:** HyFire2 `src/profiling/decorators.ts`

Zero-effort instrumentation via TypeScript decorators. Auto-detects sync vs async methods.

```typescript
@MonitorClass()
class BotBrain {
  // Every method automatically measured as "BotBrain.methodName"
  think() { ... }
  evaluateCombat() { ... }
}

// Or per-method:
class GameManager {
  @Monitor()
  handleDeath() { ... }
}

// Or inline:
monitorBlock('zone.lookup', () => findZoneForPosition(pos));
```

#### 4. FrameBudgetMonitor.measure()
**Source:** HyFire2 `src/utils/FrameBudgetMonitor.ts`

Wraps operations inline with frame-level budget tracking. 82 unique tracking points across HyFire2.

```typescript
frameBudgetMonitor.startFrame();
// ... per-operation:
frameBudgetMonitor.measure('brain.bombDetection.Alpha', () => {
  detectBomb();
});
frameBudgetMonitor.endFrame();
```

**Key metrics:** worst frame ever, top offenders (name + count + max + avg), recent spikes (last 50), frames over budget percentage.

**Known issue:** The monitor itself causes 15.4% overhead (6.59% for measure() + 8.81% for SpikeDetector start/end). This is documented and needs to be addressed in the framework with adaptive sampling.

#### 5. Sentry Telemetry Spans
**Source:** HYTOPIA SDK `server/src/metrics/Telemetry.ts`, HyFire2 `sentry-testing` branch

Zero-overhead wrapping: `Telemetry.startSpan()` is a direct function call when Sentry is not initialized. When initialized, creates hierarchical spans filtered by tick time threshold.

```typescript
Telemetry.startSpan({ op: TelemetrySpanOperation.ENTITIES_TICK }, () => {
  entityManager.tickEntities(dt);
});
```

**12 defined SDK span operations:** TICKER_TICK, WORLD_TICK, ENTITIES_TICK, SIMULATION_STEP, PHYSICS_STEP, PHYSICS_CLEANUP, ENTITIES_EMIT_UPDATES, NETWORK_SYNCHRONIZE, BUILD_PACKETS, SERIALIZE_PACKETS, SEND_PACKETS, SEND_ALL_PACKETS, NETWORK_SYNCHRONIZE_CLEANUP.

**HyFire2 extends with 30+ game-specific operations** (in the unmerged SentryTelemetryService): GAME_TICK, BOT_TICK_ALL, BOT_BRAIN_THINK, BOT_NAVIGATION, BOT_COMBAT_SYSTEM, PLAYER_DAMAGE_CALC, WEAPON_FIRE, BOMB_PLANT, etc.

#### 6. Chrome Trace Event Format Recording
**Source:** HyFire2 `feature/add-game-performance-monitoring` branch, `FlameChartRecorder.ts`

Records operations in Chrome Trace Event format, loadable in `chrome://tracing`, Speedscope, or the custom D3.js viewer.

```typescript
interface TraceEvent {
  name: string;
  cat: string;   // category
  ph: string;    // 'B' (begin), 'E' (end), 'X' (complete)
  ts: number;    // timestamp in microseconds
  pid: number;
  tid: number;
  dur?: number;
  args?: any;
}
```

Uses logical thread IDs: MAIN=1, BOTS=2, PHYSICS=3, NETWORK=4.

#### 7. Process Stats / Memory Monitoring
**Source:** HYTOPIA SDK `Telemetry.getProcessStats()`, HyFire2 `PerformanceManager`

```typescript
// SDK:
Telemetry.getProcessStats(true) // { jsHeapSizeMb, jsHeapCapacityMb, rssSizeMb, ... }

// HyFire2:
v8.writeHeapSnapshot() // Triggered when heap > 800MB
process.memoryUsage()  // { heapUsed, heapTotal, rss, external }
```

**Known limitation:** Bun does not expose `process.cpuUsage()`. HyFire2's PerformanceMonitor uses a hardcoded 0.7/0.3 multiplier -- effectively fake CPU stats.

#### 8. Prototype Patching with Symbol Guard
**Source:** HyFire2 `feature/bot-cover-micro-profiler`

Opt-in, zero-setup profiling via prototype patching gated by environment variable. Uses Symbol to prevent double-wrapping.

```typescript
const ENABLED = process.env.BOT_COVER_PROF === "1";
if (ENABLED) {
  const SYM = Symbol.for("PROFILER_INSTALLED");
  if (!proto[SYM]) {
    proto[SYM] = true;
    wrapMethod(proto, 'methodName', 'label');
  }
}
```

#### 9. Signal-Based Profiling
**Source:** HyFire2 `PerformanceManager`

- `SIGUSR1` -- Toggle CPU profiling on/off
- `SIGUSR2` -- Generate performance report

Useful for production environments where you cannot attach a debugger.

### Client-Side Profiling

#### 1. PerformanceMetricsManager
**Source:** HYTOPIA SDK `client/src/core/PerformanceMetricsManager.ts`

- FPS: Averaged over 1-second windows via Three.js Clock
- Memory: `performance.memory.usedJSHeapSize` / `totalJSHeapSize` (Chrome-only)
- Refresh rate estimation: Samples 30 rAF deltas, trims 10% outliers, snaps to common rates (30/60/72/90/120/144/165/240/300/360)

#### 2. Stats Classes (Per-Subsystem Counters)
**Source:** HYTOPIA SDK client, 6 stat classes

All use static fields, reset per frame by their respective managers:

| Class | Key Counters |
|-------|-------------|
| EntityStats | count, inViewDistanceCount, frustumCulledCount, updateSkipCount, animationPlayCount, localMatrixUpdateCount, worldMatrixUpdateCount |
| ChunkStats | count, visibleCount, blockCount, opaqueFaceCount, transparentFaceCount, liquidFaceCount |
| GLTFStats | fileCount, sourceMeshCount, clonedMeshCount, instancedMeshCount, drawCallsSaved |
| AudioStats | count, matrixUpdateCount, matrixUpdateSkipCount |
| ArrowStats | count, visibleCount |
| SceneUIStats | count, visibleCount |

#### 3. WebGL Renderer Stats
**Source:** HYTOPIA SDK `client/src/core/Renderer.ts` + `DebugPanel.ts`

Read from `renderer.info` (manual reset via `renderer.info.reset()` per frame):
- `render.calls` (draw calls)
- `render.triangles`
- `memory.geometries`
- `memory.textures`
- `programs.length`

#### 4. Performance API Marks/Measures
**Source:** HYTOPIA SDK client

Startup performance timeline (visible in browser DevTools):
- `NetworkManager:connecting` / `connected` / `connected-time`
- `NetworkManager:world-packet-received` / `connected-to-first-packet-time`
- `NetworkManager:game-ready-time`
- `ChunkManager:first-chunk-batch-built` / `first-chunk-batch-built-time`

#### 5. Chrome DevTools Trace Parsing
**Source:** HyFire2 Python scripts (3 analyzers)

Parses Chrome Performance tab JSON exports. Filters by `ph === 'X'` complete events with `dur` in microseconds.

| Script | Focus |
|--------|-------|
| `analyze-trace.py` | Long tasks (>50ms), JS execution breakdown, rendering perf, frame time distribution |
| `analyze-frame-budget.py` | Per-call cost (not cumulative), 60fps/30fps budget violations, weapon animation deep-dive |
| `analyze-recurring-blockers.py` | Recurring issues (3+ occurrences, skips startup), impact score, periodic pattern detection |

### Network Monitoring

#### 1. RTT Tracking via SyncRequest/SyncResponse
**Source:** HYTOPIA SDK protocol

Client sends SyncRequest every 2 seconds. Server responds with:
- `r`: server absolute time at request receipt
- `s`: server absolute time at response
- `p`: high-res processing time (ms)
- `n`: ms until next server tick

Client calculates RTT: `clientReceiveTime - syncStartTime - serverProcessingTime`. Exponential moving average with smoothing factor 0.5.

#### 2. Packet Size Monitoring
**Source:** HYTOPIA SDK `Connection.ts`

Serialization telemetry records packet count, IDs, and serialized byte count in Sentry span attributes. Gzip compression triggers at 64KB. WebTransport unreliable datagrams capped at 1200 bytes (MTU).

#### 3. WebTransport vs WebSocket Metrics
**Source:** HYTOPIA SDK `NetworkManager.ts`

Client tracks send/receive protocol (ws/wt) shown in debug panel. WebTransport uses unreliable datagrams for entity position updates; WebSocket falls back for everything. No per-transport performance comparison is built in.

### Optimization Patterns Found

Ranked by measured impact:

| Rank | Pattern | Impact | Where Used |
|------|---------|--------|-----------|
| 1 | **Death visibility deferred** | 99.6% faster (1.5ms -> 0.006ms) | `perf/optimize-death-visibility-check` |
| 2 | **Grenade disposal logging batched** | 97% faster (40-60ms -> 1.03ms) | `perf/cache-sceneui-takedamage` |
| 3 | **Stopping power require() cached** | 93% faster (3.45ms -> 0.24ms) | `perf/stopping-power-optimization` |
| 4 | **MVP tracking deferred** | 93% faster in 10v10 (0.7ms -> <0.05ms) | `perf/optimize-mvp-tracking` |
| 5 | **Debug logging removed from hot paths** | 90% overhead eliminated | `perf/remove-damage-debug-logging` |
| 6 | **Team elimination check cached** | 80% faster (0.98ms -> 0.2ms) | Various PRs |
| 7 | **Map draw calls reduced** | 70% reduction (1,597 -> 487) | Asset optimization |
| 8 | **setTimeout(fn, 0) deferral** | Spreads spikes across ticks | 5+ branches (audio, effects, physics, drops, MVP) |
| 9 | **handleDeath optimized** | 49.2% faster (3ms -> 1.5ms) | `perf/cache-sceneui-takedamage` |
| 10 | **Weapon drops sequential-deferred** | 42.8% faster | `perf/investigate-weapon-drop` |
| 11 | **Per-tick raycast cache (bidirectional)** | 39% raycast reduction | `perf/reduce-bot-combat-spike` |
| 12 | **Weapon attack optimized** | 35% faster (4.84ms -> 3.13ms) | `perf/reduce-weapon-fire-spike` |
| 13 | **Deferred evaluation (flag-based)** | 150-700x faster intel updates | `perf-monitoring-terrorist-approaches` |
| 14 | **Object/collection pooling** | 300+ allocations/sec eliminated | `fix/memory-optimizations` |
| 15 | **Set-based lookups** | O(n) -> O(1) | `perf/optimize-bot-updates` |
| 16 | **Squared distance comparison** | Eliminates Math.sqrt() | `perf/bomb-retrieval-optimization` |
| 17 | **Frame-duration caching** | Multiple-per-tick -> once-per-tick | `perf/optimize-recoil-offset-calls` |
| 18 | **Fire-and-forget logging** | Eliminates `await` in hot paths | `perf/bomb-retrieval-optimization` |
| 19 | **Rate-limited warnings** | 1/5s instead of 1/tick | `perf/rate-limit-bot-navigator-warnings` |
| 20 | **Web Audio API** | 5-20ms latency vs 100-200ms | `perf/web-audio-kill-sounds` |
| 21 | **Distance-based network LOD** | Tiered update rates (close/medium/far) | `fix/10v10-performance-analysis` |
| 22 | **Screen-space UI over SceneUI** | n^2 DOM layers -> single overlay | `fix/teammate-ui-performance-lag` |
| 23 | **Log spam rate limiting** | 99.7% reduction (3,600/min -> 12/min) | Various PRs |
| 24 | **Mobile frame skipping** | 30fps target on mobile | `feature/baseline-lag-optimization` |

### Anti-Patterns Identified

These recurring bad patterns were found across HyFire2 and should be detected by the framework's lint/audit tools:

1. `await eventLogger.debug(...)` in loops -- blocks iteration on log I/O
2. `Array.from(map.values()).includes()` -- O(n) scan with intermediate array creation
3. `[...this._collection]` on every getter call -- constant array allocation
4. `require('module')` inside tick/damage handlers -- module resolution per call
5. `JSON.parse(JSON.stringify(obj))` for deep copy -- expensive serialization roundtrip
6. `sceneUIManager.getAllSceneUIs()` to find specific UI -- full collection scan
7. Verbose logging in per-tick, per-damage, per-entity paths -- string creation + object allocation overhead
8. Creating new Map/Set in pathfinding hot paths -- GC pressure at 300+/sec
9. Multiple raycasts to same target pair in same tick -- redundant physics work
10. Synchronous physics state changes on game events -- blocks main thread

---

## Gaps & Requirements

### What's Missing in the SDK

| Gap | Severity | Description |
|-----|----------|-------------|
| No local profiling without Sentry | **Critical** | `Telemetry.startSpan()` is a no-op without Sentry DSN. Developers have zero built-in visibility during local dev. Need a lightweight local profiler that works without external services. |
| No client frame breakdown | **Critical** | Client tracks FPS but not per-frame time breakdown (render time, JS time, animation update time, network processing, GC). Cannot diagnose *why* frames are slow. |
| No per-entity cost attribution | **High** | `ENTITIES_TICK` is one span for all entities. No way to identify which entity's `tick()` callback is expensive. Need per-entity or per-entity-type timing. |
| No bandwidth metrics exposed | **High** | Serialized byte count recorded in Sentry span attributes but never aggregated or exposed to SDK consumers. No per-player bandwidth tracking, no packet-rate counters. |
| No server-to-client perf telemetry | **High** | No protocol packet carries server tick time, entity count, or any server-side metrics to the client. Debug panel cannot show server health. |
| No tick budget tracking | **High** | No system tracks percentage of 16.67ms tick budget consumed or warns when ticks consistently exceed budget. Ticker's catch-up cap is silent. |
| No GPU profiling | **Medium** | WebGL draw calls and triangles tracked but no GPU millisecond timing. `EXT_disjoint_timer_query_webgl2` not used. |
| No chunk meshing timing | **Medium** | ChunkWorker does greedy meshing in a Web Worker but has no timing instrumentation. Slow chunk builds are invisible. |
| No memory trend tracking | **Medium** | Memory sampled once per frame but no leak detection, no trend analysis, no growth warning. |
| No network jitter metrics | **Medium** | RTT tracked with exponential smoothing but no jitter calculation (variance), no packet loss counting, no out-of-order detection. |
| No GC monitoring | **Medium** | No GC event tracking. GC-aware clearing in NetworkSynchronizer is experience-based, not measured. |
| No entity count budget warnings | **Low** | Nothing warns when entity or chunk counts approach degradation thresholds. |
| Chrome-only memory tracking | **Low** | `performance.memory` is Chrome-only. Firefox/Safari users get no memory data. |
| Stats classes not time-series | **Low** | All Stats classes are instantaneous counters reset each frame. No historical data, min/max/avg, or percentiles. |

### What's Missing in Tooling

| Gap | Severity | Description |
|-----|----------|-------------|
| No CI/CD performance gates | **Critical** | A 1,244-line plan exists on a branch but nothing is built. No GitHub Actions for perf testing. No merge-blocking on regression. |
| No automated regression detection | **Critical** | `compare-baselines.ts` exists on HyFire2 master but is not wired into any CI pipeline and is game-specific. |
| No cross-device testing pipeline | **High** | Chrome trace analysis scripts exist but require manual capture from physical devices. No automated device farm. |
| No headless stress testing | **High** | Puppeteer scripts exist on unmerged branches. No merged headless test infrastructure. |
| No benchmark suite for SDK | **High** | The `big-world` example loads a large map but has no measurement. No standardized benchmark scenarios. |
| No deterministic replay | **Medium** | No way to replay exact game state for A/B comparisons. Tests depend on bot AI randomness. |
| No network condition simulation | **Medium** | Puppeteer CDP network throttling documented but not implemented in any test. |
| No shared performance results format | **Low** | Each tool outputs different formats (JSON, markdown, CSV, XLSX). No unified schema for cross-tool comparison. |

---

## Framework Architecture Proposal

### Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                  HYTOPIA Performance Framework                      │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐                │
│  │ 1. SDK Perf Module   │  │ 2. Benchmark Runner  │                │
│  │ (built into engine)  │  │ (standalone CLI)     │                │
│  │                      │  │                      │                │
│  │ - Local profiler     │  │ - Scenario loader    │                │
│  │ - Tick budget track  │  │ - Bot spawner        │                │
│  │ - Entity cost attr.  │  │ - Metric collector   │                │
│  │ - Network metrics    │  │ - Baseline compare   │                │
│  │ - Client frame break │  │ - JSON/HTML output   │                │
│  │ - Perf telemetry pkt │  │ - YAML scenarios     │                │
│  └──────────┬───────────┘  └──────────┬───────────┘                │
│             │                         │                             │
│  ┌──────────┴───────────┐  ┌──────────┴───────────┐                │
│  │ 3. Device Pipeline   │  │ 4. Trace Analyzer    │                │
│  │ (Puppeteer/Playwright)│  │ (Python/Node)       │                │
│  │                      │  │                      │                │
│  │ - Headless clients   │  │ - Chrome trace parse │                │
│  │ - Network throttle   │  │ - CPU profile parse  │                │
│  │ - CDP metrics pull   │  │ - WASM fn mapping    │                │
│  │ - GPU timing (ext)   │  │ - Flame graph gen    │                │
│  │ - Mobile emulation   │  │ - Spike aggregation  │                │
│  └──────────┬───────────┘  └──────────┬───────────┘                │
│             │                         │                             │
│  ┌──────────┴───────────┐  ┌──────────┴───────────┐                │
│  │ 5. Regression Gate   │  │ 6. Dashboard/Report  │                │
│  │ (CI/CD integration)  │  │ (HTML reports)       │                │
│  │                      │  │                      │                │
│  │ - GH Actions workflow│  │ - Historical trends  │                │
│  │ - Baseline capture   │  │ - Before/after diffs │                │
│  │ - Threshold gates    │  │ - Flame charts       │                │
│  │ - PR comments        │  │ - Device comparison  │                │
│  │ - Branch comparison  │  │ - Exportable (JSON)  │                │
│  └──────────────────────┘  └──────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### Component 1: SDK Performance Module

**Built into the HYTOPIA engine** as an opt-in module. Available to every game developer.

**Server-side additions:**
- `PerfProfiler` class (replaces need for Sentry): Local span tracking with configurable output (console, JSON file, Chrome Trace Event format). Zero-overhead when disabled (same pattern as Telemetry).
- `TickBudgetTracker`: Tracks percentage of 16.67ms budget consumed. Emits warnings when avg exceeds configurable threshold (default 80%). Exposes to SDK event system.
- `EntityCostTracker`: Optional per-entity timing via `entity.tick()` wrapping. Activated per-world with `world.enableEntityProfiling()`. Groups by entity type.
- `NetworkMetrics`: Aggregates bandwidth per player, packet rate, compression ratio, queue depths. Exposed via SDK event and optional protocol packet.
- `PerfTelemetryPacket` (new protocol packet): Server sends tick time, entity count, physics step time, network sync time to client every N ticks (configurable, default 10 = every 333ms).

**Client-side additions:**
- `FrameTimeBreakdown`: Splits frame time into render, JS, network deserialization, animation update, GC (via `PerformanceObserver` for longtask). Displayed in DebugPanel.
- `MemoryTrendTracker`: Rolling window of memory samples. Detects sustained growth (possible leak). Warns via console.
- `NetworkJitterTracker`: RTT variance calculation. Packet loss estimation (missed SyncResponses). Out-of-order detection via WorldTick sequence.
- `Stats classes upgrade`: Add rolling min/max/avg/p95 windows (last 60 seconds) to all Stats classes.

### Component 2: Benchmark Runner

**Standalone CLI tool** (`@hytopia.com/perf-bench`) that any game developer can install.

**Features:**
- Loads YAML scenario files defining test conditions (entity count, player count, world size, duration, metric thresholds)
- Starts game server with `AUTO_START_WITH_BOTS=true` or custom game init
- Spawns headless browser clients via Puppeteer
- Collects metrics from both server events and client CDP
- Compares against baseline JSON
- Outputs JSON results + HTML report

**Built-in scenarios (shipped with the tool):**
```yaml
# idle-server.yaml
name: Idle Server Baseline
duration: 60s
setup:
  world_size: default
  entities: 0
  players: 0
metrics:
  server_tick_avg: { max: 0.5ms }
  server_memory_mb: { max: 200 }

# entity-stress.yaml
name: Entity Stress Test
duration: 120s
setup:
  entities: [100, 500, 1000, 5000]
  ramp_interval: 30s
metrics:
  server_tick_avg: { max: 8ms }
  server_tick_p95: { max: 14ms }

# player-stress.yaml
name: Player Stress Test
duration: 120s
setup:
  headless_clients: [10, 25, 50, 100]
  ramp_interval: 30s
metrics:
  server_tick_avg: { max: 10ms }
  client_fps_avg: { min: 30 }
  network_rtt_p95: { max: 100ms }
```

### Component 3: Device Testing Pipeline

**Puppeteer/Playwright-based** headless game client automation.

**Capabilities:**
- Connect headless browser to game server (handling hytopia.com/play connection flow)
- Extract `renderer.info` stats via CDP
- Extract `PerformanceMetricsManager` data (FPS, memory)
- Capture Chrome DevTools traces programmatically
- Apply network throttling (3G, 4G, WiFi presets)
- Apply CPU throttling (2x, 4x, 6x)
- Apply device emulation (mobile screen sizes, touch, device scale factor)
- Multi-client spawning for stress tests
- Screenshot capture at configurable intervals

**Adapted from:** HyFire2 `test/headless-browser-automation` branch scripts, with WSL2 WebGL workarounds.

### Component 4: Trace Analyzer

**Python/Node scripts** for offline analysis of captured traces and profiles.

**Chrome DevTools Traces:**
- Long task detection (>50ms)
- Frame budget violation analysis (60fps and 30fps targets)
- Recurring blocker detection (3+ occurrences, impact scoring)
- Rendering breakdown (Layout, Paint, Composite)
- Game loop analysis (FunctionCall, EvaluateScript)

**V8 CPU Profiles:**
- Call tree construction with self/total time
- Hot function identification (top N by self time)
- Game vs SDK vs system categorization
- WASM function mapping (6,684 Rapier physics operations)
- Spike cascade analysis
- "Death by 1000 cuts" analysis (frequent low-cost functions)

**Output formats:** Markdown reports, interactive HTML flame charts, JSON data, CSV for spreadsheet analysis.

### Component 5: Regression Detector

**CI/CD integration** via GitHub Actions.

```yaml
# .github/workflows/perf-gate.yml
name: Performance Gate
on:
  pull_request:
    branches: [master]

jobs:
  perf-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: master
      - name: Capture baseline
        run: hytopia-perf-bench run scenarios/baseline.yaml --output baseline.json

      - uses: actions/checkout@v4
      - name: Capture PR metrics
        run: hytopia-perf-bench run scenarios/baseline.yaml --output pr.json

      - name: Compare
        run: hytopia-perf-bench compare baseline.json pr.json --threshold 10 --fail-on-regression

      - name: Comment PR
        if: always()
        run: hytopia-perf-bench report baseline.json pr.json --format github-comment | gh pr comment $PR_NUMBER --body-file -
```

### Component 6: Dashboard/Reporter

**Static HTML reports** generated from benchmark JSON results.

**Features:**
- Historical trend charts (tick time, FPS, memory over runs)
- Before/after comparison tables with color-coded deltas
- Interactive flame charts (from Chrome Trace Event data)
- Per-device comparison matrix
- Exportable raw JSON for custom analysis
- GitHub PR comment summary format

### Benchmark Scenarios

| Category | Scenario | Parameters | Key Metrics |
|----------|----------|-----------|-------------|
| Baseline | Idle server | 0 entities, 0 players | tick time, memory, event loop lag |
| Entity stress | Progressive entity load | 100, 500, 1000, 5000 entities | tick time, memory, GC frequency |
| Player stress | Progressive player load | 10, 25, 50, 100 headless clients | tick time, network sync time, bandwidth, RTT |
| Physics stress | Many dynamic bodies | 100, 500, 1000 physics bodies in motion | physics step time, simulation step ms |
| Network stress | High packet rate | 50 players, all moving, 30Hz updates | serialize time, send time, bandwidth per player |
| Chunk loading | Large world | 750x750 block area, player teleporting | chunk build time (worker), main thread stall |
| Particle stress | Many emitters | All effects simultaneously (smoke, HE, blood, etc.) | client FPS, draw calls, GPU time |
| Combined | Real-game simulation | 10v10 with bots, combat, grenades, bomb plant/defuse | all metrics simultaneously |
| Startup | Cold start to gameplay | Connect, load, render first frame | time-to-connected, time-to-first-packet, time-to-first-chunk, time-to-game-ready |
| Mobile | Device emulation | CPU throttle 4x, mobile viewport, touch input | client FPS, frame budget violations, quality auto-adjust behavior |

### Metrics to Capture

#### Server Metrics

| Metric | Source | Unit | Collection Rate |
|--------|--------|------|----------------|
| Tick time | WorldLoop TICK_END event | ms | Every tick (60Hz) |
| Physics step time | Simulation STEP_END event | ms | Every tick |
| Entity update time | New: EntityCostTracker | ms | Every tick (opt-in) |
| Network sync time | New: PerfProfiler span | ms | Every 2nd tick (30Hz) |
| Serialize time | New: PerfProfiler span | ms | Every sync |
| Send time per player | New: PerfProfiler span | ms | Every sync |
| Tick budget % | New: TickBudgetTracker | % | Every tick |
| Memory (heap) | process.memoryUsage() | MB | Every 1s |
| Memory (RSS) | process.memoryUsage() | MB | Every 1s |
| Entity count | EntityManager | count | Every 1s |
| Player count | PlayerManager | count | Every 1s |
| GC pauses | PerformanceObserver (if available) | ms | On GC event |
| Event loop lag | Interval jitter measurement | ms | Every 100ms |
| Bandwidth per player | New: NetworkMetrics | KB/s | Every 1s |
| Packet rate | New: NetworkMetrics | packets/s | Every 1s |
| Compression ratio | New: NetworkMetrics | ratio | Every sync |

#### Client Metrics

| Metric | Source | Unit | Collection Rate |
|--------|--------|------|----------------|
| FPS | PerformanceMetricsManager | fps | Every 1s |
| Frame time | PerformanceMetricsManager | ms | Every frame |
| Frame time breakdown | New: FrameTimeBreakdown | ms per component | Every frame |
| Draw calls | renderer.info.render.calls | count | Every frame |
| Triangles | renderer.info.render.triangles | count | Every frame |
| Geometries | renderer.info.memory.geometries | count | Every frame |
| Textures | renderer.info.memory.textures | count | Every frame |
| Shader programs | renderer.info.programs.length | count | Every frame |
| JS heap memory | performance.memory (Chrome) | MB | Every 1s |
| Entity count | EntityStats.count | count | Every frame |
| Visible entities | EntityStats.inViewDistanceCount | count | Every frame |
| Frustum-culled entities | EntityStats.frustumCulledCount | count | Every frame |
| Visible chunks | ChunkStats.visibleCount | count | Every frame |
| SceneUI count | SceneUIStats.count | count | Every frame |
| RTT | NetworkManager SyncResponse | ms | Every 2s |
| Jitter | New: NetworkJitterTracker | ms | Every 2s |
| GPU time | New: EXT_disjoint_timer_query | ms | Every frame (if available) |
| Quality preset | SettingsManager | enum | On change |

#### Network Metrics

| Metric | Source | Unit | Collection Rate |
|--------|--------|------|----------------|
| RTT | SyncRequest/SyncResponse | ms | Every 2s |
| RTT jitter | New: variance of RTT | ms | Every 2s |
| Packet rate (outbound) | New: NetworkMetrics | packets/s | Every 1s |
| Bandwidth (outbound) | New: NetworkMetrics | KB/s | Every 1s |
| Compression ratio | New: NetworkMetrics | ratio | Per compressed packet |
| Transport type | NetworkManager | ws/wt | On connect |
| Reliable vs unreliable split | New: NetworkMetrics | % | Every 1s |
| Missed SyncResponses | New: NetworkJitterTracker | count | Rolling window |

### Repeatability Requirements

1. **Deterministic bot scenarios:** Use seeded random for bot decisions. Record and replay action sequences. Fixed spawn positions.
2. **Bot-driven tests:** No human input required. Headless browser clients connect automatically, select team, and idle (or follow scripted actions).
3. **Scenario configuration via YAML/JSON:** All test parameters (entity count, duration, thresholds, bot behavior) defined in declarative files. No code changes needed per scenario.
4. **Baseline capture and comparison:** Every test run produces a JSON artifact. Compare any two runs with percentage-change calculations and configurable regression thresholds.
5. **Environment isolation:** Tests specify required server config (tick rate, physics params, network sync rate). Tests validate environment before running.
6. **Warmup period:** All scenarios include a configurable warmup period (default 10s) before metric collection begins, to exclude startup costs.

---

## Priority Implementation Roadmap

### Phase 1: Core Metrics (Weeks 1-3)

**Goal:** Every HYTOPIA game developer can see performance data during local development without Sentry.

**Tasks:**
1. **Add `PerfProfiler` to SDK server** -- Lightweight local span tracker. Same API as `Telemetry.startSpan()` but writes to console/file instead of Sentry. Enabled via `HYTOPIA_PERF=1` env var.
2. **Add `TickBudgetTracker` to SDK server** -- Wraps WorldLoop tick. Calculates budget percentage. Emits warning event when avg >80% over 5s window. Emits critical event when any tick >32ms (2x budget).
3. **Add `FrameTimeBreakdown` to SDK client** -- Uses `PerformanceObserver` for longtask, manual marks around render/network/animation phases. Adds 4 new Stats.js panels to DebugPanel.
4. **Add `PerfTelemetryPacket` to protocol** -- New outbound packet: `{ tickMs, entityCount, physicsMs, networkMs, memoryMb }`. Sent every 10 ticks. Client displays in DebugPanel.
5. **Upgrade Stats classes** -- Add rolling 60s windows with min/max/avg/p95 to all 6 Stats classes. Expose in DebugPanel.
6. **Extract HyFire2 tools** -- Pull `compare-baselines.ts`, `capture-baseline.sh`, `metrics-extractor.ts`, and `scenario-types.ts` from HyFire2 into a standalone `@hytopia.com/perf-tools` package. Make game-agnostic.

### Phase 2: Automation (Weeks 4-6)

**Goal:** Automated, repeatable performance tests that run without human interaction.

**Tasks:**
1. **Build benchmark runner CLI** -- `hytopia-perf-bench` command. Loads YAML scenarios, starts server, runs test, collects metrics, outputs JSON. Adapts from HyFire2 `benchmark-game.ts`.
2. **Merge and adapt headless browser scripts** -- Clean up HyFire2's Puppeteer scripts into a reusable `HeadlessGameClient` class. Handle connection flow, team selection, idle state.
3. **Implement 4 core scenarios** -- Idle baseline, entity stress (100/500/1000), player stress (10/25/50 headless clients), startup timing.
4. **CI/CD GitHub Actions workflow** -- Capture baseline on master, compare against PR. Block merge on >10% regression. Post comparison table as PR comment.
5. **Adapt FlameChartRecorder** -- Pull from HyFire2 `feature/add-game-performance-monitoring` branch. Make SDK-native (opt-in). Output Chrome Trace Event JSON.

### Phase 3: Cross-Device Testing (Weeks 7-9)

**Goal:** Automated performance testing across different device profiles.

**Tasks:**
1. **Device profile presets** -- YAML-defined profiles: desktop-high, desktop-low, mobile-flagship, mobile-midrange, tablet. Each specifies CPU throttle, viewport, network conditions.
2. **CDP metric collection** -- Automated extraction of `renderer.info`, `PerformanceMetricsManager` data, `performance.memory` from headless clients. Time-series collection over test duration.
3. **Chrome trace capture automation** -- Programmatic trace capture via CDP `Tracing` domain. Auto-analyze with Python scripts.
4. **Network condition simulation** -- Integrate Puppeteer CDP `Network.emulateNetworkConditions` with benchmark scenarios. Presets: perfect, broadband, 4G, 3G, lossy.
5. **HTML report generator** -- Comparative HTML report showing performance across device profiles. Trend charts, comparison matrix.

### Phase 4: Advanced (Weeks 10-12+)

**Goal:** Deep profiling capabilities for performance engineers.

**Tasks:**
1. **GPU timing** -- Implement `EXT_disjoint_timer_query_webgl2` in SDK client for actual GPU millisecond measurement. Add to FrameTimeBreakdown.
2. **Per-entity cost attribution** -- Optional wrapping of `entity.tick()` with per-entity-type aggregation. Exposed via PerfProfiler.
3. **Network bandwidth dashboard** -- Per-player bandwidth tracking, packet-rate monitoring, reliable/unreliable split visualization.
4. **Memory leak detection** -- Automated heap growth detection in client. Alert when JS heap grows >X MB/minute sustained over 5 minutes.
5. **Deterministic replay system** -- Record entity state + player inputs. Replay for exact A/B comparison. Seeded random for bot AI.
6. **WASM function mapping** -- Adapt HyFire2's `wasm-mappings-report.json` and `update-wasm-mappings.cjs` for SDK-level Rapier physics profiling. Auto-discover WASM functions from CPU profiles.
7. **Speedscope/Chrome Trace export from SDK** -- Native export from PerfProfiler to industry-standard formats. Research complete (HyFire2 `docs/performance-monitoring-ultrathink-analysis`), implementation estimated at 2-4 hours for Speedscope, 6-10 hours for Chrome Trace.

---

## Appendix: Branch Reference

### HyFire2 Performance Branches (Complete Inventory)

#### Analysis/Documentation Branches (11 branches)

| Branch | Status | Key Content | Research Doc |
|--------|--------|-------------|-------------|
| `docs-performance` | Unmerged | PERFORMANCE_GUIDE.md, benchmark-game.ts, profile-server-auto.ts, generate-flamegraph.ts | Doc 1 |
| `analysis/performance-monitoring-strategy` | Unmerged | 4-phase monitoring strategy, PerformanceLagDetector, Sentry dual-SDK, bottleneck analysis scripts | Doc 1 |
| `analysis/code-hotspots-metrics` | Unmerged | PERFORMANCE_FIX_ANALYSIS.md (5 hotspots with before/after code), bug pattern analysis | Doc 1 |
| `docs/performance-analysis-oct-5` | Unmerged | handleDeath 49.2% improvement analysis, grenade-death.yaml scenario | Doc 1 |
| `docs/performance-analysis-outputs` | Unmerged | CPU profile correlation (42,725 functions, 7.5M samples), dependency graph (219 records), baseline capture/compare scripts | Doc 1 |
| `docs/performance-automation-playbook` | Unmerged | Profiling-to-fix workflow docs, AI memory files for perf fixes | Doc 1 |
| `docs/performance-monitoring-ultrathink-analysis` | Unmerged | 93KB deep-dive: spike aggregation, tree filtering, Speedscope/Chrome Trace export research, monitoring overhead analysis (15.4%) | Doc 1 |
| `docs/performance-testing-infrastructure` | Unmerged | 1,244-line CI/CD roadmap (5 phases), GitHub Actions template | Doc 1, 6 |
| `docs/perf-hotspots-20251004` | Unmerged | Top 10 hotspot baseline (10-min profile), monitoring overhead quantified | Doc 1 |
| `docs/top-10-performance-analysis` | Unmerged | Real player session analysis (6,900 events), 9 PRs merged Oct 5 | Doc 1 |
| `analysis/performance-work-3mo` | Unmerged | 3-month retrospective, 63 curated PRs, 26 unmerged PR analysis | Doc 1 |

#### Feature/Monitoring Branches (18 branches)

| Branch | Status | Commits Ahead | Key Content | Research Doc |
|--------|--------|--------------|-------------|-------------|
| `feature/performance-monitoring` | **Merged** | 0 | PerformanceProfiler, profile-server-auto.ts | Doc 3 |
| `feature/performance-monitoring-system` | **Merged** | 0 | Early monitoring attempt | Doc 3 |
| `feature/performance-monitoring-ui` | Unmerged | 12 | PerformanceMetricsService, FunctionProfiler, SessionSpikeTracker, SystemProfiler, F9 client overlay | Doc 3 |
| `feature/performance-monitoring-improvements` | Unmerged | 29 | Enhanced FrameBudgetMonitor (hierarchy, self-time), flamechart export, performance context | Doc 3 |
| `feature/performance-monitoring-hybrid` | Unmerged | 2 | PerformanceLagDetector (CPU polling), PerformanceMonitoringConfig | Doc 3 |
| `feature/performance-monitoring-ui-merge-master` | Unmerged | 19 | Rebased monitoring UI | Doc 3 |
| `feature/add-game-performance-monitoring` | Unmerged | 44 | FlameChartRecorder, SpikeDetector v2, D3.js viewer, 12 scripts | Doc 3 |
| `feature/perf-monitoring-terrorist-approaches` | **Merged** | 0 | Deferred evaluation pattern (150-700x speedup) | Doc 3 |
| `feature/performance-analysis-tools` | Unmerged | 4 | Python CSV-to-Excel pipeline | Doc 3 |
| `feature/performance-analysis-combined` | Unmerged | 216 | 200+ function analyses, instrumentation guide, code fixes, validation | Doc 3 |
| `feature/performance-analysis-reports` | Unmerged | 187 | Per-function analysis reports (subset of combined) | Doc 3 |
| `feature/performance-optimizations` | **Merged** | 0 | Early optimization pass | Doc 3 |
| `feature/baseline-lag-optimization` | Unmerged | 4 | Mobile frame skipping, viewmodel bob disable | Doc 3 |
| `feature/comprehensive-mobile-performance` | **Merged** | 0 | Blood particles, A14 analysis, periodic ops audit | Doc 3 |
| `feature/mobile-performance-analysis` | Unmerged | 4 | 3 Python trace analyzers | Doc 3 |
| `feature/investigate-mobile-viewmodel-performance` | **Merged** | 0 | Ambient-only lighting on mobile | Doc 3 |
| `feature/particle-stress-tester` | Unmerged | 16 | ParticleStressTester (8 scenarios), F2 menu | Doc 3 |
| `feature/bot-cover-micro-profiler` | Unmerged | 5 | Prototype patching profiler, Symbol guard, env-var gating | Doc 3 |

#### perf/* Branches (13 merged + 4 open)

| Branch | Status | PR # | Key Optimization | Impact | Research Doc |
|--------|--------|------|-----------------|--------|-------------|
| `perf/cache-sceneui-takedamage` | **Merged** | #1446 | Cache SceneUI array per player | Death: 50% faster | Doc 4 |
| `perf/stopping-power-optimization` | **Merged** | #1451 | Cache require(), early exit on empty | 93% faster | Doc 4 |
| `perf/reduce-weapon-fire-spike` | **Merged** | #1457 | setTimeout projectile creation, throttle recoil UI | 35% faster | Doc 4 |
| `perf/reduce-bot-combat-spike` | **Merged** | #1458 | RaycastCacheService (bidirectional) | 39% raycast reduction | Doc 4 |
| `perf/fix-damage-ui-spikes` | **Merged** | #1462 | Defer audio/blood/damage-direction UI | Spike elimination | Doc 4 |
| `perf/optimize-death-visibility-check` | **Merged** | #1463 | Defer physics updates on death | 99.6% faster | Doc 4 |
| `perf/investigate-weapon-drop` | **Merged** | #1465 | Sequential-deferred item drops | 42.8% faster | Doc 4 |
| `perf/optimize-mvp-tracking` | **Merged** | #1469 | Defer MVP tracking, string prefix bot check | 93% faster | Doc 4 |
| `perf/remove-damage-debug-logging` | **Merged** | #1470 | Remove debug logging from damage path | 90% overhead eliminated | Doc 4 |
| `perf/rate-limit-bot-navigator-warnings` | **Merged** | #1471 | 5s rate limit on per-tick warnings | Log spam eliminated | Doc 4 |
| `perf/remove-grenade-logging-overhead` | **Merged** | #1515 | Remove verbose grenade attack logging | 44 lines removed | Doc 4 |
| `perf/optimize-recoil-offset-calls` | **Merged** | #1255 | Frame-duration recoil cache | Multi-call -> once | Doc 4 |
| `perf/web-audio-kill-sounds` | **Merged** | #1678 | Web Audio API replaces HTML5 Audio | 5-20ms vs 100-200ms latency | Doc 4 |
| `perf/add-bot-combat-instrumentation` | Open | - | Instrumentation only (no optimization) | N/A | Doc 4 |
| `perf/bomb-retrieval-optimization` | Open | - | Fire-and-forget logging, squared distance | Unquantified | Doc 4 |
| `perf/optimize-bot-updates` | Open | - | Set-based lookups, extended caches | O(n^2) -> O(1) | Doc 4 |
| `perf/optimize-logging-overhead` | Open | - | Env-gated logging, EventLogger early exit | Unquantified | Doc 4 |

#### fix/* Performance Branches (3 open)

| Branch | Status | Key Content | Research Doc |
|--------|--------|-------------|-------------|
| `fix/10v10-performance-analysis` | Open | DistanceCullingService, OptimizedBroadcastService, tiered update rates | Doc 4 |
| `fix/teammate-ui-performance-lag` | Open | Screen-space UI replacing n^2 SceneUI nametags | Doc 4 |
| `fix/memory-optimizations` | Open | PathfindingCache pool, PlayerCache singleton, readonly array returns | Doc 4 |

#### Testing/Infrastructure Branches

| Branch | Status | Key Content | Research Doc |
|--------|--------|-------------|-------------|
| `test/headless-browser-automation` | Unmerged | 6 Puppeteer scripts for WSL2 | Doc 6 |
| `test/arm64-simulation` | Unmerged | Docker ARM64 emulation | Doc 6 |
| `sentry-testing` | Unmerged | SentryTelemetryService (1,593 lines) | Doc 6 |
| `investigation/perf-monitoring-analysis` | Unmerged | CPU profile analysis (6 scripts, WASM mapping) | Doc 6 |
| `feature/mobile-debug-ui` | Unmerged | Mobile controls debug (F8 overlay) | Doc 6 |
| `feature/sentry-telemetry` | Unmerged | Earlier Sentry attempt | Doc 6 |
| `feature/sentry-review` | Unmerged | Sentry usage guide | Doc 6 |

### Summary Statistics

- **Total performance branches analyzed:** 58+
- **Total performance PRs (curated):** 63
- **Merged to master:** 17 branches (13 perf/* + 4 feature/*)
- **Unmerged (valuable):** 26+ branches
- **Estimated total development time:** 300+ hours
- **Overall improvement:** Average game tick from 10ms+ to 1.11ms (89% reduction)
- **Frame budget utilization:** ~6.7% of 16.67ms budget (down from 60%+)
- **Unique instrumentation points:** 82 frameBudgetMonitor.measure() calls
- **Peak sprint:** 9 PRs merged on October 5, 2025
