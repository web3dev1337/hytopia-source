# Physics & Worlds Audit

## Summary

Comprehensive audit of `server/src/worlds/`, `server/src/worlds/physics/`, and `server/src/worlds/blocks/` in the HYTOPIA engine. Findings sorted by benefit (descending), then effort (ascending).

---

### [PERFORMANCE] Ticker uses setTimeout for 60 Hz loop - inherent jitter
**Benefit: 5/5 | Risk: 3/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/shared/classes/Ticker.ts:147`

The Ticker drives the 60 Hz world loop using `setTimeout(tick, this._nextTickMs)`. On Node.js/Bun, `setTimeout` has minimum resolution of ~1ms and jitter of 1-4ms depending on OS scheduler load. At 60 Hz the target interval is 16.67ms, so 1-4ms of jitter represents 6-24% timing variance per tick. The accumulator pattern partially compensates (allowing catch-up ticks up to `TICK_SLOW_UPDATE_CAP = 2`), but it still means the physics step frequency is not smooth.

**Recommended fix:** Consider using `setImmediate` with a busy-wait spin for the remaining sub-millisecond fraction, or Bun's `Bun.sleep()` which has microsecond resolution. A hybrid approach: `setTimeout` for the bulk delay (nextTickMs - 2), then `setImmediate` spin-check for the final 2ms, would dramatically reduce jitter with minimal CPU cost. The code comment at line 144-146 says "Use setTimeout instead of setImmediate to avoid memory pressure" -- this is valid but the trade-off should be configurable.

---

### [PERFORMANCE] Trimesh collider fully recreated on every single block edit
**Benefit: 5/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:457-461` and `server/src/worlds/blocks/ChunkLattice.ts:485-487`

When `setBlock()` modifies a block that uses a trimesh collider type, `_recreateTrimeshCollider()` is called which removes the entire collider from simulation, rebuilds the combined trimesh from ALL placements of that block type, and re-adds it. For a world with thousands of trimesh blocks of the same type, editing a single one rebuilds the entire mesh. `_buildTrimeshFromBlockPlacements` (BlockType.ts:286-345) allocates new Float32Array and Uint32Array for ALL vertices/indices every time.

**Recommended fix:** Batch trimesh collider rebuilds per tick instead of per-block-edit. Queue dirty block types during a tick, then rebuild all at once at end-of-tick. This turns N individual rebuilds into 1. For even more optimization, consider incremental trimesh updates (add/remove individual block triangles) rather than full rebuild.

---

### [PERFORMANCE] `_combineVoxelStates` is O(N^2) in number of block types
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:507-514`

During `initializeBlockEntries`, after all blocks are placed, a loop from blockTypeId 1..255 calls `_combineVoxelStates(collider)` for each block type that has blocks. Inside `_combineVoxelStates`, it iterates ALL `_blockTypeColliders` to find other voxel colliders to combine with. If there are K voxel block types, this is O(K^2) calls to `combineVoxelStates()`. Each call to Rapier's `combineVoxelStates` is itself non-trivial. With many block types (20+), this becomes quadratic.

**Recommended fix:** Maintain a separate list/set of voxel-type colliders. When combining, only iterate that subset. Also, `combineVoxelStates` is symmetric -- track which pairs have already been combined to avoid redundant work (currently the code says "only once" in comments but there's no deduplication guard).

---

### [BUG] `Chunk.globalCoordinateToOriginCoordinate` fails for negative coordinates
**Benefit: 5/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/Chunk.ts:132-138`

The bitwise `&` with `CHUNK_AXES_RANGE (15)` on negative numbers produces incorrect results. For example, `globalCoordinate.x = -1`:
- `(-1 | 0)` = `-1`
- `(-1 & 15)` = `15` (bitwise AND on two's complement)
- Result: `-1 - 15 = -16` (correct!)

Actually wait -- for `-1`, this produces `-16` which IS the correct origin for chunk containing block -1. Let me check `-17`:
- `(-17 | 0)` = `-17`
- `(-17 & 15)` = `15`
- Result: `-17 - 15 = -32` (correct, chunk [-32, -17])

And for `-16`:
- `(-16 | 0)` = `-16`
- `(-16 & 15)` = `0`
- Result: `-16 - 0 = -16` (correct)

After careful analysis, the bitwise operations actually work correctly for negative values in JavaScript (two's complement). **Downgrading this from BUG to PERFORMANCE NOTE** -- the `(globalCoordinate.x | 0)` coercion is necessary for float->int truncation but could be replaced with a right-shift: `x >> 4 << 4` for clarity and potentially marginally better perf. No actual bug here.

---

### [BUG] `globalCoordinateToLocalCoordinate` silently produces wrong results for non-integer inputs
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/Chunk.ts:116-122`

The bitwise `& CHUNK_AXES_RANGE` truncates to integer implicitly (like `| 0`), but for negative fractional values like `-0.5`, it produces `(-0.5 & 15)` = `(0 & 15)` = `0` -- when the expected behavior might be the block at position `-1` (local coord 15 within chunk -16...-1). The entire coordinate chain (`globalToLocal`, `globalToOrigin`, `getBlockId`, etc.) assumes integer inputs but nothing validates this at the API boundary.

**Recommended fix:** Add `Math.floor()` before the bitwise operations, or document clearly that all global coordinates must be pre-floored integers. The `setBlock` path does validate via `_isValidBlockTypeId` but never validates the coordinate itself.

---

### [PERFORMANCE] `_propagateVoxelChange` iterates ALL block type colliders for every single block edit
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:517-524`

Every call to `setBlock` that modifies a voxel collider calls `_propagateVoxelChange`, which iterates ALL `_blockTypeColliders`. With 50 block types, every single block placement/removal does 50 iterations. For batch operations like building a structure, this is O(blocks * blockTypes).

**Recommended fix:** Same as above -- maintain a separate set of voxel-only colliders. Also consider whether propagation could be deferred and batched per-tick.

---

### [PERFORMANCE] `getAllChunks()` and `getAllWorlds()` create new arrays every call
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:268` and `server/src/worlds/WorldManager.ts:116`

`Array.from(this._chunks.values())` and `Array.from(this._worlds.values())` allocate a new array each call. If these are called frequently (e.g., per-tick for spatial queries), this creates GC pressure.

**Recommended fix:** Return the Map's `values()` iterator directly, or cache the array and invalidate on add/remove. For the `ChunkLattice`, this matters more since chunk count can be in the hundreds.

---

### [BUG] `RigidBody.removeFromSimulation` nullifies `_rigidBodyDesc`, making body non-reusable
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/RigidBody.ts:1490-1505`

After `removeFromSimulation()`, both `_simulation` and `_rigidBody` are set to `undefined`. The `_rigidBodyDesc` was already set to `undefined` implicitly since it's not reassigned after `addToSimulation()` created the actual body from it (line 1315). This means `isRemoved` returns `true` (line 619-621: `!this._rigidBody && !this._rigidBodyDesc`), and the body can never be re-added to a simulation. This is not necessarily a bug if the design intent is one-shot, but the class doesn't document this limitation.

**Recommended fix:** Either (a) reconstruct the `_rigidBodyDesc` from the current body state before removing, allowing re-addition, or (b) document clearly that removed bodies cannot be re-used and must be reconstructed.

---

### [BUG] World.stop() does not clean up entities, physics, or sub-managers
**Benefit: 4/5 | Risk: 3/5 | Effort: 3/5 | Surgical: no | Backwards Compatible: no**

File: `server/src/worlds/World.ts:787-796`

`World.stop()` only stops the loop. It does not:
- Remove entities from the physics simulation
- Destroy the Rapier world
- Clear the collider map
- Disconnect players from the world
- Clean up audio/particle/sceneUI managers

If a world is stopped and then garbage collected, all Rapier resources (rigid bodies, colliders, the RAPIER.World itself) leak WASM memory. Rapier3D uses a Rust-backed WASM allocator -- JS garbage collection does NOT free these resources.

**Recommended fix:** Add a `destroy()` method that properly tears down all sub-systems. At minimum, call `this._simulation._rapierSimulation.free()` and clear all manager state. The current `stop()` is fine for "pause", but there's no way to properly dispose a world.

---

### [PERFORMANCE] Telemetry spans created every single tick even when telemetry is disabled
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/WorldLoop.ts:157-187`

Every tick creates multiple `Telemetry.startSpan()` calls with object allocations for attributes. At 60 Hz, this is 240+ object allocations per second per world just for telemetry metadata. If telemetry is disabled (likely in production), these are pure overhead.

**Recommended fix:** Guard span creation behind a `Telemetry.isEnabled` check, or make `startSpan` a true no-op that doesn't allocate the attributes object when disabled (lazy evaluation / callback pattern for attributes).

---

### [PERFORMANCE] Simulation event emission on every step even without listeners
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/Simulation.ts:516-544`

`STEP_START` and `STEP_END` events are emitted every tick (60 Hz) regardless of whether anyone is listening. Each `emitWithWorld` call involves the EventRouter dispatch chain. The debug rendering check (line 539) is correctly guarded, but the step events are not.

**Recommended fix:** Guard with `if (this.hasListeners(SimulationEvent.STEP_START))` before emitting. Same for `STEP_END`.

---

### [PERFORMANCE] `getWorldsByTag` does linear scan of all worlds
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/WorldManager.ts:151-161`

`getWorldsByTag()` iterates all worlds and allocates a new array. For servers with many worlds (e.g., instanced dungeons), a `Map<string, Set<World>>` tag index would be O(1).

**Recommended fix:** Maintain a `_worldsByTag: Map<string, Set<World>>` alongside `_worlds`, updated on create/destroy/tag-change.

---

### [BUG] `ColliderMap` double-buffered cleanup may miss rapid add-remove-add sequences
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/ColliderMap.ts:134-211`

The cleanup uses a two-phase system: pending -> cleanup -> deleted. When `queueColliderHandleForCleanup` is called, the handle goes to `_pending`. On next `cleanup()`, it moves to `_cleanup`. On the NEXT `cleanup()`, it's actually deleted. However, if a handle is queued for cleanup (added to pending) and then immediately re-registered (via `setColliderHandleBlockType` which clears it from both pending and cleanup at lines 118-119), it works correctly. But consider: if handle H is queued for cleanup, moves to `_cleanup` set, and then on the SAME tick a new collider reuses handle H (Rapier can reuse handles), `setColliderHandleBlockType` clears it from cleanup. This seems correct.

However, there's a subtle issue: the cleanup comment (line 176-183) explains the spider/bullet scenario, but the two-tick delay means that for TWO full ticks after removal, the collider handle still maps to the old BlockType/Entity. During these two ticks, any collision events involving that handle will incorrectly route to the old (now-invalid) object.

**Recommended fix:** Consider whether one tick of delay is sufficient instead of two, or verify that the stale mapping during the delay window doesn't cause issues for game logic that reads the mapped object.

---

### [BUG] `setBlock` early-return skips rotation-only changes when same blockTypeId
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:430`

```typescript
if (previousBlockTypeId === blockTypeId && !blockRotation) return;
```

This returns early if the block type hasn't changed AND no rotation is specified. But what if the user wants to clear a rotation (reset to default) by calling `setBlock(coord, sameId)` without a rotation? The early return prevents this. Also, if the previous block HAD a rotation and the user sets the same block type with a DIFFERENT rotation, this doesn't early-return (correct). But setting the same type with `undefined` rotation when the block already has a rotation will early-return instead of clearing the rotation.

**Recommended fix:** Compare the full state including rotation:
```typescript
const previousRotation = chunk.getBlockRotation(localCoordinate);
if (previousBlockTypeId === blockTypeId && (blockRotation ?? BLOCK_ROTATIONS.Y_0) === previousRotation) return;
```

---

### [FEATURE] No way to remove/destroy a world from WorldManager
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/WorldManager.ts`

`WorldManager` has `createWorld()` but no `removeWorld()` or `destroyWorld()`. Once created, worlds live forever in `_worlds`. For games with instanced dungeons, arenas, or temporary worlds, this is a memory leak. Combined with the `World.stop()` issue above (no WASM cleanup), there's no way to properly dispose of a world.

**Recommended fix:** Add `removeWorld(id: number)` that calls `world.stop()`, removes from `_worlds`, emits a `WORLD_REMOVED` event, and invokes a new `world.destroy()` method for proper resource cleanup.

---

### [PERFORMANCE] BigInt chunk keys have overhead vs integer keys
**Benefit: 3/5 | Risk: 3/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:615-621`

Chunk coordinates are packed into a BigInt via `_packCoordinate()`. BigInt operations are significantly slower than regular number operations in V8 (10-100x depending on operation). Every `getChunk`, `hasChunk`, `getBlockId`, `setBlock` etc. calls `_getChunkKey` which calls `_packCoordinate` with BigInt arithmetic.

The coordinate range uses 54-bit segments for x/y/z, which is needed for very large worlds but overkill for typical game worlds. With 16-block chunks, a 32-bit signed range per axis would cover +/- 34 billion blocks.

**Recommended fix:** For typical world sizes, a string key (`${ox},${oy},${oz}`) or a 53-bit safe integer key (if coordinates fit in ~17 bits each) would be faster. Alternatively, precompute and cache chunk keys to avoid repeated BigInt allocation.

---

### [PERFORMANCE] `_getBlockTypePlacements` iterates all chunk masks with bit scanning
**Benefit: 3/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:556-601`

This method reconstructs ALL block placements for a block type by scanning bitmasks. It allocates a new `BlockPlacement` object per block, a new `globalCoordinate` object per block, and a new array. For trimesh block types with thousands of blocks, this is called on every `_recreateTrimeshCollider` which is called on every `setBlock`. This is the hot path for trimesh editing.

**Recommended fix:** For trimesh types, maintain a direct placement list alongside the bitmask. The bitmask is great for voxel operations but expensive to iterate for trimesh rebuilds.

---

### [BUG] `MAX_BLOCK_TYPE_ID = 255` limits world to 255 block types
**Benefit: 2/5 | Risk: 3/5 | Effort: 4/5 | Surgical: no | Backwards Compatible: no**

File: `server/src/worlds/blocks/Chunk.ts:21`

`Chunk._blocks` is a `Uint8Array`, limiting block type IDs to 0-255 (with 0 = air, so 255 usable types). For voxel games with many biomes, decorative blocks, and user-created blocks, 255 may be insufficient.

**Recommended fix:** This is a deep architectural change (Uint8Array -> Uint16Array doubles chunk memory from 4KB to 8KB per chunk, affects serialization, protocol, client). Only worth pursuing if the limit is actually being hit by SDK games.

---

### [PERFORMANCE] BLOCK_ROTATIONS_BY_INDEX sorted on every loadMap call
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/World.ts:514`

```typescript
const BLOCK_ROTATIONS_BY_INDEX = Object.values(BLOCK_ROTATIONS).sort((a, b) => a.enumIndex - b.enumIndex);
```

This creates and sorts a 24-element array every time `loadMap()` is called. Since `BLOCK_ROTATIONS` is a `const`, this should be computed once at module level.

**Recommended fix:** Move to a module-level constant:
```typescript
const BLOCK_ROTATIONS_BY_INDEX = Object.values(BLOCK_ROTATIONS).sort((a, b) => a.enumIndex - b.enumIndex);
```

---

### [BUG] Raycast epsilon adjustment assumes axis-aligned ray directions
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/Simulation.ts:455-464`

The block-hit calculation uses `ray.dir.x < 0 ? epsilon : -epsilon` to nudge the hit point into the correct block. This works perfectly for axis-aligned rays but may produce wrong results for diagonal rays that hit exactly on a block edge. For a ray traveling at 45 degrees hitting the exact corner of a block, the epsilon nudge may push the point into the wrong neighbor block.

**Recommended fix:** Instead of per-axis epsilon based on ray direction, use the surface normal of the hit (available from Rapier's `featureId`) to determine which side of the boundary the block is on. Alternatively, the current approach is "good enough" for most practical cases since exact-corner hits are exceedingly rare.

---

### [PERFORMANCE] `_applyRigidBodyOptions` and `_applyColliderOptions` create arrays of bound functions
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/RigidBody.ts:1601-1627` and `server/src/worlds/physics/Collider.ts:1572-1593`

Every rigid body and collider construction allocates an array of `[string, Function]` tuples with `.bind(this)` calls, then iterates them. With hundreds of entities, this is many small allocations.

**Recommended fix:** Use a direct if/switch chain or a static lookup table with method names (avoid `.bind()` per construction). This is micro-optimization but applies to every entity spawn.

---

### [BUG] No validation of collision group values in `CollisionGroupsBuilder`
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/CollisionGroupsBuilder.ts:97-100`

`buildRawCollisionGroups` uses bitwise OR to combine groups without validating that the input values are valid `CollisionGroup` enum values. Passing arbitrary numbers could produce unexpected collision behavior with no error.

**Recommended fix:** Validate that each group in `belongsTo` and `collidesWith` is a valid `CollisionGroup` value, or at least that the combined result fits in 16 bits.

---

### [PERFORMANCE] `intersectionsWithRawShape` deduplicates using a Set but creates objects for every result
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/Simulation.ts:372-407`

`intersectionsWithRawShape` creates a `Set` and `IntersectionResult[]` per call, plus individual result objects. For frequent overlap queries (e.g., area-of-effect abilities), this causes GC churn.

**Recommended fix:** Accept a pre-allocated results array and a callback pattern, allowing callers to reuse buffers.

---

### [FEATURE] No world-level entity spatial query (nearest entity, entities in radius)
**Benefit: 3/5 | Risk: 1/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/World.ts`

The only spatial queries available are raycast and shape intersection. There's no high-level API for "find entities within radius" or "find nearest entity of type X". Games commonly need these for AI, targeting, and area effects. Currently game developers must iterate all entities and compute distances manually.

**Recommended fix:** Add `simulation.entitiesInRadius(center, radius)` and `simulation.nearestEntity(center, filter?)` as convenience methods wrapping `intersectionsWithRawShape` with a ball shape.

---

### [PERFORMANCE] Ticker accumulator clamp may lose time under sustained load
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/shared/classes/Ticker.ts:125-127`

When `_accumulatorMs > _maxAccumulatorMs` (3 tick intervals), excess time is silently dropped. Combined with `TICK_SLOW_UPDATE_CAP = 2`, if the server consistently takes >2 tick intervals to process, it will perpetually lose time and run slower than 60 Hz without any warning or metric. The world appears to run in slow motion.

**Recommended fix:** Log a warning or emit a metric when accumulator clamping occurs. This helps developers diagnose "why is my game running slow" issues. Also consider making `TICK_SLOW_UPDATE_CAP` configurable per world.

---

### [BUG] `_requireNotRemoved` in RigidBody uses `ErrorHandler.error` (non-fatal) but returns boolean
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/RigidBody.ts:1733-1738`

`_requireNotRemoved` calls `ErrorHandler.error()` (which logs but doesn't throw) and returns `false`. The callers check the return value and early-return. This means operating on a removed rigid body is silently swallowed after a log message. The same pattern exists for `_requireDynamic`, `_requireKinematic`, etc. While this prevents crashes, it can mask bugs in game code where developers accidentally operate on removed bodies and never see the error.

**Recommended fix:** Consider at minimum making these errors more visible (e.g., development-mode assertions that throw). The current behavior is defensively safe but can hide logic bugs.

---

### [BUG] `World.loadMap` entities spawn during construction before world starts
**Benefit: 2/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/World.ts:327-329` and `server/src/worlds/World.ts:557-573`

If `options.map` is provided in the World constructor, `loadMap()` is called immediately (line 328). Inside `loadMap`, entities are spawned via `entity.spawn(this, ...)` (line 571). But the world loop hasn't started yet -- it starts later in `WorldManager.createWorld()` after construction (line 99). This means entities are spawned into a world that isn't ticking yet. If entity spawn logic relies on the world loop running (e.g., queuing work for next tick), it may not execute as expected.

**Recommended fix:** Defer entity spawning until after `world.start()`, or document that entities spawned during map load will exist in a pre-tick state.

---

### [FEATURE] No block-level metadata or per-block events
**Benefit: 2/5 | Risk: 2/5 | Effort: 4/5 | Surgical: no | Backwards Compatible: yes**

File: `server/src/worlds/blocks/Chunk.ts` and `server/src/worlds/blocks/BlockType.ts`

Blocks are stored as plain uint8 IDs with optional rotation. There's no per-block metadata (health, ownership, custom data). Events like `ENTITY_COLLISION` fire on the `BlockType` level, not the individual block instance. A game can't distinguish which specific block was collided with beyond the BlockType. The raycast does return a `Block` with coordinates, but there's no event-based mechanism for individual block interaction.

**Recommended fix:** This is a deep architectural choice. Adding per-block metadata would significantly increase memory usage. A lightweight approach: allow `BlockType.ENTITY_COLLISION` payload to include the block coordinate (it currently only includes `blockType` and `entity`). This would let game logic react to specific block positions without per-block storage.

---

### [PERFORMANCE] `_onCollisionEvent` and `_onContactForceEvent` do redundant lookups
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/physics/Simulation.ts:548-567` and `server/src/worlds/physics/Simulation.ts:570-593`

Both collision handlers call `handleCollision(objectA, objectB)` then `handleCollision(objectB, objectA)`. Inside `handleCollision`, the `instanceof` checks and `hasListeners` checks are done again for the swapped order. For BlockType-Entity collisions, this means 4 instanceof checks + 2 hasListeners calls when only 2 + 1 are needed.

**Recommended fix:** Refactor to determine the types once, then dispatch directly. Minor optimization but this runs on every collision event at 60 Hz.

---

### [PERFORMANCE] ChunkLattice rigid body created lazily but never removed
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:340-343` and `server/src/worlds/blocks/ChunkLattice.ts:434-437`

The `_rigidBody` for the chunk lattice is created lazily when the first block is placed but is never removed or cleaned up. After `clear()`, the colliders are removed but the empty fixed rigid body persists in the simulation. This is a minor leak -- one empty rigid body per world per clear cycle.

**Recommended fix:** Remove `_rigidBody` from simulation in `clear()` and set to undefined.

---

### [BUG] `newCount` calculation in `setBlock` removal path has off-by-one potential
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts:441`

```typescript
const newCount = Math.max(0, this.getBlockTypeCount(previousBlockTypeId) - 1);
```

This reads the count BEFORE `_removeBlockTypePlacement` is called (line 444). But `_removeBlockTypePlacement` also decrements the count internally (line 682-684). So after line 444 executes, the actual count is already `newCount`. However, the `newCount` variable is only used for the `if (newCount === 0)` check (line 447), which compares against the pre-removal expected count. This is actually correct because `_removeBlockTypePlacement` hasn't been called yet when newCount is computed. But it's fragile -- if the order changes, the logic breaks silently.

**Recommended fix:** Compute `newCount` after `_removeBlockTypePlacement`, reading the actual count: `const newCount = this.getBlockTypeCount(previousBlockTypeId);`

---

### [FEATURE] No chunk unloading for distant/empty chunks
**Benefit: 3/5 | Risk: 3/5 | Effort: 4/5 | Surgical: no | Backwards Compatible: yes**

File: `server/src/worlds/blocks/ChunkLattice.ts`

Once a chunk is created, it exists forever in the `_chunks` map. There's no distance-based unloading relative to players. For large worlds where players explore and move on, empty or distant chunks consume memory indefinitely. Each chunk is 4KB (Uint8Array of 4096) plus the Map entry and rotation map overhead.

**Recommended fix:** Implement chunk lifecycle: track which chunks have active blocks, remove empty chunks after all blocks are cleared (currently chunks persist even when all blocks are set to air). For distance-based unloading, this would need integration with the player system.
