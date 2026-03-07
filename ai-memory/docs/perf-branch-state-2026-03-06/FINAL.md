# HYTOPIA Performance Framework State Report

**Date:** 2026-03-06  
**Repo:** `web3dev1337/hytopia-source`  
**Branch:** `feature/perf-external-notes-verification-20260305`

## Executive Summary

The original idea for this branch was correct:

Build a reusable performance framework for HYTOPIA engine work so future SDK/client changes can be measured against repeatable synthetic scenarios and real games such as HyFire2 and Zoo Game.

That framework now exists.

What happened after that is also clear:

- the branch built the real framework
- the framework was verified against synthetic and real-game scenarios
- the branch then got mixed with a local blob-shadow investigation
- this cleanup separates those concerns again

After this cleanup, the branch should be understood as:

- **permanent framework code** kept
- **real-game benchmark glue** kept when it is broadly useful
- **feature-under-test monkey patches** removed
- **raw local experiment output** removed from the working tree
- **findings** preserved in this report

## Original Goal

The intended outcome was a benchmark system that can answer:

- did this server-side change hurt tick time or memory?
- did this client-side change hurt FPS, frame time, draw calls, or triangles?
- does a change regress only desktop, or also throttled/mobile conditions?
- can we replay the same game situations over time rather than inventing ad hoc tests?

That goal is reflected in:

- [init.md](/home/ab/GitHub/hytopia/work1/ai-memory/feature/perf-external-notes-verification-20260305-2249094/init.md)
- [plan.md](/home/ab/GitHub/hytopia/work1/ai-memory/feature/perf-external-notes-verification-20260305-2249094/plan.md)
- [progress.md](/home/ab/GitHub/hytopia/work1/ai-memory/feature/perf-external-notes-verification-20260305-2249094/progress.md)
- [perf-final-2026-03-05/FINAL.md](/home/ab/GitHub/hytopia/work1/ai-memory/docs/perf-final-2026-03-05/FINAL.md)

## What We Actually Built

### Server-Side Perf Instrumentation

Core files:

- [PerformanceMonitor.ts](/home/ab/GitHub/hytopia/work1/server/src/metrics/PerformanceMonitor.ts)
- [NetworkMetrics.ts](/home/ab/GitHub/hytopia/work1/server/src/metrics/NetworkMetrics.ts)
- [CpuProfiler.ts](/home/ab/GitHub/hytopia/work1/server/src/metrics/CpuProfiler.ts)
- [PerfHarness.ts](/home/ab/GitHub/hytopia/work1/server/src/perf/PerfHarness.ts)
- [PerfWorldGenerator.ts](/home/ab/GitHub/hytopia/work1/server/src/perf/PerfWorldGenerator.ts)
- [PerfBlockChurner.ts](/home/ab/GitHub/hytopia/work1/server/src/perf/PerfBlockChurner.ts)

Capabilities:

- tick timing snapshots
- operation-level timings
- heap and RSS reporting
- network metrics
- perf endpoints for automated runs
- synthetic world generation
- block churn stressors

### Benchmark Runner and CLI

Core files:

- [cli.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/cli.ts)
- [BenchmarkRunner.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/BenchmarkRunner.ts)
- [MetricCollector.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/MetricCollector.ts)
- [ProcessMonitor.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/ProcessMonitor.ts)
- [ServerApiClient.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/ServerApiClient.ts)
- [BaselineComparer.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/BaselineComparer.ts)
- [ConsoleReporter.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/reporters/ConsoleReporter.ts)
- [JsonReporter.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/reporters/JsonReporter.ts)

Capabilities:

- scenario-based benchmark execution
- JSON report output
- baseline comparisons
- regression thresholds
- OS-level process monitoring
- log capture
- external-server mode

### Client-Side Perf Metrics

Core files:

- [PerfBridge.ts](/home/ab/GitHub/hytopia/work1/client/src/core/PerfBridge.ts)
- [HeadlessClient.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/HeadlessClient.ts)

Capabilities:

- FPS
- frame time
- draw calls
- triangles
- entities
- chunks
- GLTF stats
- JS heap
- browser CPU throttling

This is what made client feature benchmarking real instead of only measuring server tick time.

### Scenario and Preset System

Representative presets:

- [idle.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/idle.yaml)
- [stress.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/stress.yaml)
- [join-storm.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/join-storm.yaml)
- [block-churn.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/block-churn.yaml)
- [entity-density.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/entity-density.yaml)
- [multi-world.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/multi-world.yaml)
- [blocks-10m-dense.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/blocks-10m-dense.yaml)
- [hyfire2-bots.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/hyfire2-bots.yaml)
- [zoo-game-bots.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-bots.yaml)
- [zoo-game-full.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-full.yaml)
- [zoo-game-observe.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-observe.yaml)

`zoo-game-full.yaml` is the cleaned real-game walkthrough benchmark retained from the local investigation. It is intentionally single-client: one benchmark browser joins, sends `/fillzoo`, and walks the route while client metrics are collected. It is not the “human joins a world with 5 other movers” observation mode.

`zoo-game-observe.yaml` is the joinable observation preset. It keeps the same Zoo setup but also spawns 5 moving perf bots near the zoo entrance so a human observer sees a busier scene without editing the benchmark by hand. CPU throttling is still a runner option, not hardcoded in either preset.

### Real Game Integration

Core files:

- [link-sdk.sh](/home/ab/GitHub/hytopia/work1/packages/perf-tools/scripts/link-sdk.sh)
- [setup-game.sh](/home/ab/GitHub/hytopia/work1/packages/perf-tools/scripts/setup-game.sh)

What these do:

- build the local SDK from this repo
- link it into external game repos
- let HyFire2 or Zoo Game run against local engine changes

Important clarification:

HyFire2 and Zoo Game are not first-class game source trees inside this repo. This repo provides the engine plus the tooling to benchmark those games from their own directories.

### Local Paths Used On This Machine

The concrete local game paths that were actually discovered and used during verification on this machine are:

- HyFire2: `/home/ab/GitHub/games/hyfire2`
- Zoo Game: `/home/ab/GitHub/games/hytopia/zoo-game/work1`

These paths are machine-specific and do not belong in the repo-wide codebase inventory, but they do belong in this perf state/runbook so the next real-game benchmark does not require rediscovery.

### CI Automation

Core files:

- [perf-gate.yml](/home/ab/GitHub/hytopia/work1/.github/workflows/perf-gate.yml)
- [perf-baseline-update.yml](/home/ab/GitHub/hytopia/work1/.github/workflows/perf-baseline-update.yml)

Current CI state:

- baseline capture exists
- PR perf gating exists
- current CI is still oriented around lightweight scenarios like `idle` and `stress`
- full external-game runs remain more manual

## What Was Verified

The branch progress log says the following were completed:

- OS-level monitoring
- PerfHarness fallback mode
- log capture
- HyFire2 runs
- Zoo Game runs
- client PerfBridge metrics
- headless client automation
- blob-shadow A/B investigation using real client metrics

Representative result files already in the repo:

| Scenario | Source | Summary |
|---|---|---|
| HyFire2 bots | [hyfire2-bots.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/hyfire2-bots.json) | avg tick `0.61ms`, p99 `1.34ms`, avg memory `431MB` |
| Zoo Game full PerfHarness | [zoo-game-bots-full.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/zoo-game-bots-full.json) | avg tick `0.25ms`, p99 `0.85ms`, avg memory `313MB` |
| Stress A/B baseline | [stress-baseline-no-shadows.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/stress-baseline-no-shadows.json) | client avg FPS about `27.8` |
| Stress A/B blob shadows | [stress-with-blob-shadows.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/stress-with-blob-shadows.json) | client avg FPS about `26.1` |
| Mobile stress baseline | [mobile-baseline.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/mobile-baseline.json) | client avg FPS about `11.0` |
| Mobile stress blob shadows | [mobile-blob-shadows.json](/home/ab/GitHub/hytopia/work1/packages/perf-tools/perf-results/mobile-blob-shadows.json) | client avg FPS about `11.8` |

Bottom line:

- the framework was exercised end-to-end
- it produced usable data
- it reached both synthetic and real-game scenarios

## Branch Timeline

| Commit | Meaning |
|---|---|
| `e518ad3` | imported external perf notes and verification material |
| `8581645` | broad perf framework research pass |
| `0e7f689` | initial framework implementation |
| `adb7561` | wired perf-tools end to end |
| `6ec796d` | expanded perf harness and more scenarios |
| `0793124` | added process monitoring and real-game presets |
| `b757df9` | restored map compression codecs and captured real-game results |
| `0ed330d` | added missing entity APIs and Zoo Game full PerfHarness benchmark |
| `2f69c38` | added client-side PerfBridge and Puppeteer benchmarking |
| `aac6de2` | fixed headless navigation and error handling |
| `4e716cc` | improved headless connection and earlier PR #2 blob-shadow A/B work |
| `2b3ebf2` | made A/B flow more deterministic |
| `b6bdca2` | added mobile CPU throttle benchmark flow |

## What This Cleanup Kept

This cleanup retains the broadly reusable framework improvements that were still only local:

- `--external-server` support in [cli.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/cli.ts)
- `send_chat` scenario action in [ScenarioLoader.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/ScenarioLoader.ts)
- chat-triggered setup support in [HeadlessClient.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/HeadlessClient.ts)
- external-server handling and client-only baseline generation in [BenchmarkRunner.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/BenchmarkRunner.ts)
- a cleaned [zoo-game-full.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-full.yaml) preset
- a documented [zoo-game-observe.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-observe.yaml) preset for live join/observation runs
- runner-level `--cpu-throttle` support so desktop/mobile/low-end comparisons no longer require editing YAML
- scoped local HTTPS handling in [ServerApiClient.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/ServerApiClient.ts) instead of a global TLS-disable environment hack

These are deliberate framework improvements, not feature-under-test patches.

## What This Cleanup Removed

### Removed from the Working Tree

- local blob-shadow changes in `client/src/entities/Entity.ts`
- local blob-shadow quality toggles in `client/src/settings/SettingsManager.ts`
- local transparent-sort fallback in `client/src/three/utils.ts`
- incidental `client/package-lock.json` churn
- raw local Zoo Game desktop/4x/16x JSON outputs
- the loose `zoo-game-blob-shadows-report.md` experiment file

### Why Those Were Removed

They were not framework code. They were a mixture of:

- feature-under-test code copied from upstream PR #2
- local monkey patches needed to make that feature benchmarkable
- ad hoc raw output from one investigation session

That material belongs in a focused feature-evaluation branch or report, not in the core framework state.

## Blob-Shadow Investigation Findings

The raw local files were removed from the working tree during cleanup, but the results are preserved here.

### Correctness Finding

PR #2 blob-shadow meshes did not populate the transparent sort metadata expected by `getTransparentSortKey()`. Without a fallback, rendering crashed during benchmarking.

That means the feature under test was not benchmarkable as-is.

### Performance Summary from the Local Zoo Game Run

| Tier | Baseline FPS | Blob Shadows FPS | Change | Verdict |
|---|---|---|---|---|
| Desktop | `25.1` | `21.0` | `-16.4%` | real regression |
| 4x CPU throttle | `14.1` | `16.1` | `+14.4%` | likely variance / neutral |
| 16x CPU throttle | `7.6` | `7.5` | `-1.5%` | roughly neutral on average |

Other relevant findings:

- desktop min FPS dropped from `17` to `7`
- frame time rose from `41.8ms` to `52.8ms` on desktop
- draw calls and triangles barely changed
- likely cost was not geometry count but shadow update/lifecycle overhead

Interpretation:

- the framework successfully surfaced a concrete correctness bug
- it also surfaced a likely desktop performance regression
- that work was real analysis, but it was not permanent framework code

## Current Assessment

If the question is:

“Did we actually build the performance framework I asked for?”

The answer is **yes**.

If the question is:

“Were we also mixing in local one-off patching while investigating a feature?”

The answer is **yes**.

If the question is:

“Has that now been separated?”

The answer should now be **yes**:

- reusable framework additions retained
- temporary feature-under-test patches removed
- experiment findings documented here
- raw local experiment output removed from the tree

## Remaining Gaps

1. Full external-game benchmarking is still more manual than synthetic presets.
2. CI is still centered on lightweight built-in scenarios rather than full game walkthroughs.
3. HyFire2/Zoo Game benchmarking still depends on local setup and linked SDK flows.
4. The branch still needs a clean final commit/PR state to lock this cleanup in.

## Read This First Tomorrow

If you only read a few files, read these:

1. [this report](/home/ab/GitHub/hytopia/work1/ai-memory/docs/perf-branch-state-2026-03-06/FINAL.md)
2. [perf-final-2026-03-05/FINAL.md](/home/ab/GitHub/hytopia/work1/ai-memory/docs/perf-final-2026-03-05/FINAL.md)
3. [progress.md](/home/ab/GitHub/hytopia/work1/ai-memory/feature/perf-external-notes-verification-20260305-2249094/progress.md)
4. [BenchmarkRunner.ts](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/runners/BenchmarkRunner.ts)
5. [PerfBridge.ts](/home/ab/GitHub/hytopia/work1/client/src/core/PerfBridge.ts)
6. [zoo-game-full.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-full.yaml)
7. [zoo-game-observe.yaml](/home/ab/GitHub/hytopia/work1/packages/perf-tools/src/presets/zoo-game-observe.yaml)

## Bottom Line

The framework is real.

The branch was doing the right thing conceptually.

What was wrong was that a useful framework branch had become mixed with a local feature investigation. This cleanup keeps the framework, removes the monkey patches, and leaves one report that explains the whole state without needing to reconstruct it from scattered files.
