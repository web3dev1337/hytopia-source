# Voxel Engine Performance Master Plan
## Making Hytopia as Smooth as Minecraft & Hytale

**Problem:** Lag every ~5 steps; constant chunk rendering; engine feels clunky compared to Minecraft/Hytale.

**Conclusion:** This is primarily a **software/codebase architecture** issue, not hardware. Minecraft and Hytale run smoothly on similar hardware because they use different architectures. The plan below addresses the gaps.

---

## Part 1: Root Cause Analysis

### Why "Every 5 Steps" Lag Happens

| Step | What Happens | Bottleneck |
|------|--------------|------------|
| 1 | Player moves → enters new chunk/batch range | Server loads 1 chunk/tick (CHUNKS_PER_TICK=1) |
| 2 | `getOrCreateChunk` runs | **Sync** disk read or procedural gen blocks main thread |
| 3 | Chunk queued for collider | `processPendingColliderChunks(1)` – 1/tick |
| 4 | `_addChunkBlocksToColliders` | **Heavy:** 4096 blocks, voxel propagation, `_combineVoxelStates` scans ALL chunks of that block type |
| 5 | Server sends chunk to client | Network ok, but chunk sync triggers client work |
| 6 | Client receives ChunksPacket | Posts to ChunkWorker |
| 7 | ChunkWorker builds mesh | **No greedy meshing** – 1 quad per face, 64× more than optimal for flat terrain |
| 8 | Mesh sent back, added to scene | BufferGeometry creation, possible GC spike |
| 9 | Main thread applies mesh | Can cause frame hitch |

### Current vs. Minecraft/Hytale

| Aspect | Hytopia (Current) | Minecraft / Hytale |
|--------|-------------------|---------------------|
| Chunk load | Sync on main thread | Worker threads, async |
| File I/O | `fs.readSync`, `zlib.gunzipSync` | Async, or worker |
| Terrain gen | Sync in main thread | Worker pool |
| Collider creation | Sync, 1/tick, O(world size) | Deferred, batched, O(chunk) |
| Mesh generation | Worker ✅ | Worker ✅ |
| Greedy meshing | ❌ (1 quad/face) | ✅ (merged quads, 2–64× fewer) |
| LOD | ✅ (step 2/4) | ✅ + impostors |
| Occlusion culling | Only when over face limit | Chunk-section visibility |
| Chunk send rate | Per ADD_CHUNK event | Batched, rate-limited |

---

## Part 2: Prioritized Fixes

### Tier 1: Quick Wins (1–3 days each)

| # | Fix | Impact | Effort | Files |
|---|-----|--------|--------|-------|
| 1 | **Increase CHUNKS_PER_TICK** to 2–3 | Fewer "catch up" spikes when moving | 5 min | `playground.ts` |
| 2 | **Time-budget collider processing** | Cap ms per tick (e.g. 8 ms), process multiple chunks if time allows | Medium | `ChunkLattice.ts`, `playground.ts` |
| 3 | **Chunk send batching** | Don’t flood client; batch chunk sync every N ms or per tick | Medium | `NetworkSynchronizer.ts` |
| 4 | **Avoid collider work for distant chunks** | Only add colliders for chunks within 2–3 chunks of player | Medium | `ChunkLattice.ts`, `playground.ts` |

### Tier 2: High Impact (3–7 days each)

| # | Fix | Impact | Effort | Notes |
|---|-----|--------|--------|-------|
| 5 | **Greedy meshing (quad merging)** | 2–64× fewer vertices for terrain | 3–5 days | ChunkWorker; ref 0fps, mikolalysenko/greedy-mesher |
| 6 | **Async chunk provider** | `getChunk()` returns `Promise`; no main-thread blocking | 2–3 days | PersistenceChunkProvider, ProceduralChunkProvider, ChunkLattice |
| 7 | **Worker terrain generation** | Move `generateChunk` to `worker_threads` | 2–3 days | TerrainGenerator, ProceduralChunkProvider |
| 8 | **Async file I/O** | `fs.promises`, `zlib.gunzip` async | 1–2 days | RegionFileFormat.ts |

### Tier 3: Architectural (1–2 weeks each)

| # | Fix | Impact | Effort | Notes |
|---|-----|--------|--------|-------|
| 9 | **Incremental colliders** | Add blocks to voxel collider in batches (e.g. 256/tick) instead of full chunk | High | Rapier voxel API; ChunkLattice |
| 10 | **Collider locality** | `_getBlockTypePlacements` and `_combineVoxelStates` should not scan entire world | High | ChunkLattice; spatial indexing |
| 11 | **Chunk preloading by prediction** | Load chunks in movement direction before player arrives | Medium | playground.ts, loadChunksAroundPlayers |
| 12 | **Vertex pooling** | Reuse BufferGeometry / ArrayBuffers to reduce allocations and GC | Medium | ChunkMeshManager, ChunkWorker |

### Tier 4: Polish (Ongoing)

| # | Fix | Impact | Effort |
|---|-----|--------|--------|
| 13 | **Occlusion culling always-on** | Not just when over face limit | Medium |
| 14 | **LOD impostors** | Billboard or simplified mesh for very far chunks | High |
| 15 | **Profiling hooks** | Tick time, chunk load time, mesh build time | Low |
| 16 | **Block/face limits** | Hard cap to avoid meltdown on weak devices | Low |

---

## Part 3: Recommended Implementation Order

### Phase 1: Stop the Bleeding (Week 1)

1. **Time-budget collider processing** – Cap at 8 ms/tick; process as many chunks as fit.
2. **Increase CHUNKS_PER_TICK** to 2–3.
3. **Spatial collider culling** – Only create colliders for chunks within 2–3 chunks of any player.
4. **Chunk send batching** – Batch chunk sync; don’t send 10 chunks in one frame.

### Phase 2: Main Thread Freedom (Week 2–3)

5. **Async file I/O** – `fs.promises`, async decompress.
6. **Async chunk provider** – `getChunk()` returns `Promise`; ChunkLattice awaits.
7. **Worker terrain gen** – Move `generateChunk` to worker thread.

### Phase 3: Render Pipeline (Week 4–5)

8. **Greedy meshing** – Implement in ChunkWorker for opaque solids; merge adjacent same-type faces.
9. **Vertex pooling** – Reuse geometry buffers where possible.

### Phase 4: Long-Term (Month 2+)

10. **Incremental colliders** – Batched voxel updates.
11. **Collider locality** – Remove global scans.
12. **Occlusion always-on** – Reduce overdraw.

---

## Part 4: Hardware vs. Software

| Factor | Assessment |
|--------|------------|
| **Hardware** | Unlikely primary cause if Minecraft/Hytale run fine. |
| **Software** | Sync I/O, sync terrain gen, heavy collider work, no greedy meshing – all main-thread and render bottlenecks. |
| **Codebase** | Architecture is serviceable but lacks async pipeline and mesh optimization used by mature voxel engines. |

---

## Part 5: Key Files

| Component | Path |
|-----------|------|
| Chunk load loop | `server/src/playground.ts` |
| Collider processing | `server/src/worlds/blocks/ChunkLattice.ts` |
| Mesh generation | `client/src/workers/ChunkWorker.ts` |
| Chunk sync to client | `server/src/networking/NetworkSynchronizer.ts` |
| Disk I/O | `server/src/worlds/maps/RegionFileFormat.ts` |
| Terrain generation | `server/src/worlds/maps/TerrainGenerator.ts`, `ProceduralChunkProvider.ts` |
| Client chunk handling | `client/src/chunks/ChunkManager.ts` |

---

## Part 6: Success Metrics

| Metric | Current (Est.) | Target |
|--------|----------------|--------|
| Lag spikes when walking | Every ~5 steps | None within preload radius |
| Tick time (p99) | 50–200 ms | < 16 ms |
| Chunk load time | 20–100 ms (blocking) | < 5 ms (async) |
| Vertices per chunk (flat) | ~6000 (no greedy) | ~200–500 (greedy) |
| Frame time (client) | Spikes on new chunks | Stable 16 ms (60 fps) |

---

## References

- `docs/CHUNK_LOADING_ARCHITECTURE.md`
- `docs/VOXEL_RENDERING_RESEARCH.md`
- `docs/OPTIMIZATION_STRATEGY.md`
- [0fps Greedy Meshing](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)
- [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher)
- Hytale engine deep dive: variable chunks, LOD, mesh optimization
