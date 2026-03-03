# Client Rendering & Chunk Mesh Audit

Scope: `client/src/core/`, `client/src/chunks/`, `client/src/blocks/`, `client/src/workers/`, `client/src/gltf/`, `client/src/three/`

Rating scale — Benefit 1-5 (higher = more impactful), Risk 1-5 (higher = riskier), Effort 1-5 (higher = more work).

Findings sorted by Benefit descending, then Effort ascending.

---

## 1. PERFORMANCE — No greedy meshing in ChunkWorker

**File:** `client/src/workers/ChunkWorker.ts` (mesh building loop ~lines 900-1200)

Each visible block face emits 4 vertices and 6 indices individually. Adjacent coplanar faces with identical texture, AO, and light values are never merged. For a flat wall of 16x16 identical blocks, 256 quads are emitted instead of 1. This multiplies vertex count, index count, GPU draw bandwidth, and vertex shader invocations.

Greedy meshing (Mikola Lysenko's algorithm) merges coplanar same-attribute faces into larger quads. Typical voxel engines see 5-15x vertex reduction on terrain.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 5 | 3 | 5 | No | Yes |

---

## 2. PERFORMANCE — ChunkWorker uses number[] arrays for geometry, then converts

**File:** `client/src/workers/ChunkWorker.ts` (~lines 850-1050, 1150-1200)

Vertex positions, normals, UVs, colors, and indices are pushed one-at-a-time into `number[]` arrays, then bulk-converted to `Float32Array` / `Uint32Array` at the end via `new Float32Array(arr)`. Each `.push()` may trigger V8 to resize the backing store. For a large batch (32x32x32 blocks), arrays can grow to hundreds of thousands of elements with many intermediate reallocations.

Pre-allocating typed arrays at a worst-case size and using a write cursor would eliminate all intermediate allocations. Unused tail can be sliced via `.subarray()` which is zero-copy.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 5 | 2 | 3 | Yes | Yes |

---

## 3. PERFORMANCE — BoundaryVolume uses string-key Map for block lookups

**File:** `client/src/workers/ChunkWorker.ts` (~lines 130-180)

`BoundaryVolume` stores cross-chunk boundary blocks in a `Map<string, number>` with keys like `` `${x},${y},${z}` ``. Every lookup allocates a string. During mesh building, boundary lookups happen for every face of every surface block (6 directions x all surface blocks). The code already has a TODO acknowledging this issue.

Replace with a flat `Int8Array` or `Uint8Array` indexed by `(x + pad) * strideYZ + (y + pad) * strideZ + (z + pad)` with a 1-block padding border. This eliminates all string allocation and GC pressure.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 5 | 2 | 3 | Yes | Yes |

---

## 4. PERFORMANCE — No frustum culling for chunk batch meshes

**File:** `client/src/chunks/ChunkMeshManager.ts` (~lines 100-150)

Batch meshes are added/removed from the scene based only on view distance (sphere check). Three.js has built-in per-object frustum culling via `mesh.frustumCulled = true`, but the current code does not leverage spatial knowledge. When the player looks in one direction, batches behind the camera within view distance still get submitted to the GPU.

Since Three.js already does frustum culling on the scene graph, verify that `frustumCulled` is `true` on batch meshes (it is by default). The real win would be a spatial index (octree or grid) to skip the scene-graph traversal entirely for batches clearly outside the frustum, avoiding per-mesh matrix * frustum checks.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 4 | 2 | 2 | Yes | Yes |

---

## 5. BUG — DebugRenderer leaks geometries and materials

**File:** `client/src/core/DebugRenderer.ts` (lines 30-76)

`_onPhysicsDebugRaycastPacket` creates `new BufferGeometry()`, `new LineBasicMaterial()`, and `new ArrowHelper()` per raycast visualization. After the blink animation completes, `line.removeFromParent()` is called but `.geometry.dispose()` and `.material.dispose()` are never called. `ArrowHelper` also contains internal geometry and material that are never disposed. Over time, this leaks WebGL buffers.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 4 | 1 | 1 | Yes | Yes |

---

## 6. BUG — Liquid material time increment is frame-rate dependent

**File:** `client/src/blocks/BlockMaterialManager.ts` (line ~320)

The liquid wave animation time uniform is incremented by a fixed `0.0075` per frame rather than by the actual frame delta time. At 60 FPS the effective speed is `0.075 * 60 = 0.45/s`. At 120 FPS it doubles to `0.9/s`. At 30 FPS it halves. This means water animation speed varies with frame rate.

Pass `deltaTime` (already available in the animate loop) and use `time += deltaTime * speed` instead.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 4 | 1 | 1 | Yes | Yes |

---

## 7. PERFORMANCE — Every-frame batch view distance check iterates all batches

**File:** `client/src/chunks/ChunkManager.ts` (~lines 150-180, `applyBatchViewDistance`)

Every animation frame, `applyBatchViewDistance` iterates every batch in `ChunkRegistry` and computes a distance to the player to decide add/remove from scene. With hundreds of batches, this is O(n) per frame. The code has a comment acknowledging this.

A spatial hash grid (bucket size = view distance) would reduce this to checking only buckets near the view distance boundary, making the per-frame cost proportional to the number of batches that actually change visibility, not the total count.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 4 | 2 | 3 | Yes | Yes |

---

## 8. PERFORMANCE — LightLevelVolume._getPackedIndex allocates object per call

**File:** `client/src/chunks/LightLevelVolume.ts` (~line 30)

`_getPackedIndex` returns `{ byteIndex, isHighNibble }` — a new object allocation every call. During mesh building and light queries, this is called per-block. The sibling `SkyDistanceVolume.ts` avoids this by using a reusable working variable.

Return the two values via a reusable static working object, or inline the calculation at call sites (the math is trivial: `index >> 1` and `index & 1`).

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 4 | 1 | 1 | Yes | Yes |

---

## 9. PERFORMANCE — AO cache in ChunkWorker uses linear scan of parallel arrays

**File:** `client/src/workers/ChunkWorker.ts` (~lines 1380-1430)

`_sampleAOOpacity` maintains a cache via four parallel arrays (`aoCacheX`, `aoCacheY`, `aoCacheZ`, `aoCacheOpacity`) and performs a linear scan up to `aoCacheSize` to find a cached entry. The cache is cleared per-batch-build. If cache utilization grows (many unique AO sample positions), the linear scan becomes expensive.

Replace with a flat typed array indexed by a hash of `(x, y, z)` or by direct coordinate indexing (the coordinate range is bounded by batch size + 1 block border).

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 2 | 2 | Yes | Yes |

---

## 10. PERFORMANCE — Light level calculation iterates all nearby light sources per block

**File:** `client/src/workers/ChunkWorker.ts` (`_calculateLightLevel`, ~lines 1300-1370)

For each block position, `_calculateLightLevel` iterates every entry in the `nearbyLightSources` array (populated from all chunks within search radius) and computes distance attenuation. With many light sources (torches in a cave), this is O(lights) per block per face.

A 3D grid lookup (light influence map) pre-computed per batch would reduce per-block cost to O(1). Alternatively, cull lights by maximum attenuation radius before the per-block loop.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 2 | 3 | Yes | Yes |

---

## 11. PERFORMANCE — _clearNearbyLightSourceCache does cubic chunk iteration

**File:** `client/src/workers/ChunkWorker.ts` (`_clearNearbyLightSourceCache`, ~lines 1340-1360)

When a block update arrives, `_clearNearbyLightSourceCache` loops `(2 * SEARCH_RADIUS + 1)^3` chunk lookups to rebuild the light source cache. With `SEARCH_RADIUS = 2`, that is 125 chunk lookups per blocks_update message, each involving a Map lookup and potentially iterating all 4096 blocks in `Chunk.getLightSources()`.

Cache invalidation could be made incremental: only update the light sources from the specific chunks whose blocks changed, rather than rebuilding the entire cache.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 2 | 3 | Yes | Yes |

---

## 12. PERFORMANCE — GLTFManager copies all instance attributes every frame

**File:** `client/src/gltf/GLTFManager.ts` (`_processClonedMeshes`, ~lines 1222-1386)

In `update()`, every visible cloned mesh's world matrix, color, opacity, light level, emissive, and sky light are copied into the InstancedMesh attributes every frame, regardless of whether they changed. The code itself notes this: "Accessing all cloned meshes every animation frame... may be costly."

A dirty-flag per clone would allow skipping unchanged instances. Only the matrix (which changes when entities move) truly needs per-frame updates; color/opacity/emissive change rarely.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 2 | 3 | Yes | Yes |

---

## 13. PERFORMANCE — ChunkMeshManager creates new BufferGeometry per update

**File:** `client/src/chunks/ChunkMeshManager.ts` (`_createOrUpdateMesh`, ~lines 80-130)

Every time a batch mesh is updated, a new `BufferGeometry` is created and the old one is disposed. This involves WebGL buffer deallocation and reallocation. If the same batch is rebuilt frequently (e.g., block placement), this causes GPU buffer churn.

Reuse the existing geometry and update its attributes in-place via `setAttribute` and `setIndex`, only recreating if the buffer size changes significantly. Use `BufferAttribute.setUsage(DynamicDrawUsage)` to hint the driver.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 2 | 3 | Yes | Yes |

---

## 14. FEATURE — No LOD system for distant chunks

**Files:** `client/src/chunks/ChunkMeshManager.ts`, `client/src/workers/ChunkWorker.ts`

All chunks at any distance render at full detail. Distant chunks could use simplified geometry (e.g., skip AO, reduce face count, lower texture resolution) to reduce vertex count and draw calls. This is especially impactful at high view distances.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 3 | 5 | No | Yes |

---

## 15. PERFORMANCE — Outline pass 8-direction per-pixel search

**File:** `client/src/three/postprocessing/SelectiveOutlinePass.ts` (~lines 480-560)

The outline fragment shader samples 8 directions at configurable thickness (up to 16 pixels). Each direction does a texture fetch per step. Worst case: 8 directions * 16 steps = 128 texture samples per pixel. The pre-check optimization (checking boundary samples first) helps, but in scenes with many outlined objects the fallback loop runs on many pixels.

A separable blur approach (horizontal pass then vertical pass) or a jump-flood algorithm would reduce per-pixel cost from O(8 * thickness) to O(2 * log2(thickness)).

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 3 | 4 | No | Yes |

---

## 16. PERFORMANCE — Camera allocates vectors per frame in update methods

**File:** `client/src/core/Camera.ts` (`_updateSpectatorCamera`, `_updateGameCamera`)

Methods like `_updateSpectatorCamera` and `_updateGameCamera` call `new Vector3()` during per-frame updates. These allocations trigger GC pressure. Pre-allocate as module-level or class-level working variables (as done in `client/src/three/utils.ts`).

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 1 | 1 | Yes | Yes |

---

## 17. PERFORMANCE — Chunk.getLightSources iterates all 4096 blocks

**File:** `client/src/chunks/Chunk.ts` (`getLightSources`, ~line 160)

When the light source cache is not populated, `getLightSources` iterates all 4096 blocks (`CHUNK_SIZE^3`) to find light-emitting blocks. This is called for every chunk within the light search radius during batch builds.

Maintain a list of light source positions on block add/remove (already partially implemented via the cache) so the full scan is avoided.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 1 | 2 | Yes | Yes |

---

## 18. PERFORMANCE — CompressedTexture readback renders to screen then reads pixels

**File:** `client/src/gltf/GLTFManager.ts` (`readPixelsFromCompressedTexture`, ~lines 1734-1812)

When building InstancedTextures from KTX2 compressed textures, the code renders the compressed texture to a WebGLRenderTarget and reads pixels back. The code has a TODO noting this "may reduce the benefits of using CompressedTexture" and suggests `CompressedArrayTexture` instead. This readback is synchronous and stalls the GPU pipeline.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 3 | 3 | 4 | No | Yes |

---

## 19. PERFORMANCE — Legacy BlockTextureAtlasManager has O(n) brute-force space finding

**File:** `client/src/workers/BlockTextureAtlasManager.ts` (`_drawImageToAtlas`, legacy path)

In legacy mode, `_drawImageToAtlas` scans the atlas pixel-by-pixel to find empty space for new textures. For large atlases with many textures, this becomes progressively slower. The modern KTX2 path avoids this entirely.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 1 | 2 | Yes | Yes |

---

## 20. PERFORMANCE — ChunkRegistry.getBatchChunkIds creates new array each call

**File:** `client/src/chunks/ChunkRegistry.ts` (`getBatchChunkIds`, ~line 60)

`getBatchChunkIds` creates a new array from the internal `Set` each call via `Array.from()`. If called frequently (e.g., during batch building validation), this creates unnecessary garbage.

Return the Set directly (as read-only) or cache the array.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 1 | 1 | Yes | Yes |

---

## 21. BUG — PerformanceMetricsManager has double semicolon

**File:** `client/src/core/PerformanceMetricsManager.ts` (line 139)

Line 139 has `;;` (double semicolon). Harmless but indicates a typo.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 1 | 1 | 1 | Yes | Yes |

---

## 22. PERFORMANCE — CSS2DRenderer builds transform strings every frame

**File:** `client/src/three/CSS2DRenderer.ts` (~lines 100-140)

For every visible CSS2D element, a new transform string is constructed each frame. The code partially mitigates this by comparing with a cached `tmpEl` before applying to the DOM. However, the string construction itself (`translate(...)`) still runs. This is minor given the viewport culling already limits visible elements.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 1 | 2 | Yes | Yes |

---

## 23. PERFORMANCE — Post-processing chain runs all passes unconditionally

**File:** `client/src/core/Renderer.ts` (~lines 350-450)

The EffectComposer runs SMAA, Bloom, Outline, and Output passes every frame even when bloom threshold means no pixels qualify or no objects are outlined. Disabling passes dynamically when they have no work would save full-screen shader invocations.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 2 | 2 | Yes | Yes |

---

## 24. FEATURE — Transparent instanced mesh flicker at threshold boundary

**File:** `client/src/gltf/GLTFManager.ts` (~lines 1454-1482)

The code notes: "When the visible transparent mesh count hovers around the threshold, rendering may flicker due to frequent switching between individual mesh rendering and InstancedMesh rendering." A hysteresis band (different thresholds for switching on vs off) would prevent this.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 1 | 1 | Yes | Yes |

---

## 25. FEATURE — No transparent instance sorting within InstancedMesh

**File:** `client/src/gltf/GLTFManager.ts` (~lines 1471-1473)

The code has a TODO: "Consider sorting instances by distance from camera before updating instance attributes." Without this, overlapping transparent instances within the same InstancedMesh may render in wrong order, causing visual artifacts.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 2 | 2 | Yes | Yes |

---

## 26. PERFORMANCE — GLTFManager clones geometry for each InstancedMesh resize

**File:** `client/src/gltf/GLTFManager.ts` (`_applyInstancedMesh`, ~lines 792-803)

When the InstancedMesh needs to grow, a new `InstancedMeshEx` is created with `sourceMesh.geometry.clone()`. The comment explains this is needed due to Three.js WebGL resource management constraints (can't release instanceOpacity buffer without disposing geometry). This means each resize allocates new GPU buffers for the base geometry.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 3 | 3 | No | Yes |

---

## 27. PERFORMANCE — Block data not transferred (copied) between main thread and worker

**File:** `client/src/workers/ChunkWorkerConstants.ts` (ChunkWorkerChunkUpdateMessage), `client/src/chunks/ChunkManager.ts`

The `chunk_update` message sends `blocks: Uint8Array` to the worker. This data is copied (not transferred via Transferable) because the main thread still needs the data. For large numbers of chunk updates, the structured clone overhead adds up. Consider using SharedArrayBuffer if the security model allows (requires COOP/COEP headers).

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 3 | 3 | No | Depends on server headers |

---

## 28. PERFORMANCE — View model scene rendered separately adds extra render pass

**File:** `client/src/core/Renderer.ts` (~lines 500-520)

First-person view model rendering uses a separate scene + camera and an additional `renderer.render()` call with depth buffer clear. This is a full additional render pass. For the typical 1-2 meshes of the held item, an alternative would be rendering with a modified projection matrix or depth range in the main pass.

| Benefit | Risk | Effort | Surgical | Backwards Compatible |
|---------|------|--------|----------|----------------------|
| 2 | 3 | 3 | No | Yes |

---

## Summary

| # | Type | Brief Description | Benefit | Risk | Effort |
|---|------|-------------------|---------|------|--------|
| 1 | PERF | No greedy meshing | 5 | 3 | 5 |
| 2 | PERF | number[] to typed array conversion | 5 | 2 | 3 |
| 3 | PERF | String-key BoundaryVolume | 5 | 2 | 3 |
| 4 | PERF | No spatial frustum culling | 4 | 2 | 2 |
| 5 | BUG | DebugRenderer geometry/material leak | 4 | 1 | 1 |
| 6 | BUG | Liquid time not delta-based | 4 | 1 | 1 |
| 7 | PERF | Every-frame batch distance iteration | 4 | 2 | 3 |
| 8 | PERF | LightLevelVolume object alloc per call | 4 | 1 | 1 |
| 9 | PERF | AO cache linear scan | 3 | 2 | 2 |
| 10 | PERF | Light calc iterates all sources per block | 3 | 2 | 3 |
| 11 | PERF | Cubic cache clear for light sources | 3 | 2 | 3 |
| 12 | PERF | GLTF instance attrs copied every frame | 3 | 2 | 3 |
| 13 | PERF | New BufferGeometry per batch update | 3 | 2 | 3 |
| 14 | FEAT | No LOD for distant chunks | 3 | 3 | 5 |
| 15 | PERF | Outline 8-dir per-pixel search | 3 | 3 | 4 |
| 16 | PERF | Camera per-frame vector allocations | 3 | 1 | 1 |
| 17 | PERF | getLightSources scans all 4096 blocks | 3 | 1 | 2 |
| 18 | PERF | Compressed texture GPU readback | 3 | 3 | 4 |
| 19 | PERF | Legacy atlas O(n) space finding | 2 | 1 | 2 |
| 20 | PERF | getBatchChunkIds array alloc | 2 | 1 | 1 |
| 21 | BUG | Double semicolon in metrics | 1 | 1 | 1 |
| 22 | PERF | CSS2D transform string per frame | 2 | 1 | 2 |
| 23 | PERF | Post-processing runs unconditionally | 2 | 2 | 2 |
| 24 | FEAT | Transparent instanced mesh flicker | 2 | 1 | 1 |
| 25 | FEAT | No transparent instance sorting | 2 | 2 | 2 |
| 26 | PERF | Geometry clone on InstancedMesh resize | 2 | 3 | 3 |
| 27 | PERF | Block data copied not transferred | 2 | 3 | 3 |
| 28 | PERF | View model extra render pass | 2 | 3 | 3 |
