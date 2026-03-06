# Decisions

## Game SDK Compatibility — RESOLVED
Both games had API breaks with our local SDK build. Fixed by adding missing APIs:
- **HyFire2**: Restored map compression codecs (WorldMapCodec, WorldMapChunkCacheCodec, WorldMapFileLoader, WorldMapArtifacts) from `feature/map-compression` branch. Also updated World.loadMap() to accept compressed formats.
- **Zoo Game**: Added missing Entity methods: `setModelAnimationsPlaybackRate`, `startModelLoopedAnimations`, `startModelOneshotAnimations`, `setModelNodeEmissiveColor`, `setModelNodeEmissiveIntensity`.
- Both games also needed `@fails-components/webtransport` installed locally (our SDK marks it as external).
- Both now run with full PerfHarness via `npm link hytopia`.

## ProcessMonitor Design
Initially monitored single PID. But `spawn(cmd, {shell:true, detached:true})` creates a shell
process — the actual node server is a child. Fixed by scanning `/proc` for all PIDs in the
same process group (PGID) and aggregating CPU/RSS/threads/FDs across all of them.
