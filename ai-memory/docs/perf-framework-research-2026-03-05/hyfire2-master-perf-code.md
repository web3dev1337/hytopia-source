# HyFire2 Master Branch - Performance Code Inventory

Comprehensive inventory of ALL performance monitoring, profiling, benchmarking, and optimization code found on the `master` branch of `~/GitHub/games/hyfire2` as of 2026-03-05.

---

## 1. Core Profiling System (`src/profiling/`)

### 1.1 `src/profiling/PerformanceManager.ts`
**What it does:** Comprehensive performance monitoring singleton with spike detection, auto-profiling, memory monitoring, and report generation.

**Key techniques:**
- `process.hrtime.bigint()` for high-precision timing
- Spike detection: any operation exceeding configurable threshold (default 50ms) triggers alerts
- Auto CPU profiling on spike via `InspectorCpuProfiler` (5s capture, 30s cooldown)
- Heap snapshots via `v8.writeHeapSnapshot()` when memory exceeds 800MB
- Event loop lag detection (interval-based)
- Signal handlers: `SIGUSR1` = toggle CPU profiling, `SIGUSR2` = generate report
- Operation stats: count, total, avg, max, min, spike count, recent history (last 100)

**Current state:** Event loop monitoring and periodic reporting are **DISABLED** (commented out) because they were causing performance overhead and memory issues themselves. The core operation timing and spike detection remain active.

**Key metrics:** operation duration (ms), spike count, heap used/total/RSS, event loop lag, hot paths (top by total time), spiky operations (top by spike count)

**How to run:** Imported as singleton in `index.ts`. Configured at startup with `performanceManager.configure({...})`.

**Dependencies:** `node:inspector`, `node:v8`, `node:fs`, `InspectorCpuProfiler`, `EventLogger`

### 1.2 `src/profiling/InspectorCpuProfiler.ts`
**What it does:** Wraps the Node.js Inspector API (`Profiler` domain) to capture V8 CPU profiles.

**Key techniques:**
- `inspector.Session` + `Profiler.enable` / `Profiler.start` / `Profiler.stop`
- Profile output as `.cpuprofile` JSON (Chrome DevTools compatible)
- `profileForMilliseconds(duration, outputPath)` for timed captures
- Signal-based profiling: `installSignalHandlers()` listens on configurable signals

**How to run:** Used by PerformanceManager for auto-profiling. Can also be used standalone via signals or direct API.

**Output:** `.cpuprofile` files in `./profiles/` directory

### 1.3 `src/profiling/decorators.ts`
**What it does:** TypeScript decorators for zero-effort performance instrumentation.

**Key techniques:**
- `@Monitor(captureStack?)` - method decorator, wraps sync/async methods in `performanceManager.measure()`
- `@MonitorClass(captureStack?)` - class decorator, monitors ALL methods
- `monitorBlock(name, fn, captureStack?)` - inline sync block measurement
- `monitorAsyncBlock(name, fn, captureStack?)` - inline async block measurement
- Auto-detects async vs sync methods via `constructor.name === 'AsyncFunction'`

**How to run:** Import decorator, apply to class or method. Operation name auto-generated as `ClassName.methodName`.

---

## 2. Utility Performance Monitors (`src/utils/`)

### 2.1 `src/utils/PerformanceMonitor.ts`
**What it does:** Second performance monitoring singleton focused on sampling-based metrics collection with percentile calculations.

**Key techniques:**
- `process.hrtime.bigint()` for timing
- Percentile calculations: p50, p95, p99
- Memory tracking: heap used/total, RSS, external
- CPU approximation (Bun lacks `process.cpuUsage`)
- Event loop lag via interval jitter
- Auto-sampling at configurable interval (default 1s)
- Metrics history with configurable retention (default 600 samples = 10 min)

**Current state:** Sampling is **DISABLED** in constructor (was causing memory overhead with no benefit). Timing storage also **DISABLED** (unbounded memory growth causing OOM). The `startTiming`/`endTiming` API still works but doesn't store history.

**Key metrics:** memory (heapUsed, heapTotal, RSS, external in MB), CPU (user, system), event loop (lag, avgLag), per-operation timing stats (count, total, avg, min, max, p50, p95, p99)

### 2.2 `src/utils/PerformanceProfiler.ts`
**What it does:** Manual call stack profiler for flame graph generation.

**Key techniques:**
- Manual call stack tracking with `enter(name)` / `exit(name)`
- Tree-based profile data structure (ProfileNode with self time, total time, children)
- Statistical sampling: takes stack samples at configurable interval (default 1ms)
- `wrap(name, fn)` - wraps a function for automatic profiling
- Export to collapsed stack format (Brendan Gregg format) for flame graph generation
- Human-readable report with top functions by total time

**How to run:** `profiler.enable()` then use `profiler.profile(name, fn)` or `profiler.enter()`/`profiler.exit()`. Generate output with `profiler.generateCollapsedStacks()` or `profiler.saveProfile(path)`.

### 2.3 `src/utils/FrameBudgetMonitor.ts`
**What it does:** Tracks frame budget violations against 60 FPS target (16.66ms).

**Key techniques:**
- Frame-level tracking: `startFrame()` / `endFrame()` with per-operation breakdown
- Spike threshold: 8ms (operations > 8ms tracked as concerning)
- Tracks worst frame ever, top offenders, recent spikes (last 50)
- Per-operation stats: name, duration, percent of budget
- `measure(name, fn)` for inline operation tracking

**Current state:** Frame budget console logging is **DISABLED** (was causing performance overhead). Stats collection still active.

**Key metrics:** total frames, frames over budget, percent over budget, worst frame (total duration + operation breakdown), top offenders (name, count, max, avg), recent spikes (operation, duration, % of budget)

**Active usage:** Heavily used in `BotBrain.ts` - every bot decision path is wrapped in `frameBudgetMonitor.measure()` calls with per-bot naming (e.g., `brain.bombDetection.Alpha`, `brain.terroristStrategy.Zulu`).

### 2.4 `src/utils/ClientPerformanceReporter.ts`
**What it does:** Server-side aggregator for client-side FPS reports.

**Key techniques:**
- Receives `ClientPerformanceReport` from game clients (fps, frameTime, memory, performance tier)
- Per-player metric tracking with history (default 300 samples = 5 min at 1 report/sec)
- Issue detection: low FPS (<30), high frame time (>50ms), critical FPS (<20), high memory (>1GB)
- Running averages per player
- Periodic summary logging every 60 seconds
- Persistent issue detection: flags players with >30% problematic reports
- Performance tier classification: excellent/good/fair/poor/critical

**Key metrics:** per-player FPS avg, frame time avg, memory avg, issue counts (lowFps, highFrameTime, criticalEvents), global summary (total players, players with issues, critical players, average FPS, lowest FPS player)

### 2.5 `src/utils/ZoneVisibilityMonitor.ts`
**What it does:** Monitors zone visibility optimization performance (raycast skip rate).

**Key techniques:**
- Periodic reporting at configurable interval (default 30s)
- Tracks checks skipped vs performed via `ZoneVisibilityService`
- Calculates estimated time saved (4ms per skipped raycast)
- Uses EventLogger for structured output

**Key metrics:** checksSkipped, checksPerformed, skipRate, estimatedTimeSavedMs

### 2.6 `src/utils/NameplateOptimizationConfig.ts`
**What it does:** Configuration constants for nameplate rendering optimization.

**Key values:**
- MAX_VISIBLE_NAMEPLATES: 32
- MAX_NAMEPLATE_DISTANCE: 75
- CLOSE_RANGE_DISTANCE: 30
- Update intervals: close 100ms, medium 250ms, far 500ms
- Feature flags: pooling, distance culling, batched updates, LOD

---

## 3. Debug Systems

### 3.1 `src/config/DebugUIConfig.ts` + `src/config/debugUIConfigData.ts`
**What it does:** Centralized debug UI configuration with cached flag lookups.

**Perf-relevant flags:**
- `scene_debug_ui.show_performance_metrics` (default: false)
- `development.performance_profiling` (default: false)
- `development.verbose_logging` (default: false)
- `player_debug_ui.show_fps` / `show_ping` (default: false)

**Perf optimization:** Flag values cached in static fields to avoid function call overhead (100+ calls/sec with 10 bots).

### 3.2 `src/commands/DebugCommands.ts`
**What it does:** In-game debug command handler (admin/dev only).

**Perf-relevant:** Bot debug UI toggle (shows names, roles, actions). Uses cached config flags for gate checks.

### 3.3 `src/debug/AudioDebugConfig.ts`
**What it does:** Audio parameter tuning config singleton.

**Perf-relevant:** Controls distance-based audio culling parameters (reference/cutoff distances).

### 3.4 `src/entities/bot/debug/BotDebugUI.ts` + `BotDecisionTracer.ts`
**What it does:** Bot state visualization and decision tracing.

### 3.5 `src/managers/GrenadeDebugManager.ts`
**What it does:** Debug visualization for grenade trajectories.

### 3.6 `src/navigation/ZoneDebugManager.ts` + `ZoneDebugVisualizer.ts`
**What it does:** Navigation zone debug visualization.

---

## 4. Performance Scripts (`scripts/`)

### 4.1 `scripts/benchmark-game.ts`
**What it does:** Automated game performance benchmarking.

**How to run:**
```bash
bun scripts/benchmark-game.ts [-d duration] [-s scenario] [-o output.json]
# npm run benchmark / benchmark:quick / benchmark:full
```

**Scenarios:** idle, 5v5_combat, 10v10_full, stress_test

**Techniques:** Starts game server, measures tick times, memory, event loop lag per scenario. Reports avg/max tick time, memory, operation timings (bot.decision, pathfinding, combat.damage, network.send).

**Dependencies:** PerformanceMonitor, PerformanceProfiler, game server

### 4.2 `scripts/profile-server-auto.ts`
**What it does:** Auto-saving real-time performance dashboard for WSL/non-interactive terminals.

**How to run:**
```bash
npm run profile:auto
# or: bun scripts/profile-server-auto.ts
```

**Techniques:**
- ANSI-colored terminal dashboard (refreshes every 1s)
- Auto-saves reports every 30s to `performance-reports/`
- Frame budget status with color coding (green/yellow/red)
- Worst frame breakdown with top operations
- Performance bar visualization
- Final comprehensive report on SIGINT (Ctrl+C)
- Saves JSON stats, text frame budget report, and performance summary

**Dependencies:** PerformanceMonitor, PerformanceProfiler, FrameBudgetMonitor

### 4.3 `scripts/analyze-performance.cjs`
**What it does:** Analyzes `.cpuprofile` files and generates human-readable reports.

**How to run:**
```bash
node scripts/analyze-performance.cjs <profile.cpuprofile>
```

**Techniques:** Builds call tree from V8 profile nodes, calculates self/total times, identifies hot functions (top 20 by self time, top 10 by total time), analyzes V8 engine overhead, flags slow functions (>50ms), identifies hot game paths (BotBrain, GameManager, RoundSystem, Navigation).

### 4.4 `scripts/analyze-full-profile.cjs`
**What it does:** Complete CPU profile analysis showing top 100 functions.

**How to run:**
```bash
node scripts/analyze-full-profile.cjs <profile.cpuprofile>
```

**Techniques:** Categorizes functions as game code vs system/SDK, shows coverage percentage.

### 4.5 `scripts/map-profile-to-code.cjs`
**What it does:** Maps V8 CPU profile functions back to game source code.

**How to run:**
```bash
node scripts/map-profile-to-code.cjs <profile.cpuprofile>
```

**Techniques:** Reads `CODEBASE_REF.md` to identify game functions, categorizes profile entries as YOUR CODE vs HYTOPIA SERVER vs UNKNOWN. Shows per-tick time contribution. Clusters unknown functions by line number ranges to identify game systems.

### 4.6 `scripts/extract-game-performance.cjs`
**What it does:** Extracts game-specific functions from CPU profiles using CODEBASE_REF.md mapping.

**How to run:**
```bash
node scripts/extract-game-performance.cjs <profile.cpuprofile>
```

### 4.7 `scripts/generate-flamegraph.ts`
**What it does:** Generates interactive HTML flame graphs from collapsed stack format.

**How to run:**
```bash
bun scripts/generate-flamegraph.ts <input.collapsed> [output.html]
# npm run flamegraph
```

**Techniques:** Parses collapsed stack format, builds tree structure, generates self-contained HTML with SVG visualization, click-to-zoom, search, tooltips. Color-coded by function name hash.

### 4.8 `scripts/generate-flame-chart.cjs`
**What it does:** Generates text-based and HTML flame charts from performance-reports JSON stats.

**How to run:**
```bash
node scripts/generate-flame-chart.cjs
```

**Techniques:** Reads latest `performance-reports/stats-*.json`, creates ASCII flame chart for terminal and HTML visualization with color-coded bars (hot/warm/cool by duration).

### 4.9 `scripts/visualize-perf.js`
**What it does:** ASCII performance visualization and timing breakdown from stats JSON.

**How to run:**
```bash
node scripts/visualize-perf.js
```

**Techniques:** Reads latest stats file, sorts by P99 latency, ASCII bar charts for avg/p99, cumulative time analysis, frame budget violation summary.

### 4.10 `scripts/capture-baseline.sh`
**What it does:** Captures performance baseline by running the server with bots for a configurable duration.

**How to run:**
```bash
./scripts/capture-baseline.sh [duration_seconds] [output_file]
# npm run perf:baseline
# Default: 300s (5 minutes), output to baseline.json
```

**Techniques:** Starts server with `AUTO_START_WITH_BOTS=true`, extracts `perf.*` events from game.log, calculates per-operation stats (avg, min, max, p50, p95, p99), saves as JSON.

### 4.11 `scripts/compare-baselines.ts`
**What it does:** Compares two performance baselines to detect regressions or improvements.

**How to run:**
```bash
node scripts/compare-baselines.ts <before.json> <after.json> [threshold%]
# npm run perf:compare before.json after.json 10
```

**Techniques:** Compares avg/max/p95 for each operation, calculates percentage change, classifies as improved (>5% better), regressed (>5% worse), or stable. Exit code 1 on regression. Optional improvement threshold gate.

### 4.12 `scripts/analyze-bottleneck.js`
**What it does:** Analyzes a specific worst-frame JSON snapshot to identify bottlenecks.

**How to run:**
```bash
node scripts/analyze-bottleneck.js
```

**Techniques:** Groups operations by name, sorts by total time, creates ASCII bar chart, breaks down combat system specifically, identifies anomalies (e.g., specific bot's bomb detection taking 22ms).

### 4.13 `scripts/add-granular-perf-tracking.sh`
**What it does:** Identifies gaps in performance instrumentation.

**How to run:**
```bash
bash scripts/add-granular-perf-tracking.sh
```

**Techniques:** Greps source for `frameBudgetMonitor.measure()` calls, identifies methods with >5ms spikes that lack internal instrumentation, recommends specific measurement points.

### 4.14 `scripts/analyze-entity-lookups.sh`
**What it does:** Audits inefficient entity lookup patterns.

**How to run:**
```bash
bash scripts/analyze-entity-lookups.sh
```

**Techniques:** Counts `getAllEntities()`, `getAllPlayerEntities()`, `getEntitiesByTag()` calls across codebase, identifies bomb/player lookups that could use tags, suggests optimization phases.

### 4.15 `scripts/analyze-latest-session.ts`
**What it does:** Analyzes performance metrics from the latest game session log.

**How to run:**
```bash
bun scripts/analyze-latest-session.ts
```

**Techniques:** Extracts all `perf.*` events from `logs/latest/game.log`, calculates stats per operation (count, mean, median, min, max, p25, p75, p90, p95, p99).

### 4.16 `scripts/comprehensive-analysis.cjs`
**What it does:** Analyzes replay files for tactical anomalies (bomb abandonment, CT defuse failures, terrorist no-plant rounds).

**Perf-relevant:** Processes compressed replay data (gzip JSON), not primarily performance but relates to game quality analysis.

---

## 5. Performance Testing Framework

### 5.1 `scripts/test-grenade-spike.ts`
**What it does:** Automated performance regression test for grenade drop death spike.

**How to run:**
```bash
PORT=8081 npm run perf:test:grenade
```

**Techniques:**
- Starts server with test hooks
- Spawns headless browser player via Puppeteer
- Buys 4 grenades, triggers death
- Extracts `perf.handleDeath` metrics from logs
- Validates against thresholds: total <50ms, weapon drop <25ms

**Dependencies:** Puppeteer, HeadlessPlayer, ServerController, MetricsExtractor

### 5.2 `scripts/test-grenade-performance.sh`
**What it does:** Long-running grenade performance test (3 minutes).

**How to run:**
```bash
bash scripts/test-grenade-performance.sh
```

**Techniques:** Starts server with bots for 180s, analyzes death events from logs with Python, calculates avg/min/max/p95, validates thresholds.

### 5.3 `scripts/lib/headless-player.ts`
**What it does:** Puppeteer-based headless browser player for automated testing.

**Key API:** `connect(address)`, `selectTeam()`, `buyGrenades()`, `executeCommand()`, `screenshot()`, `getPosition()`, `isAlive()`

**Dependencies:** puppeteer (devDependency)

### 5.4 `scripts/lib/server-controller.ts`
**What it does:** Server lifecycle management for testing.

**Key API:** `startServer(options)`, `stopServer(server)`, workspace port mapping (work1=8081, work2=8082, work3=8083)

### 5.5 `scripts/lib/metrics-extractor.ts`
**What it does:** Extracts and calculates statistics from structured log files.

**Key API:** `extractMetrics(logPath, options)`, `calculateStats(metrics)`, `formatStats(stats)`

**Techniques:** Parses NDJSON log lines, filters by `perf.*` events, calculates count/avg/min/max/p50/p95/p99.

### 5.6 `scripts/lib/scenario-types.ts`
**What it does:** TypeScript type definitions for YAML-based test scenarios.

**Key types:** Scenario, ScenarioAction, ThresholdConfig, ScenarioResult, OperationResult

### 5.7 `scenarios/grenade-death.yaml`
**What it does:** Declarative performance test scenario for grenade death spike.

**Thresholds:**
- `perf.handleDeath`: avg <20ms, max <50ms, p95 <35ms
- `perf.weaponDrop`: avg <12ms, max <25ms, p95 <20ms
- Min 5 samples required, failure action: report_and_exit

---

## 6. Python Analysis Tools (Root)

### 6.1 `analyze-frame-budget.py`
**What it does:** Analyzes Chrome trace files for frame budget violations.

**How to run:**
```bash
python3 analyze-frame-budget.py [trace-file.json]
```

**Techniques:**
- Parses Chrome trace events (ph='X' complete events with duration)
- Per-call cost analysis (not cumulative) with >16ms threshold
- Frame budget violation counting (60fps and 30fps targets)
- Weapon animation deep dive
- JavaScript game loop analysis (FunctionCall, EvaluateScript events)
- Generates `FRAME_BUDGET_ANALYSIS.md` report

### 6.2 `analyze-recurring-blockers.py`
**What it does:** Finds RECURRING frame blockers during gameplay (excludes startup, one-offs).

**How to run:**
```bash
python3 analyze-recurring-blockers.py [trace-file.json]
```

**Techniques:**
- Filters to gameplay only (skips first 5 seconds)
- Requires 3+ occurrences to qualify as "recurring"
- Impact score: frequency x average duration
- Animation frame pattern analysis (degradation over time detection)
- Periodic spike detection (checks for regular cadence)
- Full data dump with per-operation histograms
- Generates `RECURRING_BLOCKERS_FULL_DATA.md` and `recurring_blockers_raw_data.json`

---

## 7. Package.json Performance Scripts

```
start:profile     - node --cpu-prof --cpu-prof-dir=./profiles index.js
start:profile:inspect - node --inspect index.js
profile:server    - node scripts/profile-server.ts
profile:enhanced  - node scripts/profile-server-improved.ts
profile:auto      - node scripts/profile-server-auto.ts
benchmark         - bun scripts/benchmark-game.ts
benchmark:quick   - bun scripts/benchmark-game.ts -d 10
benchmark:full    - bun scripts/benchmark-game.ts -d 60 -o benchmark-results.json
flamegraph        - node scripts/generate-flamegraph.ts
perf:analyze      - ls + tail logs/latest/performance.log
perf:test:grenade - npx ts-node scripts/test-grenade-spike.ts
perf:baseline     - ./scripts/capture-baseline.sh
perf:compare      - npx ts-node scripts/compare-baselines.ts
```

---

## 8. In-Game Performance Instrumentation

### 8.1 `src/entities/bot/BotBrain.ts` - Frame Budget Instrumentation
**~30 `frameBudgetMonitor.measure()` calls** wrapping every bot decision path:
- `brain.getRoundState.{botName}`, `brain.buyPhase.{botName}`
- `brain.bombDetection.{botName}`, `brain.terroristStrategy.{botName}`
- `brain.ctRetake.{botName}`, `brain.ctRotation.{botName}`
- `brain.combatCheck.{botName}`, `brain.defaultBehavior.{botName}`
- `brain.bombRetrievalCheck.{botName}`, `brain.getNavigator.{botName}`
- `brain.bombCarrierExecute.{botName}`, `brain.supportExecute.{botName}`
- `bombDetect.getEntities.{botName}`, `bombDetect.loop.{botName}`
- `bombDetect.checkPlanted.{botName}`, `bombDetect.getPos.{botName}`

### 8.2 `src/entities/GamePlayerEntity.ts` - Inline `performance.now()` Timing
**~50 `performance.now()` calls** with checkpoint tracking for:
- `handleDeath()` - comprehensive checkpoints: logging, healthCalc, nametag, mvpTracking, sourceTracking, audioAndEffects, healthUI, damageEffectUI, total
- Death item drops: botCacheInvalidate, audioCleanup, deathEffects, bombCancellation, broadcast, uiNotify, bombDrop, kitDrop, weaponDrop, deathEvent, inputCleanup, visibilityCheck
- Nameplate updates: timing for search, update operations
- Performance data logged via EventLogger as `perf.handleDeath` with checkpoint data

### 8.3 `src/entities/bot/combat/BotCombatSystem.ts` - Raycast Timing
**Inline `performance.now()`** around physics raycasts with duration logging when >5ms.

### 8.4 `src/managers/AudioManager.ts` - Audio Timing
**Inline `performance.now()`** for audio operation timing.

---

## 9. Tools (`tools/`)

### 9.1 `tools/replay-viewer/`
**What it does:** Browser-based 2D/3D replay viewer with analysis tools.

**Perf-relevant components:**
- `js/AnalysisTools.js` - Analysis tools for replay data
- `js/BotAnomalyDetector.js` - Detects anomalous bot behavior
- `js/BotInspector.js` - Bot state inspection

### 9.2 `src/tools/VisibilityDataCollector.ts`
**What it does:** Collects zone visibility data during gameplay to build visibility matrix.

**Perf-relevant:** Runs raycasts during gameplay (rate-limited to `testsPerTick=50`), used to pre-compute zone visibility for optimization.

---

## 10. Analysis Documents on Master

### Root-level performance analysis docs:
- `CONSOLE_PERFORMANCE_ANALYSIS.md` - Console.log performance impact on low-end devices
- `FINAL_OPTIMIZATIONS_SUMMARY.md` - Summary of all optimizations applied
- `FRAME_SKIPPING_ANALYSIS.md` - Frame skipping patterns analysis
- `PERIODIC_STUTTER_ANALYSIS.md` - Periodic stutter investigation
- `PER_FRAME_BUDGET_KILLERS.md` - Per-frame analysis of budget violations
- `ALL_LAG_SOURCES_ACTION_PLAN.md` - Comprehensive lag source action plan
- `BASELINE_LAG_NEXT_STEPS.md` - Post-baseline lag reduction plan
- `COMPLETE_INTERVAL_AUDIT.md` - Audit of all setInterval/setTimeout calls
- `FINAL_CLIENT_SIDE_ISSUES.md` - Client-side performance issues
- `MOBILE_A14_COMPLETE_BREAKDOWN.md` - iPhone A14 performance breakdown
- `MOBILE_A14_VS_PC_6X_COMPARISON.md` - Mobile vs PC performance comparison
- `MOBILE_VIEWMODEL_PERFORMANCE_ANALYSIS.md` - Viewmodel renderer analysis
- `RECURRING_BLOCKERS_FULL_DATA.md` - Full recurring blocker data
- `WHATS_FIXED_ON_MASTER.md` - Summary of performance fixes on master
- `CLEANUP_ANALYSIS.md` - Code cleanup analysis

### Docs directory guides:
- `docs/01-guides/performance-optimization-guide.md` - Top 10 bottlenecks, monitoring setup, root cause analysis
- `docs/01-guides/performance-testing-guide.md` - Complete testing workflow: server hooks, headless testing, baseline comparison

### AI Memory performance folders:
- `ai-memory/feature/performance-monitoring-system-*` (4 instances: 1ead992, 4c5ae85, 695757e, 70b1968)
- `ai-memory/feature/performance-optimizations-5ac318d/`

---

## 11. Saved Profile Data

### `profiles/human-perf-20251011.log`
**What it is:** Server log from a human performance testing session on 2025-10-11.

**Content:** Full server startup + gameplay log including performance monitoring initialization message:
```
system.performance : Performance monitoring ENABLED
  mode: automatic
  spikeThreshold: 30ms
  autoProfile: on spikes
  reportInterval: 60s
  outputDir: ./profiles
```

### `mobile-a14-trace.json`
**What it is:** Chrome trace file from an iPhone A14 device (used by `analyze-frame-budget.py` and `analyze-recurring-blockers.py`).

---

## 12. Build-Time Optimization

### `build-production-mode.sh`
**What it does:** Production build pipeline that strips all dev/profiling artifacts.

**Perf-relevant removals:**
- Removes `performance-reports/`, `profiles/`, `scripts/`, `tools/`, `docs/`
- Removes all `.md` files, test files, dev configs
- Smart asset cleanup: removes unused audio/models/textures
- Creates mode-specific builds (casual vs deathmatch)

### `scripts/optimize-map.js`
**What it does:** Removes interior blocks from the voxel map that are completely surrounded on all 6 sides.

**Perf impact:** Reduces memory and processing for blocks never visible to players.

### `.optimized/models/`
**What it is:** Pre-optimized GLTF model cache (regenerated with each SDK version).

---

## 13. Performance-Related Configuration

### `.env.example`
Only contains HYTOPIA API keys. No perf-specific env vars listed, but the codebase uses:
- `AUTO_START_WITH_BOTS` - Start with AI bots (for baseline capture)
- `ENABLE_TEST_HOOKS` - Enable test commands (for perf testing)
- `PORT` - Server port (workspace-specific)
- `NODE_ENV` - production/development

### `index.ts` (entry point)
PerformanceManager configured at startup:
```typescript
performanceManager.configure({
  spikeThresholdMs: 30,        // 30ms spike threshold
  autoProfileOnSpike: true,
  profileDurationMs: 5000,
  memorySnapshotThreshold: 800,
  eventLoopLagThreshold: 100,
  reportIntervalMs: 60000,
});
```

Periodic report generation (5-minute interval) is **DISABLED** in recent commits.

---

## 14. Perf-Related Git Commit History (Recent)

Key commits on master showing performance work:
- `932afe8c0` - perf: disable 5-minute periodic profiling interval
- `43b7d6c7a` - perf: fully disable silent PerformanceMonitor overhead
- `b6fc8934c` - perf: disable heavy performance monitoring that caused OOM crashes
- `91972d37d` - perf: use Web Audio API for low-latency kill sounds
- `4d6e2a1f6` - perf: remove 2 critical console.log calls from flashbang handler
- `d53c88039` - perf: remove 61 commented console statements from index.html
- `f7ad73521` - perf: optimize FFA scoreboard updates to reduce lag
- `dc9666220` - perf: use only ambient lighting on mobile for weapon view model
- `a805ef353` - perf: implement comprehensive mobile view model optimizations
- `1d264e14d` - perf: optimize tutorial animation size and timing
- `9f77e2c6f` - perf: refactor deathmatch podium for mobile performance
- `53fb8fe47` - perf: optimize EventLogger to skip work for filtered logs

---

## 15. Summary of Techniques Used

| Technique | Files |
|-----------|-------|
| `process.hrtime.bigint()` | PerformanceManager, PerformanceMonitor, PerformanceProfiler |
| `performance.now()` | GamePlayerEntity, BotCombatSystem, AudioManager, FrameBudgetMonitor |
| V8 Inspector CPU profiling | InspectorCpuProfiler, PerformanceManager |
| V8 heap snapshots | PerformanceManager |
| Chrome trace analysis | analyze-frame-budget.py, analyze-recurring-blockers.py |
| Flame graph generation | generate-flamegraph.ts, generate-flame-chart.cjs |
| Signal-based profiling (SIGUSR1/2) | InspectorCpuProfiler, PerformanceManager |
| Decorator instrumentation | profiling/decorators.ts |
| Frame budget tracking | FrameBudgetMonitor, BotBrain |
| Percentile calculations | PerformanceMonitor, metrics-extractor |
| Baseline comparison | capture-baseline.sh, compare-baselines.ts |
| Headless browser testing | headless-player.ts (Puppeteer) |
| YAML test scenarios | scenarios/grenade-death.yaml |
| Event loop lag detection | PerformanceManager, PerformanceMonitor |
| Memory monitoring | PerformanceManager, PerformanceMonitor |
| Entity lookup auditing | analyze-entity-lookups.sh |
| Map optimization | optimize-map.js |
| Model optimization | .optimized/ cache |
| Client FPS aggregation | ClientPerformanceReporter |
| Zone visibility optimization | ZoneVisibilityMonitor, VisibilityDataCollector |
| Distance-based LOD | NameplateOptimizationConfig |

---

## 16. Known Issues with Performance Tooling

1. **PerformanceMonitor sampling disabled** - Was causing OOM due to unbounded memory growth in timings Map
2. **PerformanceManager event loop monitoring disabled** - 100ms interval checks were themselves causing lag
3. **PerformanceManager periodic reporting disabled** - File writes every 60s added overhead
4. **FrameBudgetMonitor console logging disabled** - Console.info calls in hot path caused perf overhead
5. **Three separate monitoring singletons** (PerformanceManager, PerformanceMonitor, PerformanceProfiler) with overlapping functionality
6. **CPU approximation in PerformanceMonitor** - Bun lacks `process.cpuUsage()`, uses rough estimate
7. **Headless player tests depend on Puppeteer** - Requires Chrome/Chromium installed
8. **Profile scripts reference hardcoded file paths** (e.g., `analyze-bottleneck.js` reads specific stats file)
