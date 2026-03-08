# Plan

1. ProcessMonitor.ts — OS-level CPU/RSS/FD monitoring
2. MetricCollector — add process snapshot support
3. BenchmarkRunner — integrate ProcessMonitor, graceful PerfHarness fallback, log capture
4. ConsoleReporter — display process metrics with CPU% thresholds
5. CLI — new options (--no-perf-api, --log-file)
6. Scripts — link-sdk.sh, setup-game.sh
7. Presets — hyfire2-bots.yaml, zoo-game-bots.yaml
8. HyFire2 setup — npm link, test launch, fix API breaks
9. Zoo game setup — extract loadtest files, npm link, test launch
10. Run benchmarks — both games, native + throttled
