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
- [x] HyFire2 — restored map compression codecs from feature/map-compression branch
- [x] Zoo game — added missing Entity methods (setModelAnimationsPlaybackRate, startModelLoopedAnimations, startModelOneshotAnimations, setModelNodeEmissiveColor, setModelNodeEmissiveIntensity)
- [x] HyFire2 benchmark — PASS: avg tick 0.61ms, p99 1.34ms, 431MB heap, 1.2GB RSS
- [x] Zoo Game benchmark (full PerfHarness) — PASS: avg tick 0.25ms, p99 0.85ms, 313MB heap, 782MB RSS
