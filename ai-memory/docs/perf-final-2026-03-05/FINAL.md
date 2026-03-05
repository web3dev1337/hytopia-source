# HYTOPIA Performance (Client + Server) — Consolidated Findings (2026-03-05)

Base code reference for all “Verified” statements in this report:

- `origin/master` @ `24a295d` (2026-03-05)
- Repo: `web3dev1337/hytopia-source` (fork of `hytopiagg/hytopia-source`)

This is a synthesis of:

- **Code-verified findings** (client, server, protocol)
- **Your open performance PRs** on the fork
- **Imported third‑party notes** from Windows Downloads (`/mnt/c/Users/AB/Downloads`) captured on **2026-03-05 14:09–14:25** (local time) and stored under:
  - `ai-memory/docs/perf-external-notes-2026-03-05/raw/`
  - Cross-check doc: `ai-memory/docs/perf-external-notes-2026-03-05/FINDINGS.md`

---

## Executive Summary (What’s Actually Hurting Performance Today)

### P0 (highest impact, verified in code)

1) **Server → client chunk delivery is bursty and unbounded**
   - On **player join/reconnect**, the server queues **every chunk in the world** for that player (`NetworkSynchronizer._onPlayerJoinedWorld` loops `chunkLattice.getAllChunks()`), then sends them as chunk packets with **no pacing/segmentation**.
   - Every chunk is serialized with `Array.from(chunk.blocks)` (4096 numbers) which is extremely allocation-heavy and inflates payload sizes.

2) **Client chunk meshing is “per visible face”, not greedy**
   - Face culling exists, but there is **no quad merging / greedy meshing**, so vertex counts are much higher than necessary in common terrain.
   - This increases worker CPU, transfer sizes, main-thread mesh apply costs, GPU memory, and draw overhead.

3) **Client network decoding can block the main thread**
   - Incoming packets are synchronously gzip-decompressed (`gunzipSync`) and msgpack-decoded on the main thread.
   - Large chunk packets + sync decompression/decoding are a direct path to visible stutter.

4) **Client creates/destroys GPU geometry frequently**
   - Chunk batch updates replace `BufferGeometry` objects and dispose old ones rather than updating attributes in place (no pooling/reuse).

### P1 (medium/high impact, verified in code)

5) **Entity sync bandwidth is larger than it needs to be**
   - Entity pos/rot updates are float vectors/quaternions (float32) with no quantization or delta compression.
   - The server already routes pos/rot‑only updates to the unreliable channel, which is good, but payload size is still high.

6) **Protocol + serializer choices force avoidable copying**
   - `protocol/schemas/Chunk.ts`’s AJV JSON schema only accepts `b` as `number[]` (4096 entries), so the server serializes chunk blocks via `Array.from`.
   - The client then always does `new Uint8Array(chunk.b)`, which **copies** again.

### P2 (lower impact or situational, verified in code)

7) **View-distance culling work is O(batches) every frame**
   - Each frame, the client iterates all batch IDs and computes distances to decide scene membership.

8) **MEDIUM/LOW presets have no FPS cap; DPR is unbounded**
   - Only `POWER_SAVING` has an `fpsCap` on `master`.
   - Renderer pixel ratio uses `window.devicePixelRatio * resolution.multiplier` with no cap.

---

## Verified Issues (with Evidence + Recommended Fixes)

### 1) Server chunk sync: “full world on join” + no pacing (P0)

**Evidence (verified):**

- `server/src/networking/NetworkSynchronizer.ts`
  - `_onPlayerJoinedWorld`: queues chunk sync for **all chunks**:
    - `for (const chunk of this._world.chunkLattice.getAllChunks()) { ... chunk.serialize() ... }`
  - `_collectSyncToOutboundPackets`: turns queued chunk syncs into one packet per sync without pacing:
    - `protocol.createPacket(..., sync.valuesArray, tick)`

**Impact:**

- Server CPU + memory spikes on join/reconnect (serialize + validate + msgpack pack + gzip).
- Client stutters on receipt (sync gunzip + unpack + per-chunk registry + worker messages + mesh builds).
- Networking bursts can increase packet loss / HOL blocking (and increases likelihood of gzip work).

**Fix direction:**

- Implement **per-player chunk streaming**:
  - Maintain `playerVisibleChunkSet` (or batch set) derived from player position + view distance.
  - Queue only *newly visible* chunks; send removals when leaving range.
- Add **pacing/segmentation**:
  - Enforce a per-player per-tick budget (chunks, bytes, or ms).
  - Never enqueue “all chunks” into one `Chunks` packet; emit multiple smaller packets across ticks.

**Related (your PRs):**

- None directly address server chunk pacing today.
- PR #6 (map compression) reduces disk/map load size but does not solve network pacing.

**Related (external notes):**

- `VOXEL_PERFORMANCE_MASTER_PLAN.md`, `SMOOTH_WORLD_STREAMING_REFACTOR_PLAN.md` correctly push “chunk send pacing” as a requirement, but reference constants/systems that do not exist on `master`.

---

### 2) Server chunk serialization allocates huge arrays (P0)

**Evidence (verified):**

- `server/src/networking/Serializer.ts`
  - `serializeChunk()` does:
    - `b: Array.from(chunk.blocks)`
    - `r: Array.from(chunk.blockRotations).flatMap(...)`

**Impact:**

- For each chunk sent, allocates a 4096-element `number[]` (and then msgpack serializes it).
- For join sync, this multiplies by total chunk count and happens per joining player.

**Fix direction (high leverage):**

- Align protocol schema + serialization to allow `Uint8Array` “bin” payloads:
  - Update protocol schema validation to accept `Uint8Array` for `ChunkSchema.b` (and ideally send it).
  - Update client deserializer to **avoid copying** when `b` is already `Uint8Array`.
  - Goal: `ChunkSchema.b` transmitted as msgpack “bin” (compact, fast) instead of an array of numbers.

---

### 3) Server gzip is synchronous in the hot path (P0/P1)

**Evidence (verified):**

- `server/src/networking/Connection.ts`
  - `Connection.serializePackets()` uses `gzipSync` for payloads > 64KB.

**Impact:**

- Compression runs on the server main thread, causing tick spikes during large chunk flushes.

**Fix direction:**

- Reduce the need for gzip by shrinking payloads first (typed arrays for chunks, pacing).
- If gzip remains necessary:
  - Consider async compression (worker thread) or a different framing strategy.

---

### 4) Server validates packets with AJV before every send (P1)

**Evidence (verified):**

- `server/src/networking/Connection.ts`
  - `serializePackets()` calls `protocol.isValidPacket(packet)` for every packet, every send.

**Impact:**

- AJV validation of large payload packets (especially chunks) is CPU-expensive.

**Fix direction (safer than “turn it off”):**

- Cache validation results per packet object identity for the duration of a sync tick (similar to the serialization cache).
- Consider skipping deep validation for the heaviest, most-constructed packets in production builds, but only with strong safeguards (tests, feature flag).

---

### 5) Client chunk meshing lacks greedy quad merging (P0)

**Evidence (verified):**

- `client/src/workers/ChunkWorker.ts`
  - Per block → per face → if visible → emit quad.
  - Face culling exists (neighbor check); no 2D “merge rectangles” pass.
- External note cross-check: `ai-memory/docs/perf-external-notes-2026-03-05/FINDINGS.md`

**Impact:**

- Greatly increases:
  - Worker compute time
  - Geometry transfer sizes
  - Main thread BufferGeometry creation cost
  - GPU vertex processing and memory pressure

**Fix direction:**

- Implement greedy meshing for opaque solids first:
  - See external guide: `ai-memory/docs/perf-external-notes-2026-03-05/raw/GREEDY_MESHING_IMPLEMENTATION_GUIDE.md`
  - Keep transparent/liquid/trimesh paths per-face initially if needed.

**Notes on third-party docs:**

- The greedy meshing guidance is generally sound, but some example metrics and some “Implemented (Hytopia)” claims in `VOXEL_RENDERING_RESEARCH.md` do **not** match this repo’s `master`.

---

### 6) Client builds new BufferGeometry per update (P0/P1)

**Evidence (verified):**

- `client/src/chunks/ChunkMeshManager.ts`
  - `_createOrUpdateMesh()` always creates `new BufferGeometry()`.
  - On update, disposes old geometry and swaps in the new one.

**Impact:**

- GPU buffer churn + JS allocations during chunk streaming and block edits.

**Fix direction:**

- Reuse geometries:
  - Keep one `BufferGeometry` per batch mesh and update `BufferAttribute` arrays in place.
  - If size changes frequently, pool common sizes or chunk updates into fixed “slabs”.

---

### 7) Client network decode is synchronous on main thread (P0)

**Evidence (verified):**

- `client/src/network/NetworkManager.ts`
  - `gunzipSync` (fflate) used for gzip payloads before `packr.unpack`.

**Impact:**

- Large chunk packets can block the render thread causing frame hitches.

**Fix direction:**

- Move decompression + unpacking off the main thread (net worker).
- Reduce/avoid gzip by shrinking chunk payloads (typed arrays, pacing).

---

### 8) Client deserialization does extra copying + allocations (P1)

**Evidence (verified):**

- `client/src/network/Deserializer.ts`
  - `deserializeChunk`: `blocks: chunk.b ? new Uint8Array(chunk.b) : undefined` → always copies.
  - `deserializeVector` / `deserializeQuaternion`: allocate new objects per update.

**Impact:**

- Additional CPU/GC pressure on the main thread during frequent updates.

**Fix direction:**

- Avoid copying `Uint8Array` when already typed.
- For hot-path entity updates, consider:
  - Updating existing entity objects in place with primitives/typed arrays
  - A new bulk packet format (structure-of-arrays) for pos/rot

---

### 9) Client view-distance culling does per-frame full scans (P2)

**Evidence (verified):**

- `client/src/chunks/ChunkManager.ts`
  - Each `RendererEventType.Animate` iterates all batch IDs and computes distance.
  - Comment notes it may be costly and suggests caching/partitioning.

**Impact:**

- Becomes noticeable as batch count grows (CPU time per frame).

**Fix direction:**

- Cache visibility and recompute only when:
  - camera moves across coarse “cells”
  - settings change (view distance)
  - batch set changes
- Your PR #9 (upstream mirror) targets this area.

---

### 10) FPS cap + DPR cap missing on `master` (P2 quick wins)

**Evidence (verified):**

- `client/src/settings/SettingsManager.ts`
  - Only `POWER_SAVING` has `fpsCap: 30`.
  - `MEDIUM` / `LOW` have none.
- `client/src/core/Renderer.ts`
  - pixel ratio uses `window.devicePixelRatio * resolution.multiplier` with no cap.

**Fix direction (already in your PRs):**

- PR #4: adds `fpsCap: 60` for `MEDIUM`/`LOW`.
- PR #5: caps mobile `devicePixelRatio` before applying multiplier.

---

## Entity Sync: What’s Right + What’s Missing (Verified)

### What’s already good

- `server/src/networking/NetworkSynchronizer.ts`:
  - Pos/rot-only entity updates are identified and sent on the **unreliable** channel.
  - This reduces HOL blocking under packet loss.

### What’s missing (main opportunities)

- No quantized or delta formats exist in the protocol today (`protocol/schemas/Entity.ts` only has `p` and `r`).
- No distance-based sync LOD.

### External note accuracy

- `ENTITY_SYNC_DELTA_COMPRESSION_DESIGN.md` contains good direction (quantize/distance-LOD), but its **int16 range math is wrong** when using a 1/256 quantization factor.
  - If you store `round(x * 256)` in int16, the representable range is roughly **±128 blocks**, not ±32768.
  - If you want large-world range and fine precision, use chunk-relative encoding and/or wider ints (int32) and/or a different quant.

---

## Colliders / Physics: What’s Real vs. What’s Assumed

### Verified current collider model

- `server/src/worlds/blocks/ChunkLattice.ts`
  - Maintains colliders per **block type** (voxel or trimesh).
  - Voxel updates use `collider.setVoxel(...)` + `propagateVoxelChange(...)`.
  - Trimesh block types trigger full collider rebuild on changes (`_recreateTrimeshCollider`).
- `server/src/worlds/physics/Collider.ts`
  - `combineVoxelStates` / `propagateVoxelChange` are Rapier-specific voxel-collider edge/transition requirements, not “merge placements” loops.

### What the external notes get right

- Trimesh rebuilds can be expensive as block counts grow.
- “Collider locality” (only simulate nearby blocks) is a valid scaling approach for very large worlds, but it is **not implemented** in this repo today.

### What the external notes get wrong (relative to this repo)

- Multiple notes reference systems/constants that do not exist on `master`:
  - `CHUNKS_PER_TICK`, `MAX_CHUNKS_PER_SYNC`, `TerrainWorkerPool`, `PersistenceChunkProvider`, `RegionFileFormat.ts`, `COLLIDER_MAX_CHUNK_DISTANCE`, `processPendingColliderChunks`, etc.

---

## Your Performance PRs (Fork) — What They Address

All PRs below are on `web3dev1337/hytopia-source` as of **2026-03-05**.

- **#4** “cap FPS on MEDIUM/LOW presets” (OPEN) — adds `fpsCap: 60` to `MEDIUM`/`LOW`.
- **#5** “cap mobile devicePixelRatio” (OPEN) — clamps mobile DPR before applying resolution multiplier.
- **#6** “compressed world maps” (OPEN) — reduces map disk size + load time for JSON-map games; not a direct fix for chunk networking.
- **#7–#9** upstream mirrors (OPEN) — prediction/camera smoothing/client perf pass (chunk visibility caching + outline improvements in #9).
- **#2–#3** analysis docs (OPEN) — large audits and device-specific performance writeups.

This consolidated report focuses on the *root* hot paths on `master` (#4/#5/#9/#6 are relevant solutions for specific slices).

---

## Third-Party Notes: What’s Correct vs Incorrect (Index)

All files referenced below are imported under `ai-memory/docs/perf-external-notes-2026-03-05/raw/`.

### Mostly correct about THIS repo (good signal)

- `MAP_ENGINE_ARCHITECTURE.md` — accurately describes the JSON map → `World.loadMap` → `ChunkLattice` → `NetworkSynchronizer` flow.
- `GREEDY_MESHING_IMPLEMENTATION_GUIDE.md` — sound generic greedy meshing guidance (implementation work remains).
- `NETWORK_PROTOCOL_2026_RESEARCH.md` — good general direction, but contains quantization math errors (see above).

### Mixed (some correct observations + some incorrect assumptions)

- `VOXEL_RENDERING_RESEARCH.md` — correct on face culling present / greedy meshing absent; incorrect “Implemented (Hytopia)” section that does not match `master`.
- `COLLIDER_ARCHITECTURE_RESEARCH.md` — correct high-level collider structure (per block type); incorrect about some “critical path” details and assumes locality/pipelines not present.
- `ENTITY_SYNC_DELTA_COMPRESSION_DESIGN.md` — correct about current entity sync shape; useful ideas; incorrect numeric range claims for int16@1/256.

### Mostly not about THIS repo (assumes systems not present)

- `VOXEL_PERFORMANCE_MASTER_PLAN.md`
- `SMOOTH_WORLD_STREAMING_REFACTOR_PLAN.md`
- `VOXEL_ENGINE_2026_MASTER_PLAN.md`
- `MINECRAFT_ARCHITECTURE_RESEARCH.md` (Minecraft info is fine; claims about Hytopia’s procedural systems don’t match this repo)

---

## Recommended Plan (Grounded in Current Code)

### Phase A — immediate wins (days)

1) Merge **PR #4** (FPS cap) and **PR #5** (mobile DPR cap).
2) Stop copying chunk blocks twice:
   - Update client `Deserializer.deserializeChunk` to avoid `new Uint8Array(...)` when `b` is already `Uint8Array`.
   - Update protocol + server serializer to send chunk blocks as `Uint8Array` (bin).
3) Implement chunk pacing on join:
   - Replace “queue all chunks” join behavior with a time/byte budget.

### Phase B — largest structural wins (1–2 weeks)

4) Implement per-player chunk streaming by view distance (server side).
5) Move client decompress+unpack off main thread (or reduce gzip needs enough that it rarely triggers).

### Phase C — rendering ceiling (2–4+ weeks)

6) Implement greedy meshing for opaque solids in `ChunkWorker`.
7) Geometry reuse / pooling in `ChunkMeshManager`.
8) Improve view-distance culling algorithm (or merge upstream PR #11 mirror if acceptable).

---

## Where to Find the “Proof / Verification” Doc

- Verification of external-note claims against `origin/master` lives in:
  - `ai-memory/docs/perf-external-notes-2026-03-05/FINDINGS.md`

---

## Performance Framework (this PR branch) — Review + Merge Blockers

This section reviews the “performance framework” implementation added in PR #11 (server module + `packages/perf-tools/` + GitHub Actions).

### What’s real and useful today (server-side)

- **`PerformanceMonitor` exists and is integrated** into the tick loop:
  - `server/src/metrics/PerformanceMonitor.ts` implements tick history, per-operation stats (p50/p95/p99), spike detection, and periodic snapshots.
  - `server/src/worlds/WorldLoop.ts` calls `beginTick()` / `recordPhase()` / `endTick()` when enabled.
- **Decorators/helpers exist**:
  - `server/src/metrics/Monitor.ts` adds `@Monitor` / `@MonitorClass` + `monitorBlock` helpers.
- **CPU/heap capture exists (debug tooling)**:
  - `server/src/metrics/CpuProfiler.ts` uses `node:inspector` to capture `.cpuprofile` and heap snapshots.
- **Bots exist** (useful for stress testing once the harness is wired):
  - `server/src/bots/*` exports `BotManager`, `BotPlayer`, and behaviors.

### What’s missing / incorrect vs the PR summary (must fix)

1) **Operation timings are currently double-counted**
   - When `PerformanceMonitor` is enabled, `Telemetry.startSpan()` wraps operations in `perfMon.measure(...)`.
   - `WorldLoop` also calls `perfMon.recordPhase(...)` for the same operation names (`entities_tick`, `simulation_step`, `network_synchronize`, etc.).
   - Result: per-operation percentiles/averages in `PerformanceMonitor` are inflated and misleading.

2) **`NetworkMetrics` is not actually integrated**
   - `server/src/metrics/NetworkMetrics.ts` is exported, but nothing calls `recordBytesSent/Received`, `recordPacketSent/Received`, etc.
   - As written, it stays at zero unless a game manually wires it into networking.

3) **`packages/perf-tools/` is not runnable end-to-end yet**
   - **CI will fail immediately**: workflows run `npm ci` in `packages/perf-tools/`, but there is no `package-lock.json`.
   - **CLI preset loading likely breaks at runtime**: uses `import.meta.dirname` (Node uses `import.meta.url` + `fileURLToPath`).
   - **Scenario actions are placeholders**: `spawn_bots`, `load_map`, etc. only log “would execute via server API”.
   - **Server metrics aren’t collected**: `MetricCollector` supports server snapshots, but the runner never pulls them from the server.
   - **Client metrics assume missing instrumentation**: `HeadlessClient` reads `window.__HYTOPIA_PERF__`, which the client does not currently define.

4) **The GitHub Actions workflows aren’t a “gate” yet**
   - Bench steps are `continue-on-error: true`, and compare uses `|| true`, so regressions won’t fail the job even if the tooling worked.
   - Baseline update also treats benchmark failures as non-fatal, which risks caching empty/invalid baselines.

### Minimal path to make this framework usable

If you want this PR to be mergeable as a framework (not just scaffolding), the smallest concrete checklist is:

- Fix the double-counting: pick **one** source of truth (either `recordPhase` or `Telemetry.startSpan` → `perfMon.measure`) for operation timing.
- Wire `NetworkMetrics` into `server/src/networking/Connection.ts` and/or `NetworkSynchronizer.ts`.
- Make `perf-tools` installable and runnable in CI:
  - add a lockfile and keep `npm ci`, or switch workflows to `npm install`.
  - fix preset path resolution (`import.meta.url`).
- Define a real metrics channel:
  - either expose `PerformanceMonitor.getSnapshot()` via an HTTP debug endpoint, or log JSON snapshots to stdout and parse them.
  - add a client-side hook for `HeadlessClient` (even a minimal `window.__HYTOPIA_PERF__ = { fps, ... }` populated from existing managers).
- Make the workflows enforce regressions (remove `continue-on-error` / `|| true` once results are trustworthy).

### Naming/hygiene

- This branch contains an internal notes folder name that should be renamed to a neutral label before merging.

---

## Test Coverage (What Was Actually Run)

This section is a factual log of what was executed against the current PR #11 branch state.

### Server runtime smoke test (engine boot + tick + bots)

- Built `server/src/index.ts` with Bun and executed it with Node (local dev runtime).
- Started the engine via `startServer(...)`.
- Loaded `assets/release/maps/boilerplate-small.json`.
- Enabled profiling with one line: `PerformanceMonitor.instance.enable({ snapshotIntervalMs: 0 })`.
- Enabled per-entity profiling: `PerformanceMonitor.instance.enableEntityProfiling(true)`.
- Spawned **25 bots** using `BotManager.instance.spawnBots(...)` with `RandomWalkBehavior`.
- Observed ongoing `PerformanceMonitorEvent.TICK_REPORT` events and captured a snapshot after ~5s post-start:
  - `avgTickMs=0.252`, `p95TickMs=0.382`, `p99TickMs=0.550`, `maxTickMs=12.509`, `ticksOverBudget=0`, `totalTicks=301` (0 players connected).

### Bugs found during the smoke test

- Bot spawning triggered recoverable runtime errors from `RigidBody.setEnabledRotations()` when bots use a non-dynamic rigid body type.
  - Fixed by only applying `enabledRotations` when the bot rigid body type is `DYNAMIC`.

### Client build check

- `client` production build passed (`tsc` + `vite build`) after removing an unused local in `client/src/network/NetworkManager.ts`.

### Not tested / not runnable end-to-end yet

- No `sdk-examples/*` games were run.
- No real client gameplay session was connected to the server (so join/reconnect chunk streaming and networking hot paths were not exercised).
- `packages/perf-tools` CLI and GitHub Actions “perf gate” workflows were **not** run successfully as an end-to-end benchmark, because the tooling does not yet collect real server/client metrics and has install/runtime issues described above.

### Environment limitations observed

- WebTransport http3-quiche native addon was not available in this environment, so WebTransport/QUIC wasn’t exercised (server still started with fallback behavior).
