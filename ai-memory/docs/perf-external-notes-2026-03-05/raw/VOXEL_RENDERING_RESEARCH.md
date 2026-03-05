# Voxel World Smoothness: Research on Minecraft, Hytale, and bloxd

Deep research into how popular voxel games keep worlds lag-free and smooth during flight/movement.

---

## Summary: What These Games Do

| Technique | Minecraft | Hytale | bloxd | Hytopia (Current) |
|-----------|-----------|--------|-------|-------------------|
| **Face culling** | ✅ | ✅ | ✅ | ✅ (ChunkWorker) |
| **Greedy meshing** | ✅ (approximation) | ✅ | ✅ | ❌ |
| **Chunk batching** | ✅ (16×16×16) | Variable sizes | ✅ | ✅ (2×2×2 batches) |
| **Async mesh generation** | ✅ (worker) | ✅ | ✅ | ✅ (ChunkWorker) |
| **View distance** | ✅ | ✅ | ✅ | ✅ |
| **LOD (distant simplification)** | ✅ | ✅ | ✅ | ❌ |
| **Occlusion / cave culling** | ✅ (advanced) | Partial | Partial | ❌ |
| **Vertex pooling** | — | — | ✅ | ❌ |
| **Block/face limits** | Implicit | — | — | ❌ |

---

## 1. Face Culling (Already Implemented ✅)

**What it does:** Only render faces that are visible—i.e. faces where the adjacent block is empty or transparent. Interior faces between solid blocks are never drawn.

**0fps comparison:** On a solid 8×8×8 cube:
- Stupid method: 3,072 quads (6 per block)
- Culling: 384 quads (1 per surface face)
- **~8× reduction**

**Hytopia status:** Already in `ChunkWorker.ts` (lines 962–985). Neighbor check per face; solid opaque neighbors → face is culled. **No change needed.**

---

## 2. Greedy Meshing / Greedy Quad Merging (Not Implemented ❌)

**What it does:** Merge adjacent faces with the same texture/material into larger quads. Instead of many small quads, you get fewer large quads covering the same surface.

**0fps example:** Same 8×8×8 solid cube:
- Culling: 384 quads
- Greedy: **6 quads** (one per side)
- **64× reduction over culling**

**Algorithm (0fps):**
1. Sweep the 3D volume in 3 directions (X, Y, Z)
2. For each 2D slice, identify visible faces
3. Greedily merge adjacent same-type faces into rectangles
4. Order: top-to-bottom, left-to-right; pick the lexicographically minimal mesh

**Multiple block types:** Group by (block type, normal direction). Mesh each group separately.

**Performance trade-off:**
- Greedy is slower to *build* than culling (more passes, more logic)
- But produces far fewer vertices → faster rendering and less GPU memory
- Modern bottleneck is often CPU→GPU transfer; fewer vertices = less data = smoother

**Hytopia status:** ChunkWorker emits one quad per visible face. No merging.

**Recommendation:** High impact. Implement greedy meshing in ChunkWorker for opaque solid blocks first. Reference: [0fps greedy meshing](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/), [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher).

---

## 3. Occlusion / Cave Culling (Not Implemented ❌)

**What it does:** Don’t render chunks (or chunk sections) that are completely hidden behind solid terrain. E.g. caves behind a mountain.

**Minecraft (Tommo’s Advanced Cave Culling, 2014):**
- Works on 16×16×16 chunk sections
- Builds a connectivity graph of transparent/air paths
- BFS from camera to find visible sections
- Culls sections unreachable through air/transparent blocks
- ~14% frame time improvement

**Hytopia status:** No occlusion culling. All loaded chunks in view distance are rendered if in frustum.

**Recommendation:** Medium impact, higher complexity. Consider chunk-section visibility BFS. Less urgent than greedy meshing.

---

## 4. Level of Detail (LOD) (Not Implemented ❌)

**What it does:** Render distant chunks with simpler geometry—fewer quads, lower resolution, or simplified shapes.

**Hytale:** Variable chunk sizes; LOD where distant chunks use lower-detail meshes.

**Typical approach:**
- Near: Full detail
- Mid: Merged/simplified mesh
- Far: Very low poly or impostors

**Hytopia status:** No LOD. All chunks use the same mesh quality.

**Recommendation:** Medium impact. Could start with “skip every other block” or similar for distant batches. More complex: proper LOD meshes.

---

## 5. Async Mesh Generation (Already Implemented ✅)

**What it does:** Build chunk meshes in a worker thread so the main thread stays responsive.

**Hytopia status:** `ChunkWorker.ts` runs in a Web Worker. Mesh building is off the main thread. **Already good.**

---

## 6. Block / Face Limits

**What it does:** Cap total blocks or faces to avoid overload. E.g. stop loading chunks if face count exceeds a threshold.

**Hytopia status:** No hard limit. Chunk count is bounded by view distance, but no per-frame or total face limit.

**Recommendation:** Low priority. Could add a safety cap (e.g. max 500K faces) to avoid extreme lag on weak devices.

---

## 7. Vertex Pooling (bloxd / High-Performance Engines)

**What it does:** Reuse vertex buffers instead of allocating new ones per chunk. Reduces allocations and GC.

**Impact:** Can improve frame times by tens of percent in allocation-heavy setups.

**Hytopia status:** New geometry per batch. No pooling.

**Recommendation:** Lower priority. Consider if profiling shows allocation/GC as a bottleneck.

---

## 8. Server-Side Optimizations (Already Addressed)

- **View distance:** Reduced default, `/view` command
- **Chunk load/unload:** With grace period
- **Prioritize by view direction:** Load chunks in front first
- **Unload distant chunks:** Keeps memory bounded

---

## Prioritized Implementation Plan

| Priority | Technique | Impact | Complexity | Effort |
|----------|-----------|--------|------------|--------|
| 1 | **Greedy meshing** | High | Medium | 2–3 days |
| 2 | **LOD for distant chunks** | Medium | Medium | 1–2 days |
| 3 | **Occlusion / cave culling** | Medium | High | 3+ days |
| 4 | **Block/face limit cap** | Low (safety) | Low | <1 day |
| 5 | **Vertex pooling** | Low–Medium | Medium | 1–2 days |

---

## Greedy Meshing Implementation Sketch

For `ChunkWorker._createChunkBatchGeometries`:

1. **Current flow:** Per block → per face → if visible → emit quad.
2. **New flow (opaque solids):**
   - Collect visible faces with (normal, blockTypeId, textureUri, AO, light) as keys
   - For each direction (±X, ±Y, ±Z), build a 2D grid of visible faces
   - Run greedy merge per slice (0fps algorithm)
   - Emit merged quads instead of per-face quads
3. **Transparent blocks:** Can stay as-is (per-face) or use a separate greedy pass with transparency grouping.
4. **Trimesh blocks:** Keep current logic (no greedy).

**References:**
- [0fps Part 1](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)
- [0fps Part 2 (multiple types)](https://0fps.net/2012/07/07/meshing-minecraft-part-2/)
- [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher) (JS)
- [Vercidium greedy voxel meshing gist](https://gist.github.com/Vercidium/a3002bd083cce2bc854c9ff8f0118d33)

---

## Other Considerations

- **Runs-based meshing:** Alternative to full greedy; ~20% more triangles but ~4× faster build. Good compromise.
- **GPU-driven rendering:** Modern engines use compute shaders for mesh generation. WebGL limits this; workers are the main option.
- **Chunk size:** Hytopia uses 16³ chunks and 2×2×2 batches (32³). Matches common practice.

---

## Implemented (Hytopia)

- **LOD:** Distant chunks use step 2 or 4 (half/quarter detail). Underground batches get +1 LOD.
- **Block/face limits:** When total faces > 800K, view distance shrinks to 25% and occlusion runs.
- **Vertex pooling:** Mesh updates reuse existing BufferAttributes when size matches (avoids GPU realloc).
- **Occlusion culling:** BFS from camera through air/liquid; only visible batches rendered when over face limit.
- **Underground LOD:** Batches below Y=40 use one extra LOD step (reduces cave geometry; partial greedy benefit).

## Conclusion

The largest missing optimization is **full greedy meshing** (quad merging). Face culling is in place, but merging adjacent same-type faces into larger quads can cut vertex/quad count by roughly 2–10× depending on geometry, which directly reduces GPU work and often improves smoothness when flying.

LOD and occlusion culling are useful next steps; block limits and vertex pooling are refinements for later.
