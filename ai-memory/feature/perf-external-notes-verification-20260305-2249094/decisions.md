# Decisions

## Game SDK Compatibility
Both HyFire2 and Zoo Game have API breaks with our local SDK build:
- **HyFire2** (0.14.27): uses `WorldMapChunkCacheCodec`, `WorldMapFileLoader` — removed in 0.15.2
- **Zoo Game** (^0.15.2): uses `setModelAnimationsPlaybackRate` — doesn't exist in published or local 0.15.2

Root cause: our fork has diverged from published SDK. Games developed against published versions.
Resolution: SDK version alignment needed upstream before game benchmarks can run.
Workaround: `--no-perf-api` mode gives OS-level monitoring even without PerfHarness.

## ProcessMonitor Design
Initially monitored single PID. But `spawn(cmd, {shell:true, detached:true})` creates a shell
process — the actual node server is a child. Fixed by scanning `/proc` for all PIDs in the
same process group (PGID) and aggregating CPU/RSS/threads/FDs across all of them.
