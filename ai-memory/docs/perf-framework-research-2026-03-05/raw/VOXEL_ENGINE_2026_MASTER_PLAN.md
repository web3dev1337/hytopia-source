# Voxel Engine 2026: World-Class Performance Master Plan

**Document Owner:** Head of Development  
**Classification:** Engineering Roadmap  
**Target:** Minecraft/Hytale-grade smoothness; browser-first, 2026-ready  
**Version:** 1.0  
**Date:** March 2026

---

## Executive Summary

Hytopia aims to deliver voxel gameplay that feels as smooth and responsive as Minecraft and Hytale, while running in the browser. The current architecture has solid foundations—async chunk loading, worker terrain generation, deferred colliders—but several bottlenecks prevent parity with industry leaders. This plan addresses those gaps with a phased, research-backed approach that delivers measurable improvements without over-engineering.

**Key thesis:** The lag and stutter are almost entirely **software architecture** issues, not hardware. Minecraft and Hytale run smoothly on similar hardware because they use different patterns. We close the gap by adopting those patterns.

**Target outcome:** Walk/fly through a procedural world with **no perceptible lag spikes** within the preload radius, **stable 60 FPS** on the client, and **<16 ms server tick times** (p99).

---

## Part 1: Strategic Context

### 1.1 Industry Benchmark: What “On Par” Means

| Game | Chunk Load | Physics | Rendering | Network | Notes |
|------|------------|---------|-----------|---------|-------|
| **Minecraft Java** | Worker threads, region format | Per-chunk colliders, deferred | Greedy meshing (approximate), occlusion | Delta/delta-like entity sync | 15+ years of iteration |
| **Minecraft Bedrock** | Async pipeline, priority queue | Spatial partitioning | Meshing + LOD | Variable tick rate by distance | C++ / C#; mobile-first |
| **Hytale** | Worker pool, variable chunk sizes | Batched, spatial | Mesh culling, LOD | QUIC, lower latency | Modern engine, Flecs ECS |
| **Bloxd.io** | Browser streaming | Custom voxel physics | Face culling, vertex pooling | JS-based | Browser-only |

**Hytopia’s position:** We are browser-bound (Node server + Web client). We can’t use C++ or multiple cores on the client, but we *can* adopt the same *concepts*: async I/O, spatial locality, greedy meshing, quantized network formats, and time-budgeted main-thread work.

### 1.2 Gap Analysis (Prioritized)

| Priority | Gap | Impact | Root Cause |
|----------|-----|--------|------------|
| P0 | Collider work O(world) | Tick spikes, unplayable under load | `_combineVoxelStates` scans all chunks of each block type |
| P0 | No greedy meshing | 2–64× more vertices than needed | Per-face quads, no merging |
| P1 | Entity sync volume | ~90% of packets | Full pos/rot floats, no quantization |
| P1 | Sync chunk persist | Main-thread blocking | `writeChunk` sync |
| P2 | No occlusion culling | Overdraw in caves | All loaded batches rendered |
| P2 | No distance-based entity LOD | Far entities same cost as near | Single sync rate |
| P3 | Vertex allocation churn | GC spikes on mesh updates | No pooling |

---

## Part 2: Phased Roadmap

### Phase 0: Foundation & Instrumentation (Week 1)

**Goal:** Establish baselines and guardrails before major refactors.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Profiling hooks | Eng | Tick duration, chunk load time, collider time, mesh build time |
| Metrics dashboard | Eng | Real-time charts for key metrics |
| Block/face limits | Eng | Hard cap (e.g. 500K faces) to avoid meltdown |
| Regression suite | QA | Automated “fly-through” test, capture tick/frame times |

**Success:** We can measure and reproduce performance issues in CI and on-device.

---

### Phase 1: Collider Locality (Weeks 2–3)

**Goal:** Remove O(world) collider scans. Physics and chunk work must scale with **visible/nearby** chunks only.

| Task | Effort | Description |
|------|--------|-------------|
| Spatial index for block placements | 3 days | Chunk key → block placements; no global iteration |
| Scoped `_combineVoxelStates` | 2 days | Merge only chunks within N chunks of any player |
| Collider unload for distant chunks | 1 day | Remove colliders when chunk unloads; don’t keep in physics |
| Time-budget verification | 0.5 day | Ensure 8 ms cap is respected; tune if needed |

**Files:** `ChunkLattice.ts`, `playground.ts`

**Success:** Tick time (p99) drops from 50–200 ms to <25 ms under typical load.

---

### Phase 2: Main-Thread Freedom (Weeks 4–5)

**Goal:** No sync blocking on I/O or heavy computation on the game loop.

| Task | Effort | Description |
|------|--------|-------------|
| Async `persistChunk` | 1.5 days | Queue writes; flush in background |
| Async provider audit | 0.5 day | Confirm `requestChunk` → `getChunkAsync` path is used |
| Incremental voxel collider updates | 4 days | Add blocks in batches (256–512/tick) instead of full chunk |
| Chunk send pacing | 1.5 days | Smooth chunk sync; avoid burst of 8 chunks in one tick |

**Files:** `PersistenceChunkProvider.ts`, `RegionFileFormat.ts`, `ChunkLattice.ts`, `NetworkSynchronizer.ts`

**Success:** Chunk load + persist never block tick; no “catch up” spikes.

---

### Phase 3: Entity Sync Compression (Weeks 6–7)

**Goal:** Reduce entity pos/rot from ~90% of packets to <50%, with no perceptible quality loss.

| Task | Effort | Description |
|------|--------|-------------|
| Quantized position (1/256 block, 16-bit) | 1 day | Server sends `pq`; client decodes |
| Yaw-only rotation for players | 0.5 day | 1 float vs 4 for player avatars |
| Distance-based sync rate (30/15/5 Hz) | 1 day | Near = 30 Hz, mid = 15 Hz, far = 5 Hz |
| Quantized quaternion (smallest-three) | 2 days | For NPCs and other full-rotation entities |
| Bulk pos/rot packet (optional) | 2 days | Structure-of-arrays for unreliable updates |

**Files:** `Serializer.ts`, `NetworkSynchronizer.ts`, `protocol/schemas/Entity.ts`, `Deserializer.ts`, `EntityManager.ts`

**Success:** Entity sync bytes/update reduced by 50–60%; bandwidth share <50%.

---

### Phase 4: Greedy Meshing (Weeks 8–10)

**Goal:** Cut vertex count by 2–64× for typical terrain; stable 60 FPS on chunk load.

| Task | Effort | Description |
|------|--------|-------------|
| Greedy mesh algorithm (opaque solids) | 5 days | 0fps-style sweep and merge; ref `docs/research/GREEDY_MESHING_IMPLEMENTATION_GUIDE.md` |
| Integration with ChunkWorker | 2 days | Per-batch-type merge; transparent blocks unchanged |
| AO + lighting on merged quads | 1 day | Ensure ambient occlusion and lighting still apply |
| Benchmarks and tuning | 1 day | Measure build time vs vertex reduction |

**Files:** `ChunkWorker.ts`, `ChunkMeshManager.ts`

**Success:** Flat chunk: ~6000 vertices → ~200–500; frame time stable on new chunk load.

---

### Phase 5: Render Pipeline Polish (Weeks 11–13)

**Goal:** GPU efficiency and graceful degradation on low-end devices.

| Task | Effort | Description |
|------|--------|-------------|
| Vertex pooling | 2 days | Reuse BufferGeometry/ArrayBuffers; avoid per-frame allocations |
| Occlusion culling always-on | 2 days | BFS from camera; cull hidden batches |
| Mesh apply budget | 1 day | Limit meshes applied per frame; spread load |
| Block/face limits enforcement | 0.5 day | Reduce view distance when over cap |

**Files:** `ChunkMeshManager.ts`, `ChunkManager.ts`, `ChunkWorker.ts`, `Renderer.ts`

**Success:** No GC spikes on chunk load; overdraw reduced in cave-heavy areas.

---

### Phase 6: Long-Term (Month 4+)

| Task | Impact | Effort |
|------|--------|--------|
| LOD impostors for distant chunks | Medium | 2–3 weeks |
| Brotli (or similar) for region payloads | Low | 1 week |
| Predictive chunk preload | Medium | 1 week |
| Client-side entity prediction | Medium (latency) | 2+ weeks |

---

## Part 3: Research Documentation

The following research docs support implementation and design decisions:

| Document | Purpose |
|----------|---------|
| [MINECRAFT_ARCHITECTURE_RESEARCH.md](./research/MINECRAFT_ARCHITECTURE_RESEARCH.md) | How Minecraft structures chunk loading, colliders, and meshing |
| [GREEDY_MESHING_IMPLEMENTATION_GUIDE.md](./research/GREEDY_MESHING_IMPLEMENTATION_GUIDE.md) | Step-by-step greedy meshing for ChunkWorker |
| [COLLIDER_ARCHITECTURE_RESEARCH.md](./research/COLLIDER_ARCHITECTURE_RESEARCH.md) | Spatial locality and incremental colliders |
| [NETWORK_PROTOCOL_2026_RESEARCH.md](./research/NETWORK_PROTOCOL_2026_RESEARCH.md) | Modern entity sync: quantization, delta, LOD |

**Mandate:** Engineers implementing Phase 2+ work must read the relevant research doc before coding.

---

## Part 4: Success Metrics

| Metric | Baseline (Current) | Phase 3 Target | Phase 6 Target |
|--------|--------------------|----------------|----------------|
| Server tick time (p99) | 50–200 ms | <25 ms | <16 ms |
| Chunk load (blocking) | 20–100 ms | 0 (async) | 0 |
| Vertices per flat chunk | ~6000 | ~200–500 | ~200–500 |
| Entity sync % of packets | ~90% | ~60% | <50% |
| Client frame time (p99) | Spikes to 50+ ms | <25 ms | <16 ms |
| Perceived lag spikes | Every ~5 steps | None in preload | None |

---

## Part 5: Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Greedy meshing regresses build time | Time-budget; fallback to non-greedy if over budget |
| Protocol changes break old clients | Backward-compatible optional fields; version handshake |
| Collider refactor introduces physics bugs | Rigorous test: spawn, walk, mine, place; compare before/after |
| Scope creep | Phases are fixed; Phase 6 is explicitly “long-term” |

---

## Part 6: Dependencies & Prerequisites

- **PR #21 (Compressed JSON maps):** Merge for JSON-map games; not blocking procedural world.
- **TerrainWorkerPool:** Already in place; verify `getChunkAsync` is used in playground.
- **Protocol package:** Schema changes require protocol version bump; coordinate with SDK consumers.
- **Browser support:** Target evergreen browsers; no polyfills for cutting-edge APIs.

---

## Part 7: Sign-Off

This plan represents a realistic path to Minecraft/Hytale-grade smoothness for Hytopia’s procedural world. It prioritizes the highest-impact bottlenecks (colliders, greedy meshing, entity sync) and defers nice-to-haves (LOD impostors, prediction) to later phases.

**Recommendation:** Approve and execute Phase 0–1 immediately. Re-evaluate after Phase 3 based on metrics and user feedback.

---

*— Head of Development*
