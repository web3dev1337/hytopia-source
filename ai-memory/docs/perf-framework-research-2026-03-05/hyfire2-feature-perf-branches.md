# HyFire2 Feature Performance Branches - Complete Research

**Repo:** `~/GitHub/games/hyfire2`
**Date:** 2026-03-05
**Total branches researched:** 18

---

## Table of Contents

1. [BATCH 1 - Monitoring System Branches](#batch-1---monitoring-system-branches)
   - [feature/performance-monitoring](#featureperformance-monitoring) (merged)
   - [feature/performance-monitoring-system](#featureperformance-monitoring-system) (merged)
   - [feature/performance-monitoring-ui](#featureperformance-monitoring-ui) (12 commits ahead)
   - [feature/performance-monitoring-improvements](#featureperformance-monitoring-improvements) (29 commits ahead)
   - [feature/performance-monitoring-hybrid](#featureperformance-monitoring-hybrid) (2 commits ahead)
   - [feature/performance-monitoring-ui-merge-master](#featureperformance-monitoring-ui-merge-master) (19 commits ahead)
   - [feature/add-game-performance-monitoring](#featureadd-game-performance-monitoring) (44 commits ahead)
   - [feature/perf-monitoring-terrorist-approaches](#featureperf-monitoring-terrorist-approaches) (merged)
   - [feature/performance-analysis-tools](#featureperformance-analysis-tools) (4 commits ahead)
   - [feature/performance-analysis-combined](#featureperformance-analysis-combined) (216 commits ahead)
   - [feature/performance-analysis-reports](#featureperformance-analysis-reports) (187 commits ahead)
2. [BATCH 2 - Optimization Branches](#batch-2---optimization-branches)
   - [feature/performance-optimizations](#featureperformance-optimizations) (merged)
   - [feature/baseline-lag-optimization](#featurebaseline-lag-optimization) (4 commits ahead)
   - [feature/comprehensive-mobile-performance](#featurecomprehensive-mobile-performance) (merged)
   - [feature/mobile-performance-analysis](#featuremobile-performance-analysis) (4 commits ahead)
   - [feature/investigate-mobile-viewmodel-performance](#featureinvestigate-mobile-viewmodel-performance) (merged)
   - [feature/particle-stress-tester](#featureparticle-stress-tester) (16 commits ahead)
   - [feature/bot-cover-micro-profiler](#featurebot-cover-micro-profiler) (5 commits ahead)
3. [Cross-Cutting Architecture Summary](#cross-cutting-architecture-summary)
4. [Key Techniques Catalog](#key-techniques-catalog)

---

## BATCH 1 - Monitoring System Branches

---

### feature/performance-monitoring

**Status:** Fully merged into master
**Commits:** 5 unique (all merged)
**Key commits:**
- `f54b510a6` docs: add comprehensive performance guide
- `16e22bd70` feat: add comprehensive performance monitoring system

**What it added (now in master):**
- `PerformanceProfiler` - server-side profiling with `Bun.nanoseconds()`
- `profile-server-auto.ts` script for automated profiling in WSL terminals
- Performance monitoring documentation

**Significance:** This was the first performance monitoring system. It established the baseline pattern of wrapping functions with `performance.now()` timing and saving JSON reports.

---

### feature/performance-monitoring-system

**Status:** Fully merged into master
**Commits:** 0 ahead (identical to master)

Likely an earlier/duplicate branch that was merged before `feature/performance-monitoring`.

---

### feature/performance-monitoring-ui

**Status:** 12 commits ahead of master (NOT merged)
**Files changed:** 13 files, +2,311 / -40 lines

**New files added:**
- `assets/ui/components/performance-monitor.js` (788 lines) - Client-side UI overlay
- `src/services/FunctionProfiler.ts` (236 lines) - Function-level profiling
- `src/services/PerformanceMetricsService.ts` (543 lines) - Centralized metrics collection
- `src/services/SessionSpikeTracker.ts` (218 lines) - Session-wide spike tracking
- `src/services/SystemProfiler.ts` (275 lines) - Per-system tick profiling

**Architecture:**

```
Client UI (F9 toggle)         Server Services
+-------------------+         +-------------------------------+
| performance-      |  HTTP   | PerformanceMetricsService     |
| monitor.js        |<------->|   - collectSnapshot() (1/sec) |
| - Overview tab    |         |   - getUIMetrics()            |
| - Spikes tab      |         |   - spikeThresholds           |
| - Logs tab        |         +-------------------------------+
| - Operations tab  |                    |
+-------------------+         +----------+----------+
                              |                     |
                    +-------------------+  +-------------------+
                    | FunctionProfiler  |  | SessionSpikeTracker|
                    | - startFunction() |  | - allTimeWorst[]   |
                    | - endFunction()   |  | - recentSpikes[]   |
                    | - wrap(fn)        |  | - spikePatterns    |
                    +-------------------+  +-------------------+
                              |
                    +-------------------+
                    | SystemProfiler    |
                    | - startTick()     |
                    | - measureSystem() |
                    | - endTick()       |
                    +-------------------+
```

**Key code - PerformanceMetricsService singleton:**
```typescript
export class PerformanceMetricsService {
  private spikes: PerformanceSpike[] = [];
  private spikeThresholds = {
    tick: 1,          // 1ms - catch EVERYTHING
    memory: 1000,     // 1GB
    eventloop: 1,     // 1ms - super sensitive
    operation: 5      // 5ms for operations
  };
  private metricsHistory: MetricsSnapshot[] = [];
  private maxHistorySize: number = 300; // 5 minutes at 1/sec

  public startCollection(): void {
    this.updateInterval = setInterval(() => {
      this.collectSnapshot();
    }, 1000);
  }
}
```

**Key code - FunctionProfiler wrap pattern:**
```typescript
public wrap<T extends (...args: any[]) => any>(fn: T, name: string, fileName: string = ''): T {
  const profiler = this;
  return function(this: any, ...args: any[]) {
    profiler.startFunction(name, fileName);
    try {
      const result = fn.apply(this, args);
      if (result instanceof Promise) {
        return result.finally(() => profiler.endFunction());
      }
      profiler.endFunction();
      return result;
    } catch (error) {
      profiler.endFunction();
      throw error;
    }
  } as T;
}
```

**Key code - SessionSpikeTracker:**
```typescript
interface DetailedSpike {
  id: string;
  timestamp: number;
  duration: number;
  functionName: string;
  callStack: string[];
  context: {
    botName?: string;
    team?: string;
    round?: string;
    players?: number;
    bots?: number;
  };
}
```

**UI Features:**
- F9 hotkey toggles full-screen overlay (90% width, 90vh height)
- Tabs: Overview, Spikes, Logs, Operations
- Green-on-black terminal aesthetic
- Pause/resume button for freezing data
- 500ms update rate
- Auto-scroll with lock

**How to use:** Import and call `metricsService.startCollection()` in GameManager. Open client and press F9.

---

### feature/performance-monitoring-improvements

**Status:** 29 commits ahead of master (NOT merged)
**Files changed:** 14 files, +4,405 / -116 lines
**Relationship:** Superset of `performance-monitoring-ui` (contains all 12 commits + 17 more)

**What it adds beyond the UI branch:**

1. **Enhanced FrameBudgetMonitor** (272+ lines rewritten):
   - Hierarchical operation tracking with parent-child relationships
   - `selfTime` calculation (time in function excluding children)
   - Concurrent load metrics per frame
   - Rich `PerformanceContext` with strategy, zone, enemies, health, weapon
   - Call stack capture for spikes
   - Correlated log entries (before/during/after spike)

2. **Interactive Flamechart Export** (`docs/FLAMECHART_EXPORT.md`, 345 lines):
   - Generates standalone HTML with interactive flame chart visualization
   - Color coding by self-time: Red (>80% = bottleneck), Orange (>50%), Yellow (>30%), Green (<30%)
   - Search panel to find specific operations
   - Zoom/pan controls
   - Shows worst frame tree with drill-down

3. **Markdown Report Export:**
   - Removed heavy UI rendering in favor of lightweight MD export
   - Phase A: Hierarchical tracking and call stack capture
   - Phase B: Rich context and spike-log correlation
   - Phase C: Drill-down modal for detailed spike analysis

4. **Performance optimizations of the monitor itself:**
   - Cached DOM elements to eliminate UI lag
   - Stopped rebuilding DOM every second
   - Reduced update rate from 2x/sec to 1x/sec
   - Limited spikes window from 30s to 5s (max 20 items)
   - 75% CPU reduction when debug UI is open

**Key code - Enhanced FrameBudgetMonitor:**
```typescript
interface FrameOperation {
  name: string;
  duration: number;
  timestamp: number;
  parent: string | null;     // Hierarchical tracking
  depth: number;
  selfTime: number;          // Time excluding children
  children: FrameOperation[];
  context?: PerformanceContext;
}

interface SlowFrame {
  totalDuration: number;
  timestamp: number;
  operations: FrameOperation[];
  exceedsBudget: boolean;
  concurrentOperationsCount: number;
  totalCPUTime: number;
  heaviestOperations: FrameOperation[];
}
```

**Key code - Flamechart color logic (in exported HTML):**
```javascript
function getFlameColor(selfTimePct) {
  if (selfTimePct > 80) return '#ff4444';  // BOTTLENECK
  if (selfTimePct > 50) return '#ff8800';  // Heavy
  if (selfTimePct > 30) return '#ffaa00';  // Medium
  return '#00ff88';                         // Lightweight
}
```

---

### feature/performance-monitoring-hybrid

**Status:** 2 commits ahead of master (NOT merged)
**Files changed:** 5 files, +698 / -25 lines

**New files added:**
- `src/services/PerformanceLagDetector.ts` (427 lines)

**Modified:**
- `src/config/gameConfig.ts` - Added `PerformanceMonitoringConfig` interface
- `src/services/SentryTelemetryService.ts` - Added 50-transaction cap per session
- `docs/PERFORMANCE_MONITORING.md` - Full documentation

**Architecture - Different approach from the UI branch:**
Instead of wrapping individual functions, this uses a polling model:
- Checks CPU usage via `Telemetry.getProcessStats()` every 50ms
- Captures detailed snapshots (player states, bot states, strategies) during spikes
- Sends critical spikes to Sentry telemetry
- Generates periodic 30-second summary reports

**Key code - PerformanceLagDetector:**
```typescript
export class PerformanceLagDetector {
  private spikeThreshold = 40;        // 40% CPU threshold
  private consecutiveSpikes = 0;

  public initialize(): void {
    this.checkInterval = setInterval(() => this.checkForSpikes(), 50);
    this.reportInterval = setInterval(() => this.logPerformanceSnapshot(), 30000);
  }

  private checkForSpikes(): void {
    const stats = Telemetry.getProcessStats(false);
    if (stats.cpuUsage > this.spikeThreshold) {
      this.consecutiveSpikes++;
      // Capture player/bot/round state snapshot
      // Send to Sentry if critical
    }
  }

  public profile<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try { return fn(); }
    finally { this.trackOperation(name, performance.now() - start); }
  }
}
```

**Config structure:**
```typescript
performanceMonitoring: {
  enabled: false,        // Master switch
  lagDetection: true,
  cpuThreshold: 40,      // % CPU for spike detection
  memoryThreshold: 500,   // MB for warnings
  reportInterval: 30,     // seconds between reports
  sentryTraceCap: 50,     // max Sentry transactions/session
  tickTimeThreshold: 50,  // ms for slow tick warning
  checkInterval: 50       // ms polling interval
}
```

**How to use:** Set `performanceMonitoring.enabled = true` in `gameConfig.ts`. System auto-starts on server boot.

---

### feature/performance-monitoring-ui-merge-master

**Status:** 19 commits ahead of master (NOT merged)
**Relationship:** This is `performance-monitoring-ui` rebased/merged onto a newer master, plus the `performance-monitoring-improvements` Phase 1-3 optimizations (DOM caching, reduced update rate, etc). Subset of `performance-monitoring-improvements`.

No unique content beyond what's in the improvements branch.

---

### feature/add-game-performance-monitoring

**Status:** 44 commits ahead of master (NOT merged)
**Files changed:** 38 files, +10,306 / -70,940 lines (large diff due to `index.mjs` rebuild)

**The most comprehensive monitoring branch.** Adds flame charts, spike detection with bot state capture, and many analysis scripts.

**New files added:**
- `src/utils/FlameChartRecorder.ts` (550 lines) - Chrome Trace Event format recording
- `src/utils/SpikeDetector.ts` (676 lines, rewritten) - Spike detection with bot state snapshots
- `performance-reports/flame-chart-viewer.html` (905 lines) - D3.js-based flame chart viewer
- `debug-flame-chart.html` (41 lines)
- `PERFORMANCE_FIXES.md` (359 lines)
- 12 analysis scripts in `scripts/`

**Analysis scripts:**
| Script | Purpose |
|--------|---------|
| `analyze-performance-spikes.ts` | Analyze stats JSON files, generate markdown reports |
| `analyze-all-8k-spikes.ts` | Process 8000+ spike events |
| `analyze-latest-run.ts` | Quick analysis of most recent game run |
| `analyze-latest-spikes.ts` | Recent spike summary |
| `analyze-spike-situations.ts` | Correlate spikes with game situations |
| `cross-reference-all-data.ts` | Cross-reference flame charts with spike logs |
| `dump-frame-monitor-data.ts` | Raw frame monitor data extraction |
| `export-spike-data-comprehensive.ts` | Full spike data export with all context |
| `export-spike-data-fast.ts` | Quick spike data export |
| `extract-all-spikes.ts` | Extract all spike events from logs |
| `extract-granular-operations.ts` | Per-operation timing extraction |
| `extract-spike-logs.ts` | Pull spike-related log entries |

**Key code - FlameChartRecorder (Chrome Trace Events):**
```typescript
interface TraceEvent {
  name: string;
  cat: string;   // category
  ph: string;    // phase: 'B' (begin), 'E' (end), 'X' (complete)
  ts: number;    // timestamp in microseconds
  pid: number;
  tid: number;
  dur?: number;
  args?: any;
}

export class FlameChartRecorder {
  private events: TraceEvent[] = [];
  private readonly THREAD_MAIN = 1;
  private readonly THREAD_BOTS = 2;
  private readonly THREAD_PHYSICS = 3;
  private readonly THREAD_NETWORK = 4;

  beginOperation(name: string, category: string, threadId: number = this.THREAD_MAIN): void {
    this.events.push({
      name, cat: category, ph: 'B',
      ts: (performance.now() - this.startTimeMs) * 1000,
      pid: 1, tid: threadId
    });
  }

  endOperation(name: string, category: string, threadId: number = this.THREAD_MAIN): void {
    this.events.push({
      name, cat: category, ph: 'E',
      ts: (performance.now() - this.startTimeMs) * 1000,
      pid: 1, tid: threadId
    });
  }

  // Output: loadable in chrome://tracing or Speedscope
  saveToFile(): void {
    const output = JSON.stringify({ traceEvents: this.events });
    fs.writeFileSync(path.join(this.config.outputPath, filename), output);
  }
}
```

**Key code - SpikeDetector with bot state capture:**
```typescript
interface SpikeEvent {
  timestamp: number;
  operation: string;
  durationMs: number;
  percentOfBudget: number;
  botStates: BotStateSnapshot[];  // Full state of every bot
  gameContext: {
    roundNumber: number;
    roundTime: number;
    bombPlanted: boolean;
    bombTime: number | null;
    teamScores: { ct: number; t: number };
    playersAlive: { ct: number; t: number };
  };
  stateChanges?: StateChange[];   // What changed since last spike
}
```

**Flame chart viewer** uses D3.js with:
- Dark theme (1e1e1e background)
- File upload for JSON trace files
- Pan/zoom controls
- Fixed Y-axis showing operation names
- Color-coded bars by duration

**How to use:**
1. Enable flame chart: `flameChartRecorder.setEnabled(true)` or import `profile-server-auto.ts`
2. Run game for desired duration
3. Find output in `performance-reports/flame-chart-cumulative-*.json`
4. Open `flame-chart-viewer.html` and load the JSON file
5. Or load in `chrome://tracing`

---

### feature/perf-monitoring-terrorist-approaches

**Status:** Fully merged into master
**Commits:** 4 unique (all merged)

**What it fixed:**
Found that `CTRotationManager.checkTerroristApproaches` was calling `evaluateRotationNeed()` on every terrorist intel update within the same tick. If 5 terrorists rushed B site in one tick, evaluation ran 5 times.

**Solution: Deferred evaluation pattern:**
```typescript
// BEFORE: Each update triggers evaluation
updateTerroristIntel(botName, position) {
  this.evaluateRotationNeed(); // Called 5x in one tick!
}

// AFTER: Flag-based deferred evaluation
updateTerroristIntel(botName, position) {
  this.pendingEvaluation = true; // Just set flag
}

// GameManager tick loop:
for (bot of terrorists) checkApproach(bot);
if (rotationManager.hasPendingEvaluation()) {
  rotationManager.evaluateRotationNeedDeferred(); // Called 1x per tick
}
```

**Result:** 150-700x faster intel updates, no spikes >2ms

---

### feature/performance-analysis-tools

**Status:** 4 commits ahead of master (NOT merged)
**Files changed:** 11 files, +3,333 lines (mostly new)

**New files:**
- `scripts/performance-analysis/create_complete_analysis.py` (442 lines)
- `scripts/performance-analysis/create_pivot_analysis.py` (362 lines)
- `scripts/performance-analysis/extract_full_pivot.py` (128 lines)
- `scripts/performance-analysis/extract_issues.py` (261 lines)
- `scripts/performance-analysis/show_pivot_table.py` (61 lines)
- `scripts/performance-analysis/check_sheets.py` (31 lines)
- `scripts/performance-analysis/README.md` (186 lines)
- Output Excel files (COMPLETE_PERFORMANCE_ANALYSIS.xlsx, PIVOT_ANALYSIS.xlsx)

**Python analysis pipeline:**
```
Input CSVs (from Chrome DevTools CPU profiling):
  profile_FunctionSummary.csv
  profile_TickSummary.csv
  profile_FunctionByTick_MAPPED.csv
         |
         v
create_complete_analysis.py
  -> COMPLETE_PERFORMANCE_ANALYSIS.xlsx
     Sheet 1: Overview
     Sheet 2: HighVarianceFunctions (max/median > 5x)
     Sheet 3: FunctionSpikeDetails (individual spike occurrences)
     Sheet 4: FunctionGroups (correlated functions)
     Sheet 5: HighTicks (all ticks > 3ms)
     Sheet 6: GroupTickBreakdown
         |
         v
create_pivot_analysis.py
  -> PIVOT_ANALYSIS.xlsx
     Sheet 1: PivotTable (HyFire2 code only, ticks >= 1000)
     Sheet 2: GroupsWithFunctionMS (per-function ms contributions)
     Sheet 3: GroupSummary (one row per group)
```

**Key metrics to focus on (from README):**
- Variance Ratio (Max/Median): >10x = SPIKY
- TickNonIdle > 3ms: identifies problematic ticks
- Function Groups: identify event cascades (bomb plant -> retake logic)

**How to use:**
```bash
# 1. Run game with CPU profiling
node --cpu-prof --cpu-prof-interval=100 server.js

# 2. Convert .cpuprofile to CSVs

# 3. Run analysis
cd /path/to/csv/data
python3 scripts/performance-analysis/create_complete_analysis.py
python3 scripts/performance-analysis/create_pivot_analysis.py
```

---

### feature/performance-analysis-combined

**Status:** 216 commits ahead of master (NOT merged)
**Files changed:** 274 files, +1,785,915 lines
**Relationship:** Superset of `performance-analysis-tools` + `performance-analysis-reports`

**The largest analysis branch.** Contains:

1. **200+ individual function spike analyses** in `performance-reports/` and `spike-analysis/` directories
   - Each is a markdown file analyzing one function
   - Includes: metrics (max, p95, median, spike ratio), root cause, proposed fix with code

2. **Instrumentation guide** (`INSTRUMENTATION_GUIDE.md`, 598 lines):
   - Step-by-step deployment guide for performance instrumentation
   - Recommended fix order by ROI:
     1. `setMovementInputs` - easiest, 60-80% improvement, 30 min
     2. `_isKnownWeaponClass` - replace require(), 70-90% improvement, 15 min
     3. `checkTerroristApproach` - cache bot lookups, 70-90% improvement, 45 min
     4. `handlePlayerInput` - cache debug config, 50-70% improvement, 30 min
     5. `isPlayerInAir` - fix Rust aliasing, 70-85% improvement, 15 min

3. **Final spike analysis** (`FINAL_SPIKE_ANALYSIS.md`):
   - 88 gameplay spikes ranked by severity
   - Top offenders: pointInZone (36x spike), _handlePlayerInput (31x), getCurrentRecoilOffset (24x)
   - Severity formula: spike_ratio * duration

4. **Actual code optimizations applied** (in src/):
   - `GamePlayerEntity.ts`: +260/-68 lines - optimized _handlePlayerInput, reduced grenade logging
   - `MomentumPlayerController.ts`: optimized setMovementInputs
   - `RecoilSystem.ts`: eliminated Vector3.clone() allocation
   - `BotController.ts`: reduced string concatenation
   - `CTRotationManager.ts`: cached bot lookups
   - `PointInPolygon.ts`: optimized polygon checks
   - `MovementAccuracySystem.ts`: throttled accuracy recalculation

5. **Validation report** (`PERFORMANCE_VALIDATION_REPORT.md`):
   - A/B test results proving fixes work
   - 36% less log data with fixes applied
   - 7% fewer errors

6. **Codebase mapping** (`codebase-map.json`, 1.6M lines):
   - Complete call graph analysis
   - Function relationship mapping
   - Used to trace spike cascades

**Key instrumentation pattern:**
```typescript
private setMovementInputs(w, a, s, d): void {
  const perfStart = performance.now();
  const perfCheckpoints: Record<string, number> = {};

  const stringStart = performance.now();
  const currentInputState = `${w}${a}${s}${d}`;
  perfCheckpoints.stringConcat = performance.now() - stringStart;

  // ... rest of function with checkpoints ...

  const totalMs = performance.now() - perfStart;
  if (totalMs > 0.5) {
    eventLogger.info('perf.setMovementInputs', 'Performance breakdown', {
      totalMs: totalMs.toFixed(3),
      checkpoints: { /* ... */ },
      context: { botName: this._entity.getBotName() }
    });
  }
}
```

---

### feature/performance-analysis-reports

**Status:** 187 commits ahead of master (NOT merged)
**Relationship:** Subset of `performance-analysis-combined` (all commits present in combined)

Contains the per-function analysis reports and codebase mapping tools but without the actual code fixes. The `combined` branch is the superset.

---

## BATCH 2 - Optimization Branches

---

### feature/performance-optimizations

**Status:** Fully merged into master
**Commits:** 0 ahead

Earlier optimization work that was fully merged. No unique content remaining.

---

### feature/baseline-lag-optimization

**Status:** 4 commits ahead of master (NOT merged)
**Files changed:** 8 files, +64,772 / -5 lines (mostly raw JSON trace data)

**Focus:** Mobile client frame budget analysis based on real Chrome trace data.

**Key findings (from `REAL_BASELINE_LAG_FIX.md`):**
- 59.2% of animation frames fail 60fps budget (>16ms)
- 34.2% fail 30fps budget (>33ms)
- Average frame time 38ms (238% over budget)
- Root cause: `weapon-viewmodel-dual-renderer.js` runs unconditionally at 60fps

**Fixes applied:**
1. **Frame skipping on mobile** (`weapon-viewmodel-dual-renderer.js`):
```javascript
let frameCounter = 0;
function renderFrame() {
  frameCounter++;
  if (isMobile && frameCounter % 2 === 0) {
    animationFrameId = requestAnimationFrame(renderFrame);
    return; // Skip every other frame = 30fps on mobile
  }
  // ... rest of rendering
}
```

2. **Disable weapon bob on mobile** - removes per-frame sine/cosine calculations
3. **Reduce setInterval aggression** in mobile controls joystick

**Analysis data:** Contains `recurring_blockers_raw_data.json` (61K lines) - full trace data for offline analysis.

---

### feature/comprehensive-mobile-performance

**Status:** Fully merged into master
**Commits:** 5 unique (all merged)

**What was merged:**
- Per-frame analysis of what kills frame budget on mobile A14 chip
- Reduced blood particle count on mobile (instead of disabling entirely)
- Complete breakdown of mobile A14 performance characteristics
- Audit of all periodic operations and their frame budget impact
- Previously merged optimizations: antialiasing disabled, pixel ratio clamped to 1.5, shader precision lowered, simplified lighting, shell casings disabled, smoke disabled on mobile

---

### feature/mobile-performance-analysis

**Status:** 4 commits ahead of master (NOT merged)
**Files changed:** 12 files, +66,578 lines

**New Python analysis scripts:**
- `analyze-trace.py` (429 lines) - Chrome Performance Trace Analyzer
  - Analyzes long tasks (>50ms)
  - JavaScript execution time breakdown
  - Rendering performance (Layout, Paint, Composite)
  - Frame time distribution
- `analyze-recurring-blockers.py` (372 lines) - Recurring Frame Blocker Analysis
  - Filters to gameplay only (skips first 5s startup)
  - Finds operations that repeatedly block frames
  - Tracks call frequency and duration distribution
- `analyze-frame-budget.py` (386 lines) - Frame budget analysis

**Key code - TraceAnalyzer:**
```python
class TraceAnalyzer:
    def analyze_long_tasks(self, threshold_ms=50):
        for event in self.events:
            if event.get('ph') == 'X' and 'dur' in event:
                duration_ms = event['dur'] / 1000
                if duration_ms > threshold_ms:
                    self.long_tasks.append({
                        'name': event.get('name'),
                        'duration_ms': duration_ms,
                        'timestamp': event.get('ts', 0) / 1000
                    })
```

**How to use:**
```bash
# 1. Capture Chrome trace on mobile device
# 2. Download trace JSON
python3 analyze-trace.py trace.json
python3 analyze-recurring-blockers.py trace.json
python3 analyze-frame-budget.py trace.json
```

---

### feature/investigate-mobile-viewmodel-performance

**Status:** Fully merged into master
**Commits:** 3 unique (all merged)

**What was merged:**
- **Ambient-only lighting on mobile** for weapon view model:
  - Mobile: single ambient light (intensity 1.2) instead of ambient (0.65) + directional (0.8)
  - Desktop unchanged: ambient (0.5) + directional (1.0) + fill (0.3)
  - Estimated 3-5% FPS improvement on mobile
- Comprehensive mobile view model optimizations
- Analysis documentation

---

### feature/particle-stress-tester

**Status:** 16 commits ahead of master (NOT merged)
**Files changed:** 5 files, +831 / -1 lines

**New files:**
- `src/test/ParticleStressTester.ts` (425 lines)
- `assets/ui/components/particle-test-menu.js` (255 lines)

**Test scenarios:**
| Test | What it does |
|------|-------------|
| `weapons` | All players fire weapons simultaneously |
| `smoke` | Spawn multiple smoke grenades |
| `he` | Spawn multiple HE grenades |
| `molotov` | Spawn multiple molotov grenades |
| `flash` | Spawn multiple flashbangs |
| `blood` | Damage all players for blood effects |
| `stress` | ALL effects combined at maximum intensity |
| `ramp` | Gradually increase particle intensity |

**Key code:**
```typescript
export class ParticleStressTester {
  constructor(gameManager: GameManager) {
    this.initializeScenarios();
    // Auto-start test sequence after 5 seconds
    setTimeout(() => this.runAutoTestSequence(), 5000);
  }

  public async runTest(scenario: string): Promise<void> {
    this.isRunning = true;
    const test = this.scenarios.get(scenario);
    await test.execute();
    this.isRunning = false;
  }
}
```

**UI:** F2 hotkey toggles a floating menu with orange-on-black theme. Also adds a permanent "PARTICLE TESTS (F2)" button.

**How to use:** The stress tester auto-runs a sequence 5 seconds after construction. Or use the F2 menu in the client to trigger individual tests.

---

### feature/bot-cover-micro-profiler

**Status:** 5 commits ahead of master (NOT merged)
**Files changed:** 10 files, +1,269 / -25 lines

**New files:**
- `src/profiling/BotCoverServiceProfiler.ts` (181 lines)
- `docs/micro-profiler-notes.md` (35 lines)

**Technique: Opt-in prototype patching via environment variable:**
```typescript
const ENABLED = process.env.BOT_COVER_PROF === "1";

if (ENABLED) {
  const INSTALLED_SYMBOL = Symbol.for("BOT_COVER_PROF_INSTALLED");

  if (!(botCoverProto as any)[INSTALLED_SYMBOL]) {
    (botCoverProto as any)[INSTALLED_SYMBOL] = true;

    function wrapMethod(prototype, methodName, label) {
      const original = prototype[methodName];
      prototype[methodName] = function(...args) {
        const start = performance.now();
        try {
          const result = original.apply(this, args);
          if (result?.then) {
            return result.then(v => { recordSample(label, performance.now() - start); return v; });
          }
          recordSample(label, performance.now() - start);
          return result;
        } catch (error) {
          recordSample(label, performance.now() - start);
          throw error;
        }
      };
    }

    // Wrap specific methods
    wrapMethod(botCoverProto, "assignBotsToGroups", "BotCover.assignBotsToGroups");
    wrapMethod(botCoverProto, "navigateBotToCoverPoint", "BotCover.navigateBotToCoverPoint");
    wrapMethod(botCoverProto, "updateBotPatrols", "BotCover.updateBotPatrols");
    wrapMethod(eventLoggerProto, "debug", "EventLogger.debug");
    wrapMethod(eventLoggerProto, "logToFile", "EventLogger.logToFile");

    // Auto-emit on exit
    process.once("exit", emitReport);
  }
}
```

**Output:** JSON file at `profiles/bot-cover-prof-{timestamp}.json` with per-method stats (count, totalMs, avgMs, maxMs, minMs).

**How to use:**
```bash
BOT_COVER_PROF=1 BOT_COVER_PROF_OUTPUT=profiles/run1.json bun run dev
```

**Key design principles (from micro-profiler-notes.md):**
1. Patch prototypes safely (use Symbol to prevent double-wrap)
2. Keep probe < 0.01ms overhead per call
3. Run A/B comparisons with identical workloads
4. Remove or disable behind strict opt-in flag when done

---

## Cross-Cutting Architecture Summary

### Evolution of Monitoring Approaches

```
Generation 1 (merged):
  performance-monitoring          -> Basic profiler with Bun.nanoseconds()
  performance-monitoring-system   -> Duplicate/early attempt
  perf-monitoring-terrorist       -> Targeted fix for CT rotation
  performance-optimizations       -> Early optimization pass

Generation 2 (unmerged, UI-focused):
  performance-monitoring-ui       -> Full client overlay + server services
  performance-monitoring-improvements -> Enhanced with flamecharts + hierarchy
  performance-monitoring-ui-merge-master -> Rebased version

Generation 3 (unmerged, production-focused):
  performance-monitoring-hybrid   -> Polling-based lag detection + Sentry + config

Generation 4 (unmerged, deep analysis):
  add-game-performance-monitoring -> Flame charts + spike detector + 12 scripts
  performance-analysis-tools      -> Python Excel analysis pipeline
  performance-analysis-reports    -> 200+ function analyses
  performance-analysis-combined   -> Everything + actual code fixes + validation

Generation 5 (unmerged, targeted profilers):
  bot-cover-micro-profiler        -> Env-var-gated prototype patching
  particle-stress-tester          -> Grenade/particle load testing

Mobile-specific (mix of merged/unmerged):
  comprehensive-mobile-performance -> Merged: blood particles, A14 analysis
  investigate-mobile-viewmodel     -> Merged: ambient-only lighting
  mobile-performance-analysis      -> Unmerged: Python trace analyzers
  baseline-lag-optimization        -> Unmerged: frame skipping fix
```

### Common Metrics Tracked

| Metric | Where | Threshold |
|--------|-------|-----------|
| Frame/tick duration | FrameBudgetMonitor | 16.66ms (60 FPS) |
| Spike detection | SpikeDetector | 0.5ms (3% of budget) |
| CPU usage | PerformanceLagDetector | 40% |
| Memory (heap) | PerformanceMetricsService | 1GB |
| Event loop lag | PerformanceMetricsService | 1ms |
| Individual operation | FunctionProfiler | 10ms |
| Sentry transactions | SentryTelemetryService | 50 per session |

---

## Key Techniques Catalog

### 1. Function Wrapping (FunctionProfiler pattern)
```typescript
const wrapped = function(...args) {
  const start = performance.now();
  try { return original.apply(this, args); }
  finally { record(performance.now() - start); }
};
```
**Used in:** performance-monitoring-ui, bot-cover-micro-profiler

### 2. Deferred Evaluation (batch processing)
```typescript
// Flag instead of immediate execution
this.pendingEvaluation = true;
// Single evaluation at end of tick
if (hasPending()) evaluateDeferred();
```
**Used in:** perf-monitoring-terrorist-approaches (150-700x speedup)

### 3. Chrome Trace Event Format
```typescript
{ name, cat, ph: 'X', ts: microseconds, pid: 1, tid: threadId, dur: microseconds }
```
**Used in:** add-game-performance-monitoring (FlameChartRecorder)
**Viewable in:** chrome://tracing, Speedscope, custom D3.js viewer

### 4. Prototype Patching with Symbol Guard
```typescript
const SYM = Symbol.for("PROFILER_INSTALLED");
if (!proto[SYM]) { proto[SYM] = true; /* wrap methods */ }
```
**Used in:** bot-cover-micro-profiler

### 5. CPU Polling (production-safe)
```typescript
setInterval(() => {
  const stats = Telemetry.getProcessStats(false);
  if (stats.cpuUsage > threshold) captureSnapshot();
}, 50);
```
**Used in:** performance-monitoring-hybrid

### 6. Checkpoint-based Instrumentation
```typescript
const checkpoints = {};
checkpoints.step1 = performance.now() - stepStart;
// ... more steps ...
if (total > threshold) log({ checkpoints });
```
**Used in:** performance-analysis-combined (INSTRUMENTATION_GUIDE.md)

### 7. Python CSV-to-Excel Analysis Pipeline
```
Chrome CPU profile -> CSV -> openpyxl -> XLSX with pivot tables
```
**Used in:** performance-analysis-tools

### 8. Mobile Frame Skipping
```javascript
if (isMobile && frameCounter % 2 === 0) { return; } // 30fps on mobile
```
**Used in:** baseline-lag-optimization

### 9. Self-Time Calculation for Flamecharts
```typescript
selfTime = totalDuration - sum(children.map(c => c.duration));
```
**Used in:** performance-monitoring-improvements (FrameBudgetMonitor)

### 10. A/B Validation Protocol
```
Run 1: with fixes (5 min, AUTO_START_WITH_BOTS)
Run 2: without fixes (5 min, same config)
Compare: log volume, error count, frame timing
```
**Used in:** performance-analysis-combined (PERFORMANCE_VALIDATION_REPORT.md)
