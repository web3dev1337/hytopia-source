# HYTOPIA SDK/Engine Performance Infrastructure Deep-Dive

Date: 2026-03-05
Codebase: /home/ab/GitHub/hytopia/work1

---

## 1. SERVER-SIDE PERFORMANCE SYSTEMS

### 1.1 Telemetry (Sentry-based span profiling)

**File:** `server/src/metrics/Telemetry.ts`

The primary server profiling system wraps Sentry's tracing SDK. Key design:

- **Zero-overhead in dev**: `Telemetry.startSpan()` checks `Sentry.isInitialized()` and if false, simply calls the callback directly -- no timing overhead at all.
- **Production gating**: Only sends spans to Sentry when `tickTimeMs > tickTimeMsThreshold` (default 50ms). This means normal ticks are never reported -- only slow ticks.
- **Span hierarchy**: The TICKER_TICK span is the root transaction. Nested inside it are WORLD_TICK spans, and nested inside those are sub-spans for each phase.

**Defined span operations** (enum `TelemetrySpanOperation`):
```
TICKER_TICK               -- root: the fixed-timestep ticker loop
  WORLD_TICK              -- one full world tick
    ENTITIES_TICK          -- entity.tick() for all active entities
    SIMULATION_STEP        -- Rapier physics step + cleanup
      PHYSICS_STEP         -- rapier.step() only
      PHYSICS_CLEANUP      -- drain events + collider cleanup
    ENTITIES_EMIT_UPDATES  -- entity.checkAndEmitUpdates()
    NETWORK_SYNCHRONIZE    -- full network sync flush
      BUILD_PACKETS        -- (not currently used in WorldLoop)
      SERIALIZE_PACKETS    -- msgpackr.pack() + gzip if >64KB
      SERIALIZE_PACKETS_ENCODE -- (sub-span, not directly used)
      SEND_PACKETS         -- per-connection send
      SEND_ALL_PACKETS     -- send loop over all players
      NETWORK_SYNCHRONIZE_CLEANUP -- clear queues + caches
    SERIALIZE_FREE_BUFFERS -- (not currently used)
```

**Process stats** (`Telemetry.getProcessStats()`):
- `jsHeapSizeMb`, `jsHeapCapacityMb`, `jsHeapUsagePercent`, `processHeapSizeMb`, `rssSizeMb`
- Attached to every Sentry error event and every slow-tick transaction

**Usage sites** (7 files import Telemetry):
- `WorldLoop.ts` -- WORLD_TICK + sub-spans
- `Ticker.ts` -- TICKER_TICK root span
- `Simulation.ts` -- PHYSICS_STEP, PHYSICS_CLEANUP
- `Connection.ts` -- SERIALIZE_PACKETS, SEND_PACKETS
- `NetworkSynchronizer.ts` -- SEND_ALL_PACKETS, NETWORK_SYNCHRONIZE_CLEANUP
- `index.ts` -- re-export for SDK consumers

### 1.2 World Loop Timing

**File:** `server/src/worlds/WorldLoop.ts`

The world loop wraps `Ticker` and runs at 60Hz (DEFAULT_TICK_RATE). Performance instrumentation:

- `performance.now()` captured at tick start and end
- `TICK_START` event payload includes `tickDeltaMs` (the fixed timestep)
- `TICK_END` event payload includes `tickDurationMs` (actual wall-clock time spent)
- SDK developers can listen to `WorldLoopEvent.TICK_END` to monitor per-tick cost

**Tick order:**
1. `entityManager.tickEntities(tickDeltaMs)` -- all active (non-environmental) entities
2. `simulation.step(tickDeltaMs)` -- Rapier physics
3. `entityManager.checkAndEmitUpdates()` -- dirty-flag position/rotation change detection
4. `networkSynchronizer.synchronize()` -- only every 2nd tick (30Hz)

### 1.3 Ticker (Fixed Timestep Engine)

**File:** `server/src/shared/classes/Ticker.ts`

Key performance constants:
- `TICK_SLOW_UPDATE_CAP = 2` -- max catch-up ticks per loop iteration (prevents spiral of death)
- `MAX_ACCUMULATOR_TICK_MULTIPLE = 3` -- clamp accumulator to prevent massive catch-up

Uses `setTimeout` (not `setImmediate`) to give the main thread breathing room for GC. The delay is calculated as `Math.max(0, fixedTimestepMs - accumulatorMs)`.

### 1.4 Physics Simulation Timing

**File:** `server/src/worlds/physics/Simulation.ts`

- `performance.now()` at step start/end
- Emits `SimulationEvent.STEP_START` and `STEP_END` with `stepDurationMs`
- Debug rendering (wireframe colliders) is gated by `_debugRenderingEnabled` -- explicitly warns "avoid in production; can cause noticeable lag"
- Debug raycasting emits per-raycast events when enabled

### 1.5 Network Synchronizer Performance Design

**File:** `server/src/networking/NetworkSynchronizer.ts` (very large, ~1200 lines)

Performance-critical design decisions:
- **30Hz sync rate**: `TICKS_PER_NETWORK_SYNC = Math.round(60 / 30) = 2` -- network flushes every other physics tick
- **Reliable vs unreliable splitting**: Entity position/rotation updates go over unreliable WebTransport datagrams (90%+ of traffic), other entity updates go reliable
- **Lazy queue clearing**: "We only clear queues if they aren't empty, otherwise it causes significant memory growth and triggers unnecessary major GCs" -- explicit GC-aware optimization
- **IterationMap** (`server/src/shared/classes/IterationMap.ts`): Custom Map+Array hybrid for ~2x faster iteration than `Map.values()`. Used throughout NetworkSynchronizer for all sync queues.
- **Packet serialization cache**: `Connection._cachedPacketsSerializedBuffer` caches encoded packets by array identity -- encode once, send to N players. Cleared each sync cycle.

### 1.6 Connection & Packet Performance

**File:** `server/src/networking/Connection.ts`

- **Gzip compression**: Packets >64KB are gzip-compressed at level 1 (fast)
- **WebTransport unreliable cap**: Datagrams >1200 bytes promoted to reliable (MTU-aware)
- **Serialization telemetry**: SERIALIZE_PACKETS span records packet count, IDs, and serialized byte count
- **Per-send span**: SEND_PACKETS wraps each connection.send()

### 1.7 Sync Request/Response (RTT Measurement)

**Server side** (`Player.ts` + `NetworkSynchronizer.ts`):
- Client sends SyncRequest packet (null payload) every 2 seconds
- Server records `Date.now()` and `performance.now()` on receipt
- Server responds with SyncResponse containing:
  - `r`: server absolute time at request receipt
  - `s`: server absolute time at response
  - `p`: high-res processing time (ms) from receipt to response
  - `n`: ms until next server tick

### 1.8 Model Preloading Timing

**File:** `server/src/models/ModelRegistry.ts`
- `performance.now()` before/after model preloading loop
- Console logs total preload time

### 1.9 GameServer Start Timing

**File:** `server/src/GameServer.ts`
- Emits `GameServerEvent.START` with `startedAtMs: performance.now()`

---

## 2. CLIENT-SIDE PERFORMANCE SYSTEMS

### 2.1 PerformanceMetricsManager (FPS + Memory)

**File:** `client/src/core/PerformanceMetricsManager.ts`

Core metrics manager that runs every frame:
- **FPS**: Calculated every 1 second (`FPS_UPDATE_INTERVAL_IN_SEC = 1.0`), averaged over that window
- **Delta time**: Uses Three.js `Clock.getDelta()`
- **Memory**: Reads `performance.memory` (Chrome-only API) for `usedJSHeapSize` and `totalJSHeapSize`
- **Refresh rate estimation**: Samples 30 `requestAnimationFrame` deltas, trims 10% outliers, rounds to nearest common rate (30/60/72/90/120/144/165/240/300/360)
- Exposed properties: `fps`, `deltaTime`, `frameCount`, `usedMemory`, `totalMemory`, `refreshRate`

### 2.2 Debug Panel (lil-gui + Stats.js)

**File:** `client/src/core/DebugPanel.ts`

Full debug overlay toggled with backtick (`) or F3 (or 5-finger touch on mobile):

**Stats.js panels:**
- Default FPS/MS panels (from three/examples Stats)
- Custom MB panel (heap memory in MB)
- Custom RTT(ms) panel (round-trip time to server)

**lil-gui folders:**
- **Lobby**: lobby ID
- **User Agent**: browser info
- **Player**: position
- **Camera**: position
- **Server**: send/receive protocol (ws/wt), SDK version
- **Performance**: quality preset level
- **WebGL**: draw calls, geometries, textures, triangles, programs (from `renderer.info`)
- **Entity**: count, static environment, in-view-distance, frustum-culled, update-skip, animation play, local/world matrix updates, light-level updates, custom textures
- **Chunks**: count, visible, blocks, opaque/transparent/liquid faces, block textures
- **glTF**: file count, source/cloned/instanced meshes, draw calls saved, attribute elements updated
- **Scene UI**: count, visible
- **Arrows**: count, visible
- **Audio**: count, matrix updates, skip matrix updates

### 2.3 Stats Classes (Per-Subsystem Counters)

All use static fields, reset per-frame by their respective managers:

**EntityStats** (`client/src/entities/EntityStats.ts`):
- count, staticEnvironmentCount, inViewDistanceCount, frustumCulledCount, updateSkipCount
- animationPlayCount, localMatrixUpdateCount, worldMatrixUpdateCount, lightLevelUpdateCount, customTextureCount

**ChunkStats** (`client/src/chunks/ChunkStats.ts`):
- count, visibleCount, blockCount, opaqueFaceCount, transparentFaceCount, liquidFaceCount, blockTextureCount

**GLTFStats** (`client/src/gltf/GLTFStats.ts`):
- fileCount, sourceMeshCount, clonedMeshCount, instancedMeshCount, drawCallsSaved, attributeElementsUpdated

**AudioStats** (`client/src/audio/AudioStats.ts`):
- count, matrixUpdateCount, matrixUpdateSkipCount

**ArrowStats** (`client/src/arrows/ArrowStats.ts`):
- count, visibleCount

**SceneUIStats** (`client/src/ui/SceneUIStats.ts`):
- count, visibleCount

### 2.4 Renderer Performance

**File:** `client/src/core/Renderer.ts`

- `renderer.info.autoReset = false` -- manual reset per frame via `renderer.info.reset()` before render calls
- WebGL stats read from `renderer.info`: draw calls, geometries, textures, triangles, programs
- FPS cap via `SettingsManager.qualityPerfTradeoff.fpsCap` -- skips render frames if elapsed time < 1/fpsCap
- Scene-level `matrixAutoUpdate = false` and `matrixWorldAutoUpdate = false` on all 4 scenes (main, viewModel, overlay, UI) -- all matrix updates are manual
- Custom transparent sort function using cached sort keys per render frame
- WebGL context loss detection with user alert

### 2.5 Automatic Quality Adjustment

**File:** `client/src/settings/SettingsManager.ts`

Dynamic quality presets: ULTRA, HIGH, MEDIUM, LOW, POWER_SAVING

Each preset controls:
- Resolution multiplier (0.5x to 2.0x)
- View distance (50 to 600 units)
- Fog near/far
- Environmental animations (enabled/disabled)
- Post-processing (outline, bloom, SMAA)
- FPS cap (30 for POWER_SAVING)
- Antialias

**Auto-adjustment algorithm:**
- Warmup period: 10 seconds after first world packet before any adjustment
- Quality up: FPS >= refreshRate - 1 for 5 consecutive seconds
- Quality down: FPS < min(30, refreshRate * 0.5) for 3 consecutive seconds
- Bounce protection: max 5 up/down oscillations before locking
- Mobile cap: MEDIUM max on mobile
- Auto levels: HIGH, MEDIUM, LOW only (ULTRA and POWER_SAVING are manual-only)
- Tab visibility check: skips adjustment when tab inactive

### 2.6 Performance Timeline Marks

**File:** `client/src/network/NetworkManager.ts` + `client/src/chunks/ChunkManager.ts`

Uses Performance API marks/measures for startup profiling (visible in browser DevTools Performance tab):
- `NetworkManager:connecting` -- mark at connection start
- `NetworkManager:connected` -- mark when connected
- `NetworkManager:connected-time` -- measure: connecting to connected
- `NetworkManager:world-packet-received` -- mark at first world packet
- `NetworkManager:connected-to-first-packet-time` -- measure: connected to first packet
- `NetworkManager:game-ready-time` -- measure: connecting to game ready
- `ChunkManager:first-chunk-batch-built` -- mark when first chunk batch is built
- `ChunkManager:first-chunk-batch-built-time` -- measure: connected to first chunk batch

### 2.7 RTT Measurement (Client Side)

**File:** `client/src/network/NetworkManager.ts`

- Sends SyncRequest every 2 seconds
- Receives SyncResponse with server processing time
- Calculates RTT: `clientReceiveTime - syncStartTime - serverProcessingTime`
- Exponential moving average with smoothing factor 0.5
- Tracks max RTT
- Displayed in debug panel RTT(ms) stats panel

### 2.8 Entity View Distance + Frustum Culling

**File:** `client/src/entities/Entity.ts` + `client/src/entities/EntityManager.ts`

- Per-entity view distance check using squared distance (avoids sqrt)
- Frustum culling tracked in EntityStats
- Update skipping for entities outside view distance
- Matrix update optimization: only updates local/world matrices when dirty

### 2.9 Chunk Worker (Web Worker Meshing)

**File:** `client/src/workers/ChunkWorker.ts`

- Chunk mesh building runs in a Web Worker (off main thread)
- Greedy meshing with ambient occlusion
- No explicit timing/profiling inside the worker itself

---

## 3. PROTOCOL PERFORMANCE SUPPORT

### 3.1 Debug Packets

**DebugConfig (inbound):** `protocol/packets/inbound/DebugConfig.ts` + `protocol/schemas/DebugConfig.ts`
- Schema: `{ pdr?: boolean }` -- toggles physics debug rendering
- Client sends this to enable/disable server-side debug render

**PhysicsDebugRender (outbound):** `protocol/packets/outbound/PhysicsDebugRender.ts`
- Sends collider wireframe vertices/colors per tick when enabled
- Very expensive -- for development only

**PhysicsDebugRaycasts (outbound):** `protocol/packets/outbound/PhysicsDebugRaycasts.ts`
- Sends raycast visualization data when debug raycasting enabled

### 3.2 Sync Request/Response (RTT)

- `SyncRequest` (inbound): null payload, triggers server timestamp capture
- `SyncResponse` (outbound): `{ r: number, s: number, p: number, n: number }`
  - `r` = server time at request receipt (Date.now())
  - `s` = server time at response (Date.now())
  - `p` = high-res processing time (ms)
  - `n` = ms until next server tick

### 3.3 Server Tick in Packets

All outbound packets include a `WorldTick` field (the current world loop tick count). This enables the client to reason about packet ordering and staleness.

---

## 4. SDK EXAMPLES WITH PERFORMANCE RELEVANCE

### 4.1 big-world

**File:** `sdk-examples/big-world/index.ts`

Explicit stress test: 750x750 block area (~2M+ blocks, thousands of chunks). Comments state it is "meant to showcase the performance of the server" and "benchmark and test client performance." No custom profiling code -- just loads a huge map and spawns players.

### 4.2 ark-game (WorldGenerator)

**File:** `sdk-examples/ark-game/src/generator/WorldGenerator.ts`

Has per-pass timing using `performance.now()`:
```
[Generator] Starting NxN world (seed: X)
[Generator] TerrainPass: Xms
[Generator] CavePass: Xms
...
[Generator] Complete: N blocks in Xms
```

---

## 5. PERFORMANCE DATA STRUCTURES

### 5.1 IterationMap

**File:** `server/src/shared/classes/IterationMap.ts`

Custom Map+Array hybrid for hot-path iteration. Maintains a backing `Map<K,V>` for O(1) lookups and a separate `V[]` array for fast iteration without `Map.values()` overhead. Used in all NetworkSynchronizer sync queues. Lazy dirty-flag array rebuild.

### 5.2 Connection Packet Cache

**File:** `server/src/networking/Connection.ts`

Static `Map<AnyPacket[], Buffer>` caches serialized packets by array identity. Encode-once, send-to-N optimization. Cleared each network sync cycle via `Connection.clearCachedPacketsSerializedBuffers()`.

---

## 6. GAPS IDENTIFIED

### 6.1 Server Gaps

1. **No local profiling without Sentry**: Telemetry.startSpan() is a no-op when Sentry is not initialized. There is NO built-in way to profile tick timing locally during development without setting up a Sentry DSN. The TICK_END event emits `tickDurationMs` but nothing aggregates or logs it.

2. **No tick budget tracking**: No system tracks what percentage of the ~16.67ms tick budget is consumed, or warns when ticks consistently exceed budget. The Ticker's `TICK_SLOW_UPDATE_CAP = 2` silently caps catch-up without logging.

3. **No per-entity cost attribution**: `ENTITIES_TICK` is one span for ALL entities. There is no way to identify which entity's `tick()` callback is expensive. No per-entity timing.

4. **No network bandwidth metrics**: Serialized byte count is recorded in Sentry span attributes but never aggregated or exposed. No per-player bandwidth tracking. No packet-rate counters.

5. **No console.time / console.timeEnd usage**: Zero instances of `console.time` in the server codebase. Developers must rely on Sentry or roll their own timing.

6. **No GC monitoring**: While `process.memoryUsage()` is captured in Telemetry.getProcessStats(), there is no GC event tracking (e.g., `--expose-gc` / `performance.measureUserAgentSpecificMemory()`). The GC-aware clearing in NetworkSynchronizer is based on experience, not measured.

7. **No entity count budget or scaling warnings**: Nothing warns the developer when entity counts or chunk counts approach limits that would degrade tick performance.

### 6.2 Client Gaps

1. **No frame time breakdown**: The client tracks FPS but does NOT break down frame time into components (render time, JS time, animation update time, network processing time, etc.). The DebugPanel shows subsystem counters but not timings.

2. **No GPU profiling**: No use of WebGL timer queries (`EXT_disjoint_timer_query`). The renderer tracks draw calls/triangles/geometries but not actual GPU milliseconds.

3. **No chunk meshing timing**: The ChunkWorker does greedy meshing in a Web Worker but has no timing instrumentation. Slow chunk builds are invisible.

4. **No memory trend tracking**: Memory is sampled once per frame but there is no leak detection, no trend analysis, no warning system for memory growth.

5. **No network jitter metrics**: RTT is tracked with exponential smoothing but there is no jitter calculation (variance of RTT), no packet loss counting, no out-of-order detection.

6. **No client-side Telemetry equivalent**: The client has no span/trace system. All client perf monitoring is ad-hoc (Stats.js panels + static counters).

7. **Stats classes are not time-series**: All Stats classes (EntityStats, ChunkStats, etc.) are instantaneous counters reset each frame. No historical data, no min/max/avg tracking, no percentiles.

8. **Quality auto-adjustment uses simple FPS threshold**: The algorithm only looks at whether FPS is above or below a threshold for N seconds. It does not consider frame time variance, GPU load, or thermal state.

9. **performance.memory is Chrome-only**: The memory tracking in PerformanceMetricsManager relies on `performance.memory` which is non-standard and Chrome-only. Firefox/Safari users get no memory data.

### 6.3 Protocol Gaps

1. **No performance telemetry packet**: There is no packet type for the server to send tick timing data to the client for display. The debug panel cannot show "server tick time: Xms" or "server entity count: N" because no packet carries that data.

2. **No client-to-server performance report**: The client cannot report its FPS, frame time, or quality level back to the server for server-side analytics.

### 6.4 SDK Examples Gaps

1. **big-world has no automated benchmark**: It loads a large world but has no timing, no entity stress test, no automated performance measurement. It's a manual "look at it and see if it's slow" test.

2. **No dedicated benchmark example**: No SDK example exercises entity spawning at scale, particle systems under load, or rapid block modifications to establish performance baselines.

---

## 7. SUMMARY TABLE

| System | Location | What it Measures | Trigger/Availability |
|--------|----------|-----------------|---------------------|
| Telemetry spans | server/src/metrics/Telemetry.ts | Tick subsystem durations | Only with Sentry DSN + slow tick |
| WorldLoop events | server/src/worlds/WorldLoop.ts | tickDeltaMs, tickDurationMs | Always (SDK event) |
| Simulation events | server/src/worlds/physics/Simulation.ts | stepDurationMs | Always (SDK event) |
| Process stats | server/src/metrics/Telemetry.ts | Heap, RSS memory | On Sentry error/slow tick |
| FPS | client/src/core/PerformanceMetricsManager.ts | Frames per second | Always |
| Memory | client/src/core/PerformanceMetricsManager.ts | JS heap (Chrome only) | Always |
| RTT | client/src/network/NetworkManager.ts | Round-trip latency | Every 2 seconds |
| WebGL stats | client/src/core/DebugPanel.ts | Draw calls, triangles, etc | When debug panel open |
| Entity stats | client/src/entities/EntityStats.ts | Count, culling, updates | Always (static counters) |
| Chunk stats | client/src/chunks/ChunkStats.ts | Count, faces, visibility | Always (static counters) |
| Quality auto-adjust | client/src/settings/SettingsManager.ts | FPS vs threshold | Always |
| Startup timeline | client/src/network/NetworkManager.ts | Connection-to-ready timing | On startup |
| Debug rendering | server/src/worlds/physics/Simulation.ts | Collider wireframes | Manual toggle (dev only) |
| Packet cache | server/src/networking/Connection.ts | Serialized buffer reuse | Always (implicit) |
