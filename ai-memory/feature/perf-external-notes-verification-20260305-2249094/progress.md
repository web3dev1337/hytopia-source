# Progress

- [x] ProcessMonitor.ts — reads /proc/<pid>/stat + status for CPU%, RSS, threads, FDs
- [x] ProcessMonitor fix — aggregate all child processes in process group (shell=true+detached)
- [x] MetricCollector — ProcessSnapshotEntry type + addProcessSnapshot method
- [x] BenchmarkRunner — ProcessMonitor integration, PerfHarness fallback, log capture
- [x] ConsoleReporter — process metrics section with CPU% threshold warnings
- [x] CLI — --no-perf-api, --log-file options
- [x] Scripts — link-sdk.sh, setup-game.sh (chmod +x)
- [x] Presets — hyfire2-bots.yaml, zoo-game-bots.yaml
- [x] Build verification — tsc passes clean
- [x] Verified: idle benchmark — CPU avg=1.3%, RSS 168MB, 12 threads, 37 FDs
- [x] Verified: stress benchmark — CPU avg=2.9% max=13%, RSS 196MB
- [x] Verified: --no-perf-api mode — OS-only monitoring works
- [x] Verified: --log-file option — server output captured to file
- [x] HyFire2 — API breaks (WorldMapChunkCacheCodec/WorldMapFileLoader removed in 0.15.2)
- [x] Zoo game — API breaks (setModelAnimationsPlaybackRate not in published 0.15.2)
- [ ] Game benchmarks blocked — both games need SDK version alignment (upstream issue)
