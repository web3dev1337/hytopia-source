# Progress

- [x] ProcessMonitor.ts — reads /proc/<pid>/stat + status for CPU%, RSS, threads, FDs
- [x] MetricCollector — ProcessSnapshotEntry type + addProcessSnapshot method
- [x] BenchmarkRunner — ProcessMonitor integration, PerfHarness fallback, log capture
- [x] ConsoleReporter — process metrics section with CPU% threshold warnings
- [x] CLI — --no-perf-api, --log-file options
- [x] Scripts — link-sdk.sh, setup-game.sh (chmod +x)
- [x] Presets — hyfire2-bots.yaml, zoo-game-bots.yaml
- [x] Build verification — tsc passes clean
- [ ] HyFire2 setup — npm link, test launch
- [ ] Zoo game setup — extract loadtest files, npm link, test launch
- [ ] Run benchmarks
