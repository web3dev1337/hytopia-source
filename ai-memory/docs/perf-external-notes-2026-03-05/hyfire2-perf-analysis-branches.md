# HyFire2 Performance Analysis/Docs Branches - Research Notes

**Date**: 2026-03-05
**Source repo**: ~/GitHub/games/hyfire2 (NeuralPixelGames/HyFire2)
**Branches analyzed**: 11 analysis/docs performance branches
**Period covered**: July-October 2025

---

## Overview

HyFire2 is a Counter-Strike-style multiplayer FPS game built on the HYTOPIA SDK (Bun/TypeScript server, Three.js client). Over July-October 2025, extensive performance work produced 63+ curated performance PRs and 11 analysis/docs branches documenting monitoring strategies, profiling infrastructure, hotspot analysis, and optimization results.

The game runs at 60 Hz server tick rate with a 16.67ms frame budget. Performance work focused on server-side tick spikes caused by bot AI, combat systems, death handling, entity lookups, and navigation.

---

## Branch-by-Branch Analysis

---

### 1. `docs-performance`

**Purpose**: Foundational performance tooling documentation and scripts.
**Head commit**: `cfce3ac4c` ("performance")

**Key files**:
- `PERFORMANCE_GUIDE.md` -- Comprehensive guide covering all performance tools, metrics thresholds, optimization targets, and advanced profiling techniques.
- `scripts/benchmark-game.ts` -- Automated benchmarking with scenario support (idle, 5v5 combat, 10v10 full, stress test). Collects avg/max tick time, memory, event loop lag, and per-operation percentiles (P95, P99).
- `scripts/profile-server-auto.ts` -- Auto-saving performance monitor for non-interactive terminals (WSL). Saves reports every 30s to `performance-reports/` dir. Displays frame budget, worst frame, spike patterns in color-coded terminal output.
- `scripts/generate-flamegraph.ts` -- Parses collapsed stack format into tree structure and generates interactive HTML flame graphs with zoom/pan/search.
- `test-bot-spawn.ts` -- Simple test script for bot spawn diagnostics.
- `tools/zone-visibility-viewer.html` -- HTML viewer for zone visibility data.
- `tools/log-viewer/`, `tools/replay-viewer/` -- Log and replay visualization tools.

**Techniques**:
- Real-time server monitoring with PerformanceMonitor, PerformanceProfiler, FrameBudgetMonitor
- Automated benchmarking with configurable scenarios and JSON report output
- HTML flame graph generation from collapsed stack format
- Client FPS overlay (F3 key)
- Linux perf integration (`perf record` + FlameGraph scripts)
- V8 heap snapshots for memory profiling
- Async profiling with `perf_hooks` PerformanceObserver

**Notable findings**:
- Baseline performance: 1.11ms avg game tick, 0.09ms bot decision, 0.10ms pathfinding
- Theoretical targets: game tick <0.5ms, bot AI <0.01ms, pathfinding <0.05ms
- Proposed advanced techniques: object pooling, spatial hash grids, SIMD operations, WebAssembly for hot paths, flow fields for pathfinding

---

### 2. `analysis/performance-monitoring-strategy`

**Purpose**: Strategy document for diagnosing production lag (CPU 10% -> 60%+ spikes causing rubber-banding). Implemented monitoring infrastructure.
**Head commit**: `c31ab1ce7` (telemetry threshold tuning)

**Key files**:
- `PERFORMANCE_MONITORING_STRATEGY.md` -- 4-phase implementation plan: (1) enable Hytopia's Telemetry.initializeSentry with 25ms threshold, (2) add strategic performance spans to bot processing/pathfinding/combat, (3) CPU spike detection with game state snapshots at >40% CPU, (4) lightweight custom profiler (LagSpikeProfiler class).
- `PERFORMANCE_MONITORING_STATUS.md` -- Status report on what was implemented vs what works. Created `PerformanceLagDetector` service (CPU monitoring every 50ms, spike detection at 40%/60% thresholds, snapshots every 30s). Integrated Sentry v10 dual-SDK setup. Added spans to `BotBrain.think` and `ZoneNavigationService.findPath`. Problem: performance traces never appeared in Sentry despite correct span implementation -- likely Hytopia platform limitation.
- `add-granular-perf-tracking.sh` -- Bash script analyzing instrumentation gaps. Identifies methods >5ms without internal instrumentation (CTRotationStrategy.execute at 13.36ms peak, BotCombatSystem.processCombat at 14.94ms peak, TerroristStrategy.execute at 7.37ms peak). Recommends adding `frameBudgetMonitor.measure()` inside combat/navigation/strategy methods.
- `analyze-bottleneck.js` -- Node.js script analyzing worst-frame performance data from JSON stats. Parses per-operation timings, groups by category, identifies outliers. Found: `brain.bombDetection.Whiskey` took 22.65ms (62% of frame), combat operations only 6.96ms total -- bottleneck was NOT in combat/pathfinding but in bomb detection.
- `visualize-perf.js` -- ASCII flame chart and cumulative time visualization from stats JSON. Shows timing breakdown by P99 latency, cumulative time per operation, frame budget analysis.
- `generate-flame-chart.cjs` -- Generates interactive HTML flame chart from performance reports. Color-coded bars (hot/warm/cool), aggregated timing stats by category.
- `scripts/map-profile-to-code.cjs` -- Maps CPU profile (.cpuprofile) function names to game source code using CODEBASE_REF.md. Categorizes functions as game code vs Hytopia SDK vs unknown.
- `scripts/analyze-performance.cjs` -- Analyzes .cpuprofile files: builds call trees, calculates self/total times from samples, finds top 20 hot functions by self time.

**Techniques**:
- Sentry dual-SDK setup (v10 for errors, Hytopia internal v9 for spans)
- PerformanceLagDetector service with CPU monitoring, spike detection, game state snapshots
- Hytopia Telemetry.startSpan() for bot thinking and pathfinding
- Performance stats JSON export + offline analysis scripts
- CPU profile to source code mapping

**Notable findings**:
- Sentry performance traces do not appear in dashboard despite correct integration -- likely requires production Hytopia environment variables
- The PerformanceLagDetector works locally but Sentry trace export does not
- Bomb detection was the actual bottleneck (22.65ms), not combat/pathfinding as expected

---

### 3. `analysis/code-hotspots-metrics`

**Purpose**: Code hotspot analysis and bug pattern analysis.
**Head commit**: `0f9a175ad` (bug pattern analysis of last 1000 commits)

**Key files**:
- `analysis-reports/bug-analysis/` -- Bug pattern analysis directory
- `PERFORMANCE_FIX_ANALYSIS.md` -- Detailed breakdown of fixable bottlenecks with before/after code and risk assessment:
  1. `_sendRecoilDataToUI` (65ms spike) -- Fix: throttle to 30fps, savings ~50ms
  2. `getCurrentRecoilOffset` (37ms spike) -- Fix: cache until state changes, savings ~30ms
  3. `findZoneForPosition` (61ms spike, 81ms total) -- Fix: spatial grid index (10-unit cells), savings ~40ms
  4. `updateTrackedFlashes` (41ms spike) -- Fix: singleton shared tracker instead of per-bot full entity scan, savings ~30ms
  5. `think()` bot AI -- Lower impact, higher risk

**Techniques**:
- Static code analysis identifying hot functions by spike severity
- Proposed spatial grid indexing for zone lookups (O(n) -> O(1) amortized)
- Object allocation reduction (eliminate `.clone()` calls in hot paths)
- Throttling UI updates (60fps -> 30fps for recoil data)
- Singleton pattern for shared state (flash tracking)
- Git history churn analysis for bug patterns

---

### 4. `docs/performance-analysis-oct-5`

**Purpose**: October 5, 2025 performance sprint documentation.
**Head commit**: `d5e7a7412` (5-minute performance test analysis)

**Key files**:
- `PERFORMANCE_FINDINGS.md` -- handleDeath optimization analysis. Root cause: weaponDrop (0.8-1.1ms) + deathEvent dispatch (0.7-1.5ms) accounting for entire 2-4ms death handling time. Fixes: removed JSON.parse/stringify from deathEvent, optimized grenade disposal logging. Result: 2.969ms -> 1.509ms average (49.2% faster), best case 74.3% faster.
- `scenarios/grenade-death.yaml` -- Test scenario definition for grenade death spike testing. Defines 60s duration, 10 iterations, threshold targets (handleDeath avg <20ms, max <50ms, P95 <35ms, weaponDrop avg <12ms).

**Techniques**:
- Try-finally instrumentation blocks for granular timing measurement
- setTimeout(fn, 0) deferral for non-critical operations
- JSON serialization elimination from hot paths
- YAML-based test scenario definitions with pass/fail thresholds
- Automated testing with Puppeteer headless player support

**Notable findings**:
- handleDeath: 49.2% improvement (2.969ms -> 1.509ms)
- Death visibility check: 99.6% improvement (1.532ms -> 0.006ms)
- Grenade disposal: 97% improvement (40-60ms -> 1.03ms)

---

### 5. `docs/performance-analysis-outputs`

**Purpose**: Comprehensive performance analysis outputs including CPU profile correlation, dependency mapping, Trello integration, and visualization.
**Head commit**: `feaea11a1` (add performance analysis outputs)

**Key files**:
- `PERFORMANCE_ANALYSIS_SUMMARY.md` -- CPU profile analysis correlating 42,725 functions and 7.5M samples with 17 Trello cards. Top 3 critical fixes: BotTickService.tick (2.12ms spikes, affects 10 downstream issues), StoppingPowerManager.update (1.20ms spikes, affects 7 downstream), Global.checkTerroristApproaches (3.46ms spikes). Scoring system: impact (downstream fixes) + severity (spike size) + frequency.
- `PERFORMANCE_OPTIMIZATIONS_TODO.md` -- Phased optimization plan from profiling data: 192 high-variance functions, 5,080+ spikes, 99 ticks >3ms. Phase 1 low-hanging fruit: FrameBudgetMonitor sampling (90% overhead reduction), BotNavigator squared distance (60% reduction from eliminating Math.sqrt), ZoneVisibilityService zone caching (70% reduction). Phase 2: MomentumPlayerController config caching (worst offender at 33.977ms max spike, 270 spikes).
- `PERFORMANCE_DEPENDENCY_MAP.json` -- JSON dependency graph of 219 performance records with 25 root causes mapped to leaf symptoms. Largest cluster: BombEntity.completeDefusing with 42 nodes and 16 leaves.
- `PERFORMANCE_DEDUPED_TRELLO_LIST.md` -- Deduped Trello card list with spike data. BotTickService.tick: 351 spikes, 85 unique leaves, max non-idle 20.288ms. Detailed per-leaf analysis with caller context, spike counts, and percentage of cluster load.
- `perf_dependency_graph.html`, `perf_dependency_map.html` -- Interactive SVG dependency graph visualizations showing root cause -> symptom relationships.
- `SINGLE_RENDERER_ANALYSIS.md` -- Analysis of single vs dual Three.js WebGLRenderer for weapon view models. Dual renderer is safer (separate WebGL context, guaranteed to work); single renderer saves ~5% GPU but requires monkey-patching Hytopia's minified SDK. Runtime A/B switching with F9 debug panel.
- `scripts/capture-baseline.sh` -- Bash script: starts server with AUTO_START_WITH_BOTS, runs for configurable duration, extracts perf.* events from game logs, calculates statistics (avg/min/max/P50/P95/P99) per operation, outputs JSON baseline file.
- `scripts/compare-baselines.ts` -- TypeScript script comparing two baseline JSON files. Calculates avgChange/maxChange/p95Change percentages, flags regressions vs improvements, supports threshold parameter for CI pass/fail.
- `scripts/comprehensive-analysis.cjs` -- Analyzes replay files (.json.gz) from last 24 hours for tactical anomalies (bomb abandonment, CT not defusing, T not planting, stuck bots).

**Techniques**:
- CPU profile parsing with call hierarchy construction (parent-child relationships)
- Spike detection with correlation to Trello cards
- Dependency graph construction (root causes vs symptoms)
- De-duplication analysis to identify cascading fix opportunities
- Scoring algorithm: weighted by downstream impact + spike severity + frequency
- Baseline capture and regression comparison (CI-ready)
- Replay file analysis for tactical/performance anomalies
- Interactive SVG dependency graph visualization

**Notable findings**:
- Fixing BotTickService.tick alone should resolve 10 downstream issues
- Performance monitoring overhead (FrameBudgetMonitor itself) is 15.4% of profiled time -- ironic
- MomentumPlayerController.updateMovementConfig is the single worst offender at 33.977ms max spike

---

### 6. `docs/performance-automation-playbook`

**Purpose**: Profiling-to-fix workflow documentation.
**Head commit**: `3a2275f61` (add performance automation playbook)

**Key files**:
- Links CLAUDE.md to performance automation playbook for AI agent consistency
- `ai-memory/` directory contains memory files from many performance fix branches:
  - `fix/punch-offset-performance-*`
  - `fix/recoil-ui-performance-*`
  - `fix/tracked-flashes-performance-*`
  - `fix/remove-unused-performance-components-*`
  - `fix/knife-visibility-swap-*`
  - `perf/` directory

**Techniques**:
- Standardized profiling-to-fix workflow documentation
- AI memory files tracking progress on individual performance fixes
- Branch-isolated memory for context persistence across sessions

---

### 7. `docs/performance-monitoring-ultrathink-analysis`

**Purpose**: Deep analysis of the performance monitoring system itself, plus enhancement proposals for industry-standard format exports (Speedscope, Chrome Trace, Perfetto).
**Head commit**: `a6d5312e0` (comprehensive performance monitoring documentation)

**Key files**:
- `ULTRATHINK_PERFORMANCE_ANALYSIS.md` (93KB) -- Complete technical deep-dive. Smart spike aggregation (groups `player.takeDamage.Yankee` + `.Echo` into `player.takeDamage` category with median/outlier detection). Tree filtering (filters <0.5ms operations, recursive significance check). Granular tracking (broke 6.8ms takeDamage black box into scoreboard 4.2ms + lookup 1.4ms + audio 0.6ms + UI 0.3ms). Fixed negative self-time display bug.
- `PERFORMANCE_SYSTEM_REALITY_CHECK.md` -- Debunks "9-layer architecture" claim. Reality: 4 separate loosely-connected systems (FrameBudgetMonitor, SessionSpikeTracker, PerformanceMonitor, PerformanceMetricsService) with only 5 integration points. All systems start automatically, data stays in RAM, F9 overlay is the only UI.
- `CPU_AND_MEMORY_MONITORING.md` -- Audit: memory tracking is real (process.memoryUsage()), CPU tracking is FAKE (hardcoded 0.7/0.3 multipliers because Bun lacks process.cpuUsage()). Memory shown only in exported reports, not in F9 overlay. Recommends adding memory to F9 UI.
- `PERFORMANCE_TRACKING_HIERARCHY.md` -- Complete map of all 82 unique `frameBudgetMonitor.measure()` tracking points across the codebase. 3-4 level hierarchy: game manager ops -> bot AI (deepest: bot.decision -> brain.combatCheck -> combat.findTarget -> combat.visibilityCheck). Documents every tracked operation with category and nesting.
- `GRANULAR_TRACKING_STATUS.md` -- Implementation status: added granular tracking to weapon shooting (5 sub-operations in Gun._shootProjectile), projectile physics (4 sub-operations in ProjectileEntity.fire), weapon pickup (4 sub-operations), bomb pickup (4 sub-operations). Skipped gm.handleTeamSelect (870 lines, too complex).
- `ADD_GRANULAR_TRACKING.md` -- Implementation guide for adding nested frameBudgetMonitor.measure() calls.
- `EXECUTIVE_SUMMARY.md` -- Research overview for Speedscope/Chrome Trace/Perfetto export. Current system is 95% complete. Missing only standard format exports. Measured overhead: 0.43ms/frame (2.6% of 16.66ms budget). Speedscope: 2-4 hours to implement. Chrome Trace: 6-10 hours. Proposes UnifiedProfiler, ProfileDataBuffer (ring buffer, 60s window, <100MB), PerformanceExporter, and enhanced bottleneck detectors.

**Techniques**:
- Smart spike aggregation with dynamic suffix stripping (player names, weapon names, bot names)
- Outlier detection (>2x median threshold)
- Recursive tree filtering with significance checks
- Hierarchical call tree with self-time calculation
- Proposed: Chrome Trace Event Format export, Speedscope JSON export, adaptive sampling (3 modes: always/adaptive/on-spike)
- Ring buffer data management (<100MB, 60s window)

**Notable findings**:
- Performance monitoring system is 4 real components, not 9 as previously documented
- CPU monitoring is completely fake (Bun doesn't expose process.cpuUsage())
- Monitoring overhead is 15.4% of profiled time (FrameBudgetMonitor 6.59%, SpikeDetector start/end 8.81%)
- 82 unique tracking points in codebase

---

### 8. `docs/performance-testing-infrastructure`

**Purpose**: Testing infrastructure analysis and roadmap.
**Head commit**: `7d184799a` (comprehensive testing infrastructure analysis)

**Key files**:
- `PERFORMANCE_FINDINGS.md` -- Same handleDeath analysis as branch #4 (Oct 5). Documents the 49.2% death handling improvement.

**Techniques**:
- Documents the 3-layer existing monitoring system
- Identifies critical gaps: no headless browser automation, no regression framework, no scenario definitions, Bun vs Node inconsistency
- 4-phase roadmap: (1) Puppeteer + test hooks, (2) grenade fix validation, (3) automated test suite, (4) CI/CD integration

---

### 9. `docs/perf-hotspots-20251004`

**Purpose**: October 4, 2025 hotspot baseline capture.
**Head commit**: `5963a9e86` (summarize top performance hotspots)

**Key files**:
- `PERFORMANCE_FINDINGS.md` -- Same handleDeath analysis as other branches.

**Notable findings**:
- Top 10 HyFire hotspots by self time (from 10-minute AUTO_START_WITH_BOTS run):
  1. BotCoverServiceV2.log -- 369.81ms (10.75%)
  2. WalkingRunPlayerController.tickWithPlayerInput -- 314.78ms (9.15%)
  3. BotTickService.tick -- 264.67ms (7.70%)
  4. FrameBudgetMonitor.measure -- 226.77ms (6.59%) -- monitoring overhead
  5. SpikeDetector.endOperation -- 159.32ms (4.63%) -- monitoring overhead
  6. ZoneVisibilityService.findZoneForPosition -- 151.82ms (4.41%)
  7. SpikeDetector.startOperation -- 143.68ms (4.18%) -- monitoring overhead
  8. TerroristBombCarrierStrategy.execute -- 96.79ms (2.81%)
  9. StoppingPowerManager.update -- 92.72ms (2.70%)
  10. BB.think -- 81.37ms (2.37%)
- Monitoring overhead (#4, #5, #7) = 15.4% of total profiled time

---

### 10. `docs/top-10-performance-analysis`

**Purpose**: Real player session analysis with top 10 spike detection and fixes.
**Head commit**: `12864b831` (cache PlayerEffectsController to eliminate 7.15ms audio spike)

**Key files**:
- `PERFORMANCE_FINDINGS.md` -- Same handleDeath analysis.
- `scenarios/grenade-death.yaml` -- Same scenario file as branch #4.

**Techniques**:
- 10-minute real player session analysis
- 6,900 instrumented events analyzed
- Top issues identified: takeDamage (62.4ms total), damageEffectUI (26.7ms), handleDeath (23.6ms)
- 6 bad spikes >3ms (10.5% of damage events)
- Per-tick raycast caching with bidirectional optimization (A->B also caches B->A)
- PlayerEffectsController caching to eliminate 7.15ms audio spike

**Notable findings**:
- 9 PRs merged on Oct 5 alone during performance sprint
- Audio spike: 99.9% reduction (7.15ms -> <0.01ms)
- Death visibility: 99.6% improvement (1.532ms -> 0.006ms)
- Raycast cache: 39% reduction (4,062 raycasts saved, bidirectional caching)

---

### 11. `analysis/performance-work-3mo`

**Purpose**: Comprehensive 3-month retrospective of all performance work (July-October 2025).
**Head commit**: `233c73ad0` (properly curated 63 performance PRs)

**Key files**:
- `PERFORMANCE_WORK_EXECUTIVE_SUMMARY.md` -- 26 unmerged performance PRs representing 300+ hours of work. Top 5 critical PRs: (1) PR #1473 memory leak fixes, (2) PR #1406 remove sync file operations (5-second player join freeze), (3) PR #1184 bot navigation caching (8.8ms -> <1ms, 53% frame budget freed), (4) PR #1474 disable smoke animation spam, (5) PR #1477 automated performance testing with Puppeteer.
- `CURATED_PERFORMANCE_PRS_2025.md` -- 63 properly curated performance PRs across 4 months. Categories: spike elimination (26 PRs), caching optimizations (15 PRs), monitoring/infrastructure (8 PRs), asset/memory optimization (6 PRs), load distribution/async (5 PRs), log spam reduction (3 PRs). Peak days: Oct 5 (9 PRs), Sep 1 (8 PRs), Aug 16 (8 PRs), Aug 14 (6 PRs).
- `PERFORMANCE_PRS_LAST_3_MONTHS.md` -- Detailed breakdown of 21 PRs (11 merged, 10 open) from the October sprint. Documents per-PR metrics, test infrastructure, methodology.
- `UNMERGED_PERFORMANCE_WORK_ANALYSIS.md` -- Deep analysis of 26 unmerged PRs across 3 categories: monitoring infrastructure (13 PRs), backend optimizations (8 PRs), frontend/system optimizations (5 PRs). PR #1477 automated testing: headless Puppeteer, spike detection, baseline comparison, CI/CD ready (`npm run test:performance`, `npm run test:performance:baseline`, `npm run test:performance:compare`).
- `PERFORMANCE_PR_ACTION_CHECKLIST.md` -- Week-by-week action plan for merging critical PRs with testing requirements per PR.
- `PERFORMANCE_PRS_DATA.json` -- JSON data of all performance PRs.
- `PERFORMANCE_ANALYSIS_INDEX.md` -- Index/navigation document.

**Notable findings (quantified improvements)**:
- Death visibility: 99.6% faster (1.5ms -> 0.006ms)
- Grenade disposal: 97% faster (40-60ms -> 1.03ms)
- Stopping power cache: 93% faster (3.45ms -> 0.24ms)
- MVP tracking: 93% faster in 10v10 (0.7ms -> <0.05ms)
- Entity lookups: ~90% iteration reduction
- Debug logging removal: 90% overhead eliminated
- Team elimination check: 80% faster (0.98ms -> 0.2ms)
- Raycast operations: ~80% reduction with zone visibility
- Map draw calls: 70% reduction (1,597 -> 487)
- handleDeath: 49.2% faster (3ms -> 1.5ms)
- Weapon drops: 42.8% faster
- Bot combat raycasts: 39% saved (4,062 fewer)
- Weapon attack: 35% faster (4.84ms -> 3.13ms)
- Log spam: 99.7% reduction (3,600/min -> 12/min)
- Recoil UI payload: 80% smaller (150 -> 30 bytes)
- Overall: average game tick went from 10ms+ to 1.11ms

---

## Cross-Branch Patterns and Themes

### Performance Monitoring Architecture (4 real layers)
1. **FrameBudgetMonitor** -- Instruments code with `.measure(name, fn)` calls, hierarchical call trees, spike detection >1ms. 82 unique tracking points across codebase.
2. **SessionSpikeTracker** -- All-time worst 20 spikes, recent spikes (15s window), pattern aggregation with log correlation.
3. **PerformanceMonitor** -- System metrics (memory real, CPU fake via Bun limitation), 1s sampling, 600-sample history (10 min).
4. **PerformanceMetricsService** -- Aggregates all other systems, sends to F9 UI overlay, supports JSON/CSV/Markdown/HTML export.

### Key Scripts and Tools
| Script | Purpose |
|--------|---------|
| `scripts/benchmark-game.ts` | Automated benchmarking with scenarios |
| `scripts/profile-server-auto.ts` | Auto-saving profiler for WSL |
| `scripts/generate-flamegraph.ts` | HTML flame graph generation |
| `scripts/capture-baseline.sh` | Capture performance baseline JSON |
| `scripts/compare-baselines.ts` | Compare baselines for CI regression |
| `scripts/analyze-performance.cjs` | CPU profile (.cpuprofile) analysis |
| `scripts/map-profile-to-code.cjs` | Map profile functions to source |
| `scripts/comprehensive-analysis.cjs` | Replay file tactical analysis |
| `add-granular-perf-tracking.sh` | Instrumentation gap analysis |
| `analyze-bottleneck.js` | Worst-frame bottleneck analysis |
| `visualize-perf.js` | ASCII flame chart + cumulative time |
| `generate-flame-chart.cjs` | Interactive HTML flame chart |

### Optimization Techniques Used
1. **Caching** -- Most common technique (15 PRs). Zone lookups, stopping power, SceneUI references, debug UI config, recoil offsets, input state, bomb entity lookups, alive players list.
2. **Deferral** -- setTimeout(fn, 0) for non-blocking operations: damage UI, weapon drops, MVP tracking, grenade disposal.
3. **Throttling** -- Rate-limit frequent operations: recoil UI to 20-30fps, bot navigator warnings to 1/5s.
4. **Spatial indexing** -- Grid-based zone lookups replacing linear scan (O(n) -> O(1)).
5. **Squared distance** -- Eliminate Math.sqrt() in distance comparisons.
6. **Object allocation reduction** -- Avoid .clone(), cache computed values, pre-allocate.
7. **Log spam elimination** -- Remove debug logging from hot paths, rate-limit warnings.
8. **Bidirectional caching** -- Raycast A->B also caches B->A result.
9. **Singleton shared state** -- Replace per-bot entity scans with shared tracker.
10. **Async conversion** -- Replace synchronous file I/O with startup-time loading + memory cache.

### Testing Infrastructure
- **Headless browser automation**: Puppeteer for automated performance testing
- **Test hooks**: `ENABLE_TEST_HOOKS=true`, `AUTO_START_WITH_BOTS=true`
- **Scenario definitions**: YAML files with duration, iterations, metric thresholds, pass/fail criteria
- **Baseline comparison**: JSON baseline capture + regression detection for CI/CD
- **npm commands**: `npm run test:performance`, `npm run test:performance:baseline`, `npm run test:performance:compare`
- **F9 overlay**: Real-time performance monitoring UI with export (JSON, CSV, Markdown, Speedscope, flame chart HTML)

### Known Limitations
1. CPU monitoring is fake (Bun lacks process.cpuUsage())
2. Sentry performance traces do not appear in dashboard (Hytopia platform limitation)
3. Performance monitoring overhead is 15.4% of profiled time (FrameBudgetMonitor + SpikeDetector)
4. 26 performance PRs remained unmerged as of Oct 2025 despite being production-ready
5. Proposed Speedscope/Chrome Trace exports were never fully implemented (research complete, code examples ready)

---

## Summary Statistics

- **Total performance PRs (curated)**: 63
- **Unmerged PRs (as of Oct 2025)**: 26
- **Estimated development time**: 300+ hours
- **Unique tracking points**: 82 frameBudgetMonitor.measure() calls
- **Peak sprint**: 9 PRs merged on October 5, 2025
- **Overall improvement**: avg game tick from 10ms+ to 1.11ms
- **Frame budget target**: 16.67ms @ 60 FPS (game now uses ~6.7% of budget)
