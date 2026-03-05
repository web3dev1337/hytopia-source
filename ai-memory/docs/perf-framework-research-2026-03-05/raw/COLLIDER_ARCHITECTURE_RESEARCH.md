# Collider Architecture Research

**Purpose:** Guide the refactor of Hytopia’s block collider system from O(world) to O(nearby chunks).  
**Audience:** Engineers implementing Phase 1 (Collider Locality) and Phase 2 (Incremental Voxel Updates).

---

## 1. Current Architecture

### 1.1 Block Type → Collider

- One collider per **block type** (dirt, stone, etc.), not per block.
- Voxel collider: Rapier voxel grid; each cell = block present/absent.
- Trimesh collider: Used for non-cube blocks; rebuilt when any block of that type changes.

### 1.2 Critical Path

```
setBlock / addChunkBlocks
  → _addBlockTypePlacement
  → _getBlockTypePlacements()   // iterates ALL chunks of this block type
  → _combineVoxelStates(collider)  // merges placements into voxel grid
  → collider.addToSimulation / setVoxel
```

**Problem:** `_getBlockTypePlacements` and `_combineVoxelStates` touch every chunk that contains the block type. As world size grows, this becomes O(world).

---

## 2. Target Architecture: Spatial Locality

### 2.1 Principle

- Colliders should only include blocks from chunks **within N chunks of any player** (e.g. N=4).
- When a chunk unloads (player moves away), remove its blocks from colliders.
- When a chunk loads, add its blocks to colliders only if it’s within the active radius.

### 2.2 Data Structure Change

**Current:** `_blockTypePlacements` is global (or implicitly spans all chunks).

**Target:** Maintain a **spatial index**:

```ts
// Chunk key (bigint) → for each block type in that chunk: Set of global coordinates
private _chunkBlockPlacements: Map<bigint, Map<number, Set<string>>> = new Map();

// Active chunk keys: chunks within COLLIDER_RADIUS of any player
private _activeColliderChunkKeys: Set<bigint> = new Set();
```

- On chunk load: add chunk key to index; add block placements.
- On chunk unload: remove chunk key; remove blocks from colliders.
- `_getBlockTypePlacements` for collider: only return placements from `_activeColliderChunkKeys`.
- `_combineVoxelStates`: only iterate over placements from active chunks.

### 2.3 Update Flow

```
Player moves
  → Update _activeColliderChunkKeys (chunks within radius)
  → For chunks that left radius: remove from colliders
  → For chunks that entered radius: add to colliders
  → _combineVoxelStates only over active placements
```

---

## 3. Incremental Voxel Updates

### 3.1 Current

- Adding a chunk: all 4096 blocks added at once to the voxel collider.
- Heavy: `setVoxel` 4096 times + propagation.

### 3.2 Target

- Add blocks in **batches** (e.g. 256–512 per tick).
- Time-budget: stop when budget exceeded; resume next tick.
- Rapier voxel API: check if it supports incremental `setVoxel` without full rebuild.

### 3.3 Implementation Sketch

```ts
private _pendingVoxelAdds: Array<{ chunk: Chunk; blockTypeId: number; nextIndex: number }> = [];

function processPendingVoxelAdds(timeBudgetMs: number) {
  const start = performance.now();
  while (this._pendingVoxelAdds.length > 0 && (performance.now() - start) < timeBudgetMs) {
    const next = this._pendingVoxelAdds[0];
    const chunk = next.chunk;
    const count = Math.min(256, chunk.blockCountForType(next.blockTypeId) - next.nextIndex);
    for (let i = 0; i < count; i++) {
      const idx = next.nextIndex + i;
      const globalCoord = chunk.getGlobalCoordinateFromIndex(idx);
      collider.setVoxel(globalCoord, true);
    }
    next.nextIndex += count;
    if (next.nextIndex >= chunk.blockCountForType(next.blockTypeId)) {
      this._pendingVoxelAdds.shift();
    }
  }
}
```

---

## 4. Trimesh Optimization

### 4.1 Current

- Trimesh collider rebuilt whenever any block of that type is added/removed.
- Rebuild = collect all placements, generate mesh, replace collider.

### 4.2 Options

1. **Spatial locality:** Only include trimesh blocks from active chunks. Reduces vertex count for large worlds.
2. **Deferred rebuild:** Queue rebuild; execute in next tick within time budget.
3. **Per-chunk trimesh:** If block type is sparse, consider per-chunk trimesh instances instead of one giant trimesh. (Larger change.)

**Recommendation:** Start with (1) and (2). (3) is Phase 6.

---

## 5. Collider Unload

When a chunk unloads:

1. Remove its block placements from the spatial index.
2. For each block type in that chunk:
   - Voxel: `setVoxel(coord, false)` for each placement.
   - Trimesh: trigger rebuild (only over active chunks).
3. Remove chunk from `_activeColliderChunkKeys`.

---

## 6. Rapier Voxel API Notes

- Check `rapier3d` docs for `ColliderDesc.heightfield` vs `ColliderDesc.voxel`.
- Voxel colliders: typically a 3D grid; `setVoxel` may or may not support incremental updates.
- If full rebuild required per update: minimize rebuild frequency (batch changes) and scope (active chunks only).

---

## 7. Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Chunks scanned per collider update | O(world) | O(active) ~100–300 |
| Time per `_combineVoxelStates` | 5–50 ms | <2 ms |
| Collider add spikes | Full chunk at once | Batched, time-budgeted |

---

## References

- `ChunkLattice.ts` – `_addChunkBlocksToColliders`, `_combineVoxelStates`, `_getBlockTypePlacements`
- Rapier3D voxel API
- Minecraft: per-section collision, spatial culling
