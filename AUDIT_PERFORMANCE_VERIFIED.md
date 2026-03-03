# HYTOPIA Engine — Performance Findings (Verified)

Date: 2026-03-03
Branch: `analysis/codebase-audit`
Method: Every claim read against actual source code, quoted, and independently assessed.

## Verification Legend

- **CONFIRMED** — Code does exactly what the claim says
- **PARTIALLY CONFIRMED** — Pattern exists but impact overstated or mitigating factors present
- **REJECTED** — Claim is wrong or materially misleading

## Impact Scale

- **Significant** — Measurable frame/tick time impact in normal gameplay
- **Moderate** — Real cost, but bounded or infrequent
- **Low** — Correct observation, negligible runtime cost
- **Trivial** — Technically true but irrelevant in practice

---

## SERVER PERFORMANCE

### CONFIRMED — Significant or Moderate Impact

| # | Finding | File:Line | Verdict | Impact | Notes |
|---|---------|-----------|---------|--------|-------|
| S1 | Trimesh collider fully recreated on every block edit | `ChunkLattice.ts:457-461, 485-487, 527-541` | CONFIRMED | Moderate | Every `setBlock` on a trimesh block type removes + rebuilds the entire collider. Voxel colliders (standard blocks) use incremental `setVoxel()` — only trimesh types suffer this. Impact scales with frequency of trimesh block edits. |
| S2 | `gzipSync` blocks event loop | `Connection.ts:183` | CONFIRMED | Moderate | Synchronous gzip on main thread for payloads >64KB (primarily chunk data on player join). Level 1 compression, result is cached. Estimated 0.5-2ms per call. |
| S3 | Sequential model loading at startup | `ModelRegistry.ts:181-187` | CONFIRMED | Moderate | `await` in a `for` loop loads models one at a time. `Promise.all` could parallelize I/O. Startup-only cost, zero runtime impact. Note: optimization step runs shell commands that may contend for CPU. |
| S4 | Full world state queued on player join | `NetworkSynchronizer.ts:1084-1149` | PARTIALLY CONFIRMED | Moderate | All chunks/entities/audio/UI queued in one sync tick. Not "sent all at once" — queued into per-player sync, then batched into packets. Still produces a burst on join. |

### CONFIRMED — Low or Trivial Impact

| # | Finding | File:Line | Verdict | Impact | Notes |
|---|---------|-----------|---------|--------|-------|
| S5 | BigInt chunk keys vs integer keys | `ChunkLattice.ts:615-621` | CONFIRMED | Low | 54-bit per-axis packing requires BigInt (exceeds JS safe integer range). Deliberate tradeoff for world size. Microsecond-level overhead per lookup. |
| S6 | `_propagateVoxelChange` iterates all block type colliders | `ChunkLattice.ts:517-524` | CONFIRMED | Low | O(K) per block edit where K = distinct block types with colliders. K is typically small (10-50). |
| S7 | `_combineVoxelStates` O(K²) at init | `ChunkLattice.ts:507-514` | PARTIALLY CONFIRMED | Trivial | K² only during bulk initialization. Per-edit path is O(K). K is typically small. |
| S8 | Per-packet AJV validation | `Connection.ts:156-159` | PARTIALLY CONFIRMED | Trivial | Defensive check before serialization. AJV compiled validators are fast. Amortized by caching. |
| S9 | Vector3/Quaternion extend Float32Array | `Vector3.ts:24, Quaternion.ts:22` | CONFIRMED | Trivial | Intentional for gl-matrix/WASM interop. Most hot paths use `Vector3Like` plain objects. |
| S10 | `getAllChunks()`/`getAllWorlds()` create arrays | `ChunkLattice.ts:268, WorldManager.ts:116` | CONFIRMED | Trivial | Only called during player join or init, not per-tick. |
| S11 | Heartbeat creates packet array per beat | `Connection.ts:434-439` | CONFIRMED | Trivial | Infrequent event, tiny allocation. |
| S12 | `_applyRigidBodyOptions` creates bound function arrays | `RigidBody.ts:1601-1627, Collider.ts:1572-1593` | CONFIRMED | Trivial | Construction-time only, ~17 bound functions. |
| S13 | `_calculateChecksum` reads + base64 encodes file | `ModelRegistry.ts:545-553` | CONFIRMED | Trivial | Startup-only. Wastes ~33% extra memory per file. Could hash Buffer directly. |
| S14 | Linear scan for entity-attached lookups | `AudioManager.ts:74-76` | CONFIRMED | Trivial | Only during entity despawn, not per-tick. Small collections. |
| S15 | `_createPaddedTexture` iterates interior pixels | `BlockTextureRegistry.ts:329-337` | CONFIRMED | Trivial | Startup-only atlas generation. ~576 wasted branch checks per texture. |
| S16 | Entity sync reliable/unreliable classification | `NetworkSynchronizer.ts:163-176` | CONFIRMED | Low | Works correctly but fragile `for...in` key check. Maintainability concern, not perf. |

### REJECTED

| # | Finding | Verdict | Reason |
|---|---------|---------|--------|
| S17 | Telemetry spans created every tick when disabled | REJECTED | `Telemetry.startSpan` early-returns to `callback()` when Sentry is not initialized. No span objects created. Only the options literal is allocated (trivial). |
| S18 | `getProcessStats` called twice for slow ticks | REJECTED | `beforeSend` handles error events, `beforeSendTransaction` handles transactions. Different callbacks for different event types. They do not fire for the same event. |
| S19 | Ticker setTimeout makes 60Hz unreliable | PARTIALLY CONFIRMED | Uses standard fixed-timestep accumulator pattern. setTimeout jitter is compensated by accumulating elapsed time. Physics steps are always the same fixed delta. This is the correct approach. |
| S20 | Simulation events emitted without listeners | PARTIALLY CONFIRMED | Payload objects are allocated, but `EventRouter.emit()` bails out at `listenerCount === 0`. No actual dispatch occurs. Trivial overhead. |

---

## CLIENT PERFORMANCE

### CONFIRMED — Significant Impact

| # | Finding | File:Line | Verdict | Impact | Notes |
|---|---------|-----------|---------|--------|-------|
| C1 | No greedy meshing in ChunkWorker | `ChunkWorker.ts:950-1182` | CONFIRMED | **Significant** | Face-by-face quad emission. No merging of coplanar adjacent faces. Greedy meshing can reduce vertex count 10-50x on flat surfaces. Mitigated by face culling (hidden faces between opaque blocks are skipped) and batch meshing. Still the single biggest rendering optimization opportunity. |
| C2 | Light calculation iterates all nearby sources per block | `ChunkWorker.ts:1228-1265` | CONFIRMED | **Significant** | O(blocks_in_batch × nearby_light_sources). Has AABB quick-rejection. For worlds with many light-emitting blocks, this scales poorly. Flood-fill propagation would be O(blocks + sources × range). |

### CONFIRMED — Moderate Impact

| # | Finding | File:Line | Verdict | Impact | Notes |
|---|---------|-----------|---------|--------|-------|
| C3 | number[] arrays then convert to typed arrays | `ChunkWorker.ts:731-755, 1192-1217` | CONFIRMED | Moderate | Double memory during mesh build. Runs in Web Worker (no main-thread jank). GC pressure from transient arrays. Pre-sizing typed arrays would require knowing final size after culling. |
| C4 | BoundaryVolume uses string-key Map | `ChunkWorker.ts:131-152` | CONFIRMED | Moderate | `"x,y,z"` string keys for boundary block lookups. Developers flagged this with a TODO. Scope limited to boundary data (not all block lookups — main chunk storage uses `Uint8Array` with integer indexing). |
| C5 | Every-frame batch view distance iteration | `ChunkManager.ts:68-89` | CONFIRMED | Moderate | Iterates all batches every frame for distance check. Developers acknowledge this in a comment. Simple squared-distance check, no sqrt. Sub-millisecond for hundreds of batches but scales linearly. |
| C6 | Instance matrix copied every frame | `GLTFManager.ts:1255-1377` | PARTIALLY CONFIRMED | Moderate | Matrix data copied unconditionally (entities can move). Color/opacity/emissive attributes are conditional (counter-based skipping). Developers acknowledge tradeoff in comments — instanced rendering benefit outweighs copy cost. |
| C7 | New BufferGeometry per chunk mesh update | `ChunkMeshManager.ts:36-108` | CONFIRMED | Moderate | New `BufferGeometry` created each update, old disposed. Geometry data from worker arrives as new typed arrays anyway — GPU upload is unavoidable. Three.js overhead for geometry object creation could be reduced by buffer reuse. Only on chunk rebuilds, not per-frame. |
| C8 | Camera allocates vectors per frame | `Camera.ts:511, 582, 603, 765-766` | CONFIRMED | Moderate | 2-3 `Vector3` objects per frame in update methods. Module-level reusable vectors exist but aren't used in all paths. Minor GC pressure. |
| C9 | Outline pass 8-direction search | `SelectiveOutlinePass.ts:283-316` | PARTIALLY CONFIRMED | Moderate | Up to 256 texture samples per pixel worst case. BUT pre-check at max thickness provides early-out — most pixels only do 12 samples. Pass disabled when no outline targets exist. Standard GPU outline technique. |

### CONFIRMED — Low or Trivial Impact

| # | Finding | File:Line | Verdict | Impact | Notes |
|---|---------|-----------|---------|--------|-------|
| C10 | `getLightSources` scans all 4096 blocks | `Chunk.ts:186-217` | PARTIALLY CONFIRMED | Low | Result is cached (`_lightSources`). Full scan only on first call or after cache invalidation. One-time cost per chunk. |
| C11 | CSS2DRenderer builds transform strings per frame | `CSS2DRenderer.ts:160-170` | PARTIALLY CONFIRMED | Low | Builds strings but only applies if changed. Has frustum culling. Uses `willChange: 'transform'` for GPU compositing. Already well-optimized. |
| C12 | Geometry cloned on InstancedMesh resize | `GLTFManager.ts:798-803` | CONFIRMED | Low | Only on tier threshold crossing, not per-frame. Tiered approach means infrequent. Some geometry creation unavoidable for instance-specific attributes. |
| C13 | Block data copied not transferred to worker | `ChunkManager.ts:150-160` | CONFIRMED | Low | 4KB per chunk via structured clone. Intentional — main thread also needs block data. Developers acknowledge tradeoff in comments. Geometry output IS properly transferred. |
| C14 | Deserializer creates intermediate objects | `Deserializer.ts:274-642` | CONFIRMED | Low | Standard deserialization. Plain objects (`{ x, y, z }`) are cheap. Runs at 30 Hz network rate, not 60 Hz render rate. |
| C15 | AO cache linear scan of parallel arrays | `ChunkWorker.ts:1615-1638` | CONFIRMED | Trivial | Cache cleared per-face. Max 3-4 entries per lookup. Linear scan over 3 items is faster than any hash structure. |
| C16 | `getBatchChunkIds` creates new array | `ChunkRegistry.ts:92-95` | CONFIRMED | Trivial | Event-driven (chunk packet arrival), not per-frame. 8 elements max. |
| C17 | Legacy atlas O(n) space finding | `BlockTextureAtlasManager.ts:192-215` | CONFIRMED | Trivial | Legacy code path for old SDK versions. Modern path uses pre-generated metadata. Init-time only. |

### REJECTED

| # | Finding | Verdict | Reason |
|---|---------|---------|--------|
| C18 | No frustum culling for chunk batch meshes | **REJECTED** | Three.js default `frustumCulled = true` is NOT overridden. `computeBoundingSphere()` is called. Three.js DOES perform frustum culling. Additionally, view distance removes distant batches from scene graph entirely. |
| C19 | Post-processing runs all passes unconditionally | **REJECTED** | Each pass individually enabled/disabled via settings. If no post-processing enabled, falls through to simple `renderer.render()`. Outline pass additionally gated by target existence. |

---

## Top Actionable Items (Ranked by Impact)

### Tier 1 — Significant Performance Gains

1. **Greedy meshing** (C1) — Single biggest rendering optimization. 10-50x vertex reduction on flat surfaces. Complex to implement but enormous payoff.
2. **Light propagation algorithm** (C2) — Replace per-block × per-source iteration with flood-fill/BFS. Especially important for worlds with many light-emitting blocks.

### Tier 2 — Moderate Gains, Reasonable Effort

3. **Async gzip** (S2) — Replace `gzipSync` with async `gzip` for >64KB payloads. 1-line change, removes main thread blocking during player join.
4. **Parallel model loading** (S3) — Replace sequential `await` loop with `Promise.all` (with concurrency limit). Startup-time improvement only.
5. **Pre-allocated typed arrays in ChunkWorker** (C3) — Estimate final sizes or use growable typed array pools. Reduces GC pressure in worker.
6. **BoundaryVolume integer keys** (C4) — Replace string `"x,y,z"` keys with packed integers. Developers already flagged with TODO.
7. **Camera reuse working vectors** (C8) — Use module-level vectors instead of `new Vector3()` in per-frame update paths. 3-line fix.

### Tier 3 — Low Priority / Deliberate Tradeoffs

8. Trimesh collider batching (S1) — Only matters for games using many custom-mesh block types that are frequently edited.
9. Instance attribute conditional copying (C6) — Already optimized with counters; matrix copy is necessary.
10. Batch view distance octree/spatial structure (C5) — Developers acknowledge, squared-distance is fast enough for now.

---

## False Positives Identified

These claims from the original audit are **wrong** and should not be acted on:

1. ~~Telemetry spans created every tick when disabled~~ — Early return, no spans created
2. ~~`getProcessStats` called twice for slow ticks~~ — Different Sentry callbacks
3. ~~No frustum culling for chunk batch meshes~~ — Three.js default frustum culling is active
4. ~~Post-processing runs all passes unconditionally~~ — Each pass individually toggled
5. ~~Ticker setTimeout makes 60Hz unreliable~~ — Standard fixed-timestep accumulator pattern, correct approach
