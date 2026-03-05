# Smooth World Streaming Refactor Plan

> **Canonical roadmap:** See [VOXEL_ENGINE_2026_MASTER_PLAN.md](./VOXEL_ENGINE_2026_MASTER_PLAN.md) for the full executive plan and phased roadmap. This document provides additional context and cross-references.

**Goal:** Peak performance for the procedurally generated world—smooth streaming, no lag spikes, Minecraft/Hytale/bloxd-level polish.

**Sources:** Codebase analysis, [VOXEL_PERFORMANCE_MASTER_PLAN.md](./VOXEL_PERFORMANCE_MASTER_PLAN.md), [CHUNK_LOADING_ARCHITECTURE.md](./CHUNK_LOADING_ARCHITECTURE.md), [VOXEL_RENDERING_RESEARCH.md](./VOXEL_RENDERING_RESEARCH.md), [PR #21](https://github.com/hytopiagg/hytopia-source/pull/21), and industry patterns from Minecraft, Hytale, and Bloxd.

---

## 1. Competitive Analysis: Minecraft vs Hytale vs Bloxd vs Hytopia

| Aspect | Minecraft | Hytale | Bloxd | Hytopia (Current) |
|--------|-----------|--------|-------|-------------------|
| **Chunk load** | Worker threads, async | Worker pool | JS async | ✅ `requestChunk` + `getChunkAsync` (TerrainWorkerPool) |
| **File I/O** | Async | Async | N/A (streaming) | ✅ `readChunkAsync` (PersistenceChunkProvider) |
| **Terrain gen** | Worker threads | Worker pool | — | ✅ `generateChunkAsync` (TerrainWorkerPool) |
| **Physics colliders** | Deferred, O(chunk) | Batched, spatial | Custom voxel | ❌ Sync, O(world) via `_combineVoxelStates` |
| **Collider locality** | Per-chunk, near player | Spatial culling | — | ⚠️ Partial (COLLIDER_MAX_CHUNK_DISTANCE=3) |
| **Greedy meshing** | ✅ | ✅ (mesh culling) | ✅ | ❌ 1 quad/face, ~64× extra geometry |
| **Chunk send rate** | Incremental, rate-limited | Batched | Streaming | ⚠️ MAX_CHUNKS_PER_SYNC=8, can burst |
| **Entity sync** | Delta / compressed | — | — | Full pos/rot 30 Hz, 90%+ of packets |
| **LOD** | ✅ | Variable chunk sizes | — | ✅ (step 2/4) |
| **Occlusion** | Cave culling | Partial | — | ⚠️ Only when over face limit |
| **Vertex pooling** | — | — | ✅ | ⚠️ Partial (size-match reuse) |
| **Map compression** | Region format | — | — | ❌ JSON maps large; PR #21 adds compression |

**Gap summary:** Hytopia’s biggest gaps are (1) collider work O(world) and sync, (2) no greedy meshing, (3) entity sync volume, (4) JSON map size for non-procedural games. Procedural world already uses async load + worker terrain gen; collider and client-side mesh work are the main bottlenecks.

---

## 2. PR #21 Relevance to Procedural World

[PR #21: Compressed world maps](https://github.com/hytopiagg/hytopia-source/pull/21) targets **JSON maps** (`loadMap(map.json)`), not procedural/region worlds. It adds:

| Feature | Applies to Procedural? | Notes |
|---------|------------------------|-------|
| `map.compressed.json` | ❌ | JSON map format only |
| `map.chunks.bin` (chunk cache) | ❌ | Prebaked JSON map chunks |
| Chunk cache collider build | ⚠️ Partially | “perf: speed up chunk cache collider build” can inform collider design |
| Brotli compression | ❌ | For map JSON, not region .bin |
| Auto-detect / `hytopia map-compress` | ❌ | JSON map workflow |

**Recommendation:** Merge PR #21 for JSON-map games (huntcraft, boilerplate, etc.). For procedural world, reuse the collider build approach where relevant. Procedural persistence uses region `.bin`; consider Brotli for region payloads later.

---

## 3. Root Cause Summary

When a player joins and blocks have physics:

1. **Physics step (60 Hz):** Rapier steps the entire world, including all block colliders + player rigid body.
2. **Collider creation:** `_addChunkBlocksToColliders` → `_combineVoxelStates` scans all chunks of each block type (O(world)).
3. **Entity sync (30 Hz):** Full position/rotation for entities/players every 2 ticks; dominates packet volume.
4. **Chunk sync:** Up to 8 chunks per sync; client mesh build can spike main thread.
5. **Client mesh:** No greedy meshing → 2–64× more vertices than needed.
6. **ADD_CHUNK events:** Environmental entity spawn per chunk runs synchronously.

---

## 4. Refactoring Plan (Prioritized)

### Phase 1: Stop the Bleeding (1–2 weeks)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 1.1 | **Collider locality – spatial index** | High | 3–5 days | `ChunkLattice.ts` |
| 1.2 | **Scoped `_combineVoxelStates`** | High | 2–3 days | `ChunkLattice.ts` |
| 1.3 | **Time-budget collider processing** | Medium | ✅ Done | `playground.ts` |
| 1.4 | **CHUNKS_PER_TICK = 3** | ✅ Done | — | `playground.ts` |
| 1.5 | **Defer environmental entity spawn** | Medium | 1 day | `playground.ts` |

**1.1–1.2:** Replace global scans with spatial indexing. `_getBlockTypePlacements` and `_combineVoxelStates` should only consider chunks within a radius (e.g. 4–5 chunks) of any player. Add a spatial index (e.g. chunk key → block placements) and only merge voxel state for nearby chunks.

### Phase 2: Main Thread Freedom (2–3 weeks)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 2.1 | **Async persistChunk** | Medium | 1–2 days | `PersistenceChunkProvider.ts`, `RegionFileFormat.ts` |
| 2.2 | **Worker terrain gen verification** | — | 0.5 day | `TerrainWorkerPool.ts`, `ProceduralChunkProvider.ts` |
| 2.3 | **Incremental voxel collider updates** | High | 3–5 days | `ChunkLattice.ts` |
| 2.4 | **Chunk send pacing** | Medium | 1–2 days | `NetworkSynchronizer.ts` |

**2.1:** `persistChunk` currently calls `writeChunk` (sync). Move to async; queue writes and process in background.

**2.3:** Add blocks to voxel colliders in batches (e.g. 256–512/tick) instead of full chunk. Use Rapier voxel API if it supports incremental updates.

### Phase 3: Network & Sync (2–3 weeks)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 3.1 | **Entity delta/compression** | High | 5–7 days | `NetworkSynchronizer.ts`, `Serializer.ts`, protocol |
| 3.2 | **Chunk delta updates** | Medium | 3–4 days | `NetworkSynchronizer.ts`, `ChunkLattice` |
| 3.3 | **Predictive chunk preload** | Medium | 2–3 days | `playground.ts` |

**3.1:** Send position/rotation deltas or use quantized floats. Reference: Minecraft’s entity compression, Hytale’s QUIC usage.

### Phase 4: Client Render Pipeline (3–4 weeks)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 4.1 | **Greedy meshing (quad merging)** | Very high | 5–7 days | `ChunkWorker.ts` |
| 4.2 | **Vertex pooling** | Medium | 2–3 days | `ChunkMeshManager.ts`, `ChunkWorker.ts` |
| 4.3 | **Occlusion culling always-on** | Medium | 2–3 days | `ChunkManager.ts`, `Renderer.ts` |
| 4.4 | **Mesh apply budget** | Low | 1 day | `ChunkManager.ts` |

**4.1:** Implement 0fps-style greedy meshing for opaque solids. Merge adjacent same-type faces; expect 2–64× fewer vertices. References: [0fps](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/), [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher).

### Phase 5: Long-Term & Polish (ongoing)

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 5.1 | LOD impostors for distant chunks | Medium | 2–3 weeks |
| 5.2 | Brotli for region .bin payloads | Low | 1 week |
| 5.3 | Block/face limits (safety cap) | Low | &lt;1 day |
| 5.4 | Profiling hooks (tick, chunk, mesh) | Low | 2–3 days |

---

## 5. Implementation Order

```
Week 1–2:   Phase 1 (collider locality, scoped _combineVoxelStates, defer env spawn)
Week 3–4:   Phase 2 (async persistChunk, incremental voxel, chunk send pacing)
Week 5–6:   Phase 3 (entity delta, chunk delta, predictive preload)
Week 7–10:  Phase 4 (greedy meshing, vertex pooling, occlusion)
Ongoing:    Phase 5
```

---

## 6. Success Metrics

| Metric | Current (Est.) | Target |
|--------|----------------|--------|
| Lag spikes when walking | Every ~5 steps | None within preload radius |
| Server tick time (p99) | 50–200 ms | &lt; 16 ms |
| Chunk load (blocking) | 20–100 ms | &lt; 5 ms (async) |
| Vertices per flat chunk | ~6000 | ~200–500 (greedy) |
| Client frame time | Spikes on new chunks | Stable ~16 ms (60 fps) |
| Entity packet share | ~90% | &lt; 50% (delta/compression) |

---

## 7. Key Files Reference

| Component | Path |
|-----------|------|
| Chunk load loop | `server/src/playground.ts` |
| Collider processing | `server/src/worlds/blocks/ChunkLattice.ts` |
| Physics simulation | `server/src/worlds/physics/Simulation.ts` |
| Mesh generation | `client/src/workers/ChunkWorker.ts` |
| Chunk sync | `server/src/networking/NetworkSynchronizer.ts` |
| Region I/O | `server/src/worlds/maps/RegionFileFormat.ts` |
| Terrain gen | `server/src/worlds/maps/TerrainGenerator.ts`, `TerrainWorkerPool.ts` |
| Procedural provider | `server/src/worlds/maps/ProceduralChunkProvider.ts` |
| Persistence provider | `server/src/worlds/maps/PersistenceChunkProvider.ts` |
| World loop | `server/src/worlds/WorldLoop.ts` |

---

## 8. PR #21 Action Items

1. **Merge PR #21** for JSON-map games (boilerplate, huntcraft, etc.).
2. **Reuse chunk cache collider patterns** in `ChunkLattice` if applicable.
3. **Later:** Consider Brotli for region payloads or a similar compression layer.

---

## 9. References

- [VOXEL_PERFORMANCE_MASTER_PLAN.md](./VOXEL_PERFORMANCE_MASTER_PLAN.md)
- [CHUNK_LOADING_ARCHITECTURE.md](./CHUNK_LOADING_ARCHITECTURE.md)
- [VOXEL_RENDERING_RESEARCH.md](./VOXEL_RENDERING_RESEARCH.md)
- [OPTIMIZATION_STRATEGY.md](./OPTIMIZATION_STRATEGY.md)
- [PR #21 – Compressed world maps](https://github.com/hytopiagg/hytopia-source/pull/21)
- [0fps Greedy Meshing](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)
- [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher)
- [Minecraft Chunk Loading (Technical Wiki)](https://techmcdocs.github.io/pages/GameMechanics/ChunkLoading/)
- [Hytale Engine Technical Deep Dive](https://hytalecharts.com/news/hytale-engine-technical-deep-dive)
