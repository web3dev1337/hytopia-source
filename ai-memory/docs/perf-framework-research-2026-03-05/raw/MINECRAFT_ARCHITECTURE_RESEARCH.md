# Minecraft Architecture Research

**Purpose:** Inform Hytopia’s voxel engine design with lessons from Minecraft Java and Bedrock.  
**Audience:** Engineers implementing chunk loading, colliders, and meshing.  
**Sources:** Technical wikis, decompilations, community analysis, engine talks.

---

## 1. Chunk System Overview

### 1.1 Chunk Structure

| Version | Chunk Size | Subchunk | Notes |
|---------|------------|----------|-------|
| Java | 16×256×16 (XZ columns) | 16×16×16 sections | Vertical column; sections loaded independently |
| Bedrock | 16×256×16 | 16×16×16 | Similar; different storage layout |

**Hytopia:** 16×16×16 chunks, 2×2×2 batches (32³). Aligns with common practice.

### 1.2 Loading States (Java 1.14+)

Minecraft separates chunk lifecycle into distinct states:

| State | Purpose |
|-------|---------|
| **Empty** | Not loaded |
| **Structure** | Structures placed |
| **Noise** | Terrain generated |
| **Surface** | Surface blocks, biomes |
| **Carvers** | Caves, ravines |
| **Features** | Trees, ores, etc. |
| **Entity ticking** | Physics, entities, block updates |

**Key insight:** Entity ticking requires a 5×5 grid of loaded chunks around the center chunk. Border chunks can be “lazy” (block updates only, no entities). This **spatial locality** keeps entity/physics work bounded.

**Hytopia takeaway:** Only tick entities and step physics for chunks near players. Don’t pay for distant chunks.

### 1.3 Spawn Chunks

- 19×19 chunks (Java) or 23×23 (Bedrock) always loaded around spawn.
- Only center ~12×12 process entities.
- Reduces load/unload churn at spawn.

**Hytopia:** Preload radius already exists; consider an “always loaded” spawn core for hubs.

---

## 2. File I/O and Region Format

### 2.1 Region Files

- One file per 32×32 chunk region (XZ).
- Anvil format: 4 KB header (1024 entries × 4 bytes) + chunk payloads.
- Chunks stored with length prefix + compression (typically zlib; Bedrock uses different schemes).
- **Async I/O:** Modern implementations use background threads; main thread never blocks on disk.

### 2.2 Chunk Serialization

- Block IDs, block states, light, heightmap, biomes stored per chunk.
- Compression reduces size by ~90% for typical terrain.

**Hytopia:** Region format exists; `readChunkAsync` and `writeChunk` (sync) are in place. Priority: make persist async.

---

## 3. Terrain Generation

### 3.1 Worker Pool

- Terrain generation runs in worker threads.
- Main thread requests chunk; worker generates; result returned asynchronously.
- Multiple workers allow parallelism.

### 3.2 Generation Stages

- Noise → carvers → features (trees, ores).
- Each stage can be parallelized or deferred.

**Hytopia:** `TerrainWorkerPool` + `generateChunkAsync` exist. Ensure `requestChunk` uses this path and doesn’t fall back to sync.

---

## 4. Physics and Collision

### 4.1 Chunk-Section Colliders

- Collision is built per 16×16×16 section.
- Sections far from players may not have colliders at all, or use simplified shapes.
- Colliders are created/updated in batches, not all at once.

### 4.2 Spatial Partitioning

- Physics world uses spatial partitioning (e.g. broadphase).
- Entity vs. block collision: only check nearby chunks.
- No global scan over entire world.

**Hytopia gap:** `_combineVoxelStates` iterates all chunks of a block type. Must restrict to nearby chunks.

---

## 5. Meshing and Rendering

### 5.1 Greedy Meshing (Ambient Occlusion)

- Minecraft uses an approximation of greedy meshing (block model merging).
- Adjacent faces of same block type are merged into larger quads where possible.
- Results in 2–64× fewer quads than per-face rendering.

### 5.2 Occlusion Culling

- Section-level visibility: if a section is fully behind solid terrain, skip rendering.
- BFS from camera through air/transparent blocks; mark visible sections.
- ~10–15% frame time savings in cave-heavy areas.

### 5.3 LOD

- Distant chunks use lower-detail meshes or impostors.
- Reduces overdraw and vertex count.

**Hytopia:** Face culling ✅; greedy meshing ❌; occlusion partial; LOD step 2/4. Biggest win: greedy meshing.

---

## 6. Network

### 6.1 Chunk Packets

- Chunks sent incrementally; rate-limited to avoid client flood.
- Delta updates for modified chunks (block changes) vs. full chunk for new loads.

### 6.2 Entity Sync

- Position/rotation use compact encodings (fixed-point or quantized).
- Entities use delta or relative positioning where possible.
- Distant entities may sync at lower rate.

**Source:** [Minecraft Protocol (wiki.vg)](https://wiki.vg/Protocol#Entity_Metadata)

---

## 7. Lessons for Hytopia

| Minecraft Pattern | Hytopia Status | Action |
|-------------------|----------------|--------|
| Async chunk load | ✅ `requestChunk` + `getChunkAsync` | Verify usage |
| Async I/O | ✅ `readChunkAsync` | Make persist async |
| Worker terrain gen | ✅ TerrainWorkerPool | Verify |
| Collider locality | ❌ O(world) scans | Phase 1: spatial index, scoped merge |
| Greedy meshing | ❌ | Phase 4 |
| Occlusion | ⚠️ Partial | Phase 5 |
| Entity quantization | ❌ | Phase 3 |
| Distance-based sync | ❌ | Phase 3 |

---

## References

- [Chunk Loading – Technical Minecraft Wiki](https://techmcdocs.github.io/pages/GameMechanics/ChunkLoading/)
- [Minecraft Protocol – wiki.vg](https://wiki.vg/Protocol)
- [0fps Meshing in a Minecraft Game](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)
- [Fabric Modding Documentation (chunk loading states)](https://fabricmc.net/wiki/)
