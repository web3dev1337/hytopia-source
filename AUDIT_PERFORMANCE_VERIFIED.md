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

## Summary Table — All 40 Claims

### Server (20 claims)

| # | Claim | Verdict | Impact |
|---|-------|---------|--------|
| S1 | Trimesh collider fully recreated per block edit | CONFIRMED | Moderate |
| S2 | `gzipSync` blocks event loop | CONFIRMED | Moderate |
| S3 | Sequential model loading at startup | CONFIRMED | Moderate (startup only) |
| S4 | Full world state queued on player join | PARTIALLY CONFIRMED | Moderate |
| S5 | BigInt chunk keys overhead | CONFIRMED | Low (necessary tradeoff) |
| S6 | `_propagateVoxelChange` iterates all colliders | CONFIRMED | Low |
| S7 | `_combineVoxelStates` O(K²) | PARTIALLY CONFIRMED | Trivial (init only) |
| S8 | Per-packet AJV validation redundant | PARTIALLY CONFIRMED | Trivial |
| S9 | Vector3/Quaternion extend Float32Array | CONFIRMED | Trivial (gl-matrix interop) |
| S10 | `getAllChunks()`/`getAllWorlds()` create arrays | CONFIRMED | Trivial |
| S11 | Heartbeat creates packet array per beat | CONFIRMED | Trivial |
| S12 | Bound function arrays in options apply | CONFIRMED | Trivial |
| S13 | Checksum reads + base64 encodes file | CONFIRMED | Trivial (startup only) |
| S14 | Linear scan for entity-attached lookups | CONFIRMED | Trivial |
| S15 | Padded texture iterates interior pixels | CONFIRMED | Trivial (startup only) |
| S16 | Fragile reliable/unreliable classification | CONFIRMED | Low (maintainability) |
| S17 | Telemetry spans when disabled | **REJECTED** | N/A |
| S18 | `getProcessStats` called twice | **REJECTED** | N/A |
| S19 | setTimeout makes 60Hz unreliable | PARTIALLY CONFIRMED | Trivial (correct pattern) |
| S20 | Events emitted without listeners | PARTIALLY CONFIRMED | Trivial |

### Client (20 claims)

| # | Claim | Verdict | Impact |
|---|-------|---------|--------|
| C1 | No greedy meshing | CONFIRMED | **Significant** |
| C2 | Light iterates all sources per block | CONFIRMED | **Significant** |
| C3 | number[] then convert to typed arrays | CONFIRMED | Moderate |
| C4 | BoundaryVolume string-key Map | CONFIRMED | Moderate |
| C5 | Every-frame batch view distance iteration | CONFIRMED | Moderate |
| C6 | Instance attributes copied every frame | PARTIALLY CONFIRMED | Moderate |
| C7 | New BufferGeometry per chunk update | CONFIRMED | Moderate |
| C8 | Camera allocates vectors per frame | CONFIRMED | Moderate |
| C9 | Outline pass 8-direction search | PARTIALLY CONFIRMED | Moderate |
| C10 | `getLightSources` scans 4096 blocks | PARTIALLY CONFIRMED | Low (cached) |
| C11 | CSS2D transform strings per frame | PARTIALLY CONFIRMED | Low |
| C12 | Geometry cloned on InstancedMesh resize | CONFIRMED | Low |
| C13 | Block data copied not transferred | CONFIRMED | Low (intentional) |
| C14 | Deserializer intermediate objects | CONFIRMED | Low |
| C15 | AO cache linear scan | CONFIRMED | Trivial |
| C16 | `getBatchChunkIds` creates array | CONFIRMED | Trivial |
| C17 | Legacy atlas O(n) space finding | CONFIRMED | Trivial |
| C18 | No frustum culling for batches | **REJECTED** | N/A |
| C19 | Post-processing all passes unconditional | **REJECTED** | N/A |
| C20 | Outline pass 8-dir search (duplicate of C9) | PARTIALLY CONFIRMED | Moderate |

---

## Full Evidence — Server Performance

---

### S1: Trimesh collider fully recreated on every block edit

**Verdict: CONFIRMED | Impact: Moderate**

`server/src/worlds/blocks/ChunkLattice.ts:457-461`:
```typescript
if (collider.isTrimesh) {
  this._recreateTrimeshCollider(previousBlockTypeId);
}
```

`server/src/worlds/blocks/ChunkLattice.ts:485-487`:
```typescript
if (collider.isTrimesh) {
  this._recreateTrimeshCollider(blockTypeId);
}
```

`server/src/worlds/blocks/ChunkLattice.ts:527-541` — the recreate method:
```typescript
private _recreateTrimeshCollider(blockTypeId: number): void {
    const existingCollider = this._blockTypeColliders.get(blockTypeId);
    if (existingCollider) {
      existingCollider.removeFromSimulation();
      this._blockTypeColliders.delete(blockTypeId);
    }
    const blockType = this._world.blockTypeRegistry.getBlockType(blockTypeId);
    const blockPlacements = this._getBlockTypePlacements(blockTypeId);
    const collider = this.getOrCreateBlockTypeCollider(blockTypeId, blockPlacements);
    collider.addToSimulation(this._world.simulation, this._rigidBody);
    this._world.simulation.colliderMap.setColliderBlockType(collider, blockType);
}
```

**Analysis:** Every `setBlock` call on a trimesh block type removes the old collider from simulation, gathers ALL block placements for that type, and creates a brand-new collider. Both the removal path (line 457) and the addition path (line 485) trigger full rebuilds. However, standard voxel colliders (the common case) use incremental `setVoxel()` — only custom-mesh (trimesh) block types suffer this. Impact scales with how frequently trimesh blocks are edited at runtime.

---

### S2: Synchronous gzipSync blocks event loop

**Verdict: CONFIRMED | Impact: Moderate**

`server/src/networking/Connection.ts:183`:
```typescript
if (outputBuffer.byteLength > 64 * 1024) {
  outputBuffer = gzipSync(outputBuffer, { level: 1 });
}
```

**Analysis:** `gzipSync` from the `zlib` module is called synchronously on the main thread. The compression level is 1 (fastest), and it only triggers for payloads >64KB (primarily chunk data on player join). The result is cached (`Connection._cachedPacketsSerializedBuffer`), so repeated sends of the same data don't re-compress. During normal gameplay, few packets exceed 64KB. Estimated 0.5-2ms per call for typical chunk sizes. The fix is a 1-line change to async `gzip`.

---

### S3: Sequential model loading at startup

**Verdict: CONFIRMED | Impact: Moderate (startup only)**

`server/src/models/ModelRegistry.ts:181-187`:
```typescript
for (const absoluteModelPath of absoluteModelPaths) {
    if (this.optimize) {
      await this._resolveOptimizedModelPath(absoluteModelPath);
    }
    await this._loadModelData(absoluteModelPath);
}
```

**Analysis:** Models are loaded sequentially with `await` in a `for` loop. Each model must finish loading (and potentially optimizing) before the next starts. `Promise.all` with a concurrency limit could parallelize I/O. Note: the optimization step (`_resolveOptimizedModelPath`) runs shell commands (`npx @gltf-transform/cli`), which might contend for CPU if parallelized aggressively. Zero runtime impact — startup-only cost.

---

### S4: Full world state queued on player join

**Verdict: PARTIALLY CONFIRMED | Impact: Moderate**

`server/src/networking/NetworkSynchronizer.ts:1084-1149`:
```typescript
private _onPlayerJoinedWorld = (payload: EventPayloads[PlayerEvent.JOINED_WORLD]) => {
    const { player } = payload;
    // Sync Audio
    for (const audio of this._world.audioManager.getAllAudios()) { ... }
    // Sync Block Types
    for (const blockType of this._world.blockTypeRegistry.getAllBlockTypes()) { ... }
    // Sync Camera ...
    // Sync Chunks
    for (const chunk of this._world.chunkLattice.getAllChunks()) { ... }
    // Sync Entities
    for (const entity of this._world.entityManager.getAllEntities()) { ... }
    // Sync Particle Emitters, Players, Scene UIs, World ...
};
```

**Analysis:** All world state is queued for the joining player — all chunks, entities, audio, particles, UI. However, it does NOT send them all at once. It queues them into the per-player sync queue (`_createOrGetQueuedChunkSync(chunk, player)`), and the actual sending happens in `synchronize()` on the next network sync tick, which batches into packets. The state IS sent in one synchronization cycle (not streamed over multiple ticks), which produces a burst. The original claim that there's "no chunking" is misleading — data is organized per-chunk/entity, just flushed in one go.

---

### S5: BigInt chunk keys have overhead vs integer keys

**Verdict: CONFIRMED | Impact: Low (necessary tradeoff)**

`server/src/worlds/blocks/ChunkLattice.ts:615-621`:
```typescript
private _packCoordinate(coordinate: Vector3Like): bigint {
    const x = BigInt.asUintN(CHUNK_KEY_COORD_BITS, BigInt(Math.trunc(coordinate.x)));
    const y = BigInt.asUintN(CHUNK_KEY_COORD_BITS, BigInt(Math.trunc(coordinate.y)));
    const z = BigInt.asUintN(CHUNK_KEY_COORD_BITS, BigInt(Math.trunc(coordinate.z)));
    return (x << CHUNK_KEY_X_SHIFT) | (y << CHUNK_KEY_Y_SHIFT) | z;
}
```

Where `CHUNK_KEY_COORD_BITS = 54` (3 × 54 = 162 bits total).

**Analysis:** BigInt operations are slower than Number operations in V8 — Map lookups with BigInt keys can't use SMI (Small Integer) optimizations. However, the reason is clear: they need to pack three 54-bit coordinates into a single key, which exceeds JavaScript's 53-bit safe integer range. A 32-bit packing (10-11 bits per axis) would severely limit world size. This is a deliberate tradeoff. String keys like `"x,y,z"` would likely be similar or worse performance. Microsecond-level overhead per lookup.

---

### S6: `_propagateVoxelChange` iterates ALL block type colliders per block edit

**Verdict: CONFIRMED | Impact: Low**

`server/src/worlds/blocks/ChunkLattice.ts:517-524`:
```typescript
private _propagateVoxelChange(collider: Collider, coordinate: Vector3Like): void {
    if (collider.isSensor) { return; }
    for (const otherCollider of this._blockTypeColliders.values()) {
      if (otherCollider === collider || otherCollider.isSensor || !otherCollider.isVoxel) { continue; }
      collider.propagateVoxelChange(otherCollider, coordinate);
    }
}
```

Called from `setBlock` at lines 454 and 482.

**Analysis:** Every voxel block edit iterates all block type colliders — O(K) per edit where K = number of distinct block type colliders. `propagateVoxelChange` is a lightweight coordinate-specific update on each neighboring collider. K is typically small (10-50), and the per-iteration work is minimal.

---

### S7: `_combineVoxelStates` is O(K²) in number of block types

**Verdict: PARTIALLY CONFIRMED | Impact: Trivial**

`server/src/worlds/blocks/ChunkLattice.ts:507-514`:
```typescript
private _combineVoxelStates(collider: Collider): void {
    if (collider.isSensor || !collider.isVoxel) { return; }
    for (const otherCollider of this._blockTypeColliders.values()) {
      if (otherCollider === collider || otherCollider.isSensor || !otherCollider.isVoxel) { continue; }
      collider.combineVoxelStates(otherCollider);
    }
}
```

**Analysis:** Called from `initializeBlockEntries` (line 393) inside a loop over all block types (line 379), making total initialization cost O(K²). But during `setBlock` (incremental edits), `_combineVoxelStates` is only called for new colliders (line 477, when `newCount === 1`), making that path O(K). The K² cost only applies to bulk initialization. K (distinct block types with active voxel colliders) is typically 10-50, so K² is negligible.

---

### S8: Per-packet validation in serializePackets is redundant

**Verdict: PARTIALLY CONFIRMED | Impact: Trivial**

`server/src/networking/Connection.ts:155-159`:
```typescript
public static serializePackets(packets: AnyPacket[]): Buffer | void {
    for (const packet of packets) {
      if (!protocol.isValidPacket(packet)) {
        return ErrorHandler.error(`Connection.serializePackets(): Invalid packet payload: ${JSON.stringify(packet)}`);
      }
    }
```

**Analysis:** Validation happens before serialization as a defensive check. Whether it's "redundant" depends on whether packets are already validated at creation. AJV compiled validators are fast, and the caching mechanism that follows (line 167 — cache keyed by array identity) means re-validation only happens once per unique packet array. Trivial overhead.

---

### S9: Vector3/Quaternion extend Float32Array (allocation cost)

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/shared/classes/Vector3.ts:24`:
```typescript
export default class Vector3 extends Float32Array implements Vector3Like {
  public constructor(x: number, y: number, z: number) {
    super([ x, y, z ]);
  }
```

`server/src/shared/classes/Quaternion.ts:22`:
```typescript
export default class Quaternion extends Float32Array implements QuaternionLike {
  public constructor(x: number, y: number, z: number, w: number) {
    super([ x, y, z, w ]);
  }
```

**Analysis:** TypedArrays have higher allocation overhead than plain objects due to backing ArrayBuffer allocation. This is intentional: enables zero-copy interop with gl-matrix and potentially WebAssembly/Rapier. The `Vector3Like` and `QuaternionLike` interfaces (plain `{x, y, z}` objects) are used throughout hot paths. The gl-matrix interop benefit outweighs the allocation overhead.

---

### S10: `getAllChunks()` and `getAllWorlds()` create new arrays every call

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/worlds/blocks/ChunkLattice.ts:268`:
```typescript
public getAllChunks(): Chunk[] {
    return Array.from(this._chunks.values());
}
```

`server/src/worlds/WorldManager.ts:116`:
```typescript
public getAllWorlds(): World[] {
    return Array.from(this._worlds.values());
}
```

**Analysis:** Both create new arrays via `Array.from()` on each call. `getAllWorlds` is trivial (1-3 worlds). `getAllChunks` creates arrays of hundreds of elements but is only called during player join sync and world initialization — NOT per-tick.

---

### S11: Heartbeat creates new packet array on every beat

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/networking/Connection.ts:434-439`:
```typescript
private _onHeartbeatPacket = () => {
    this.send([ protocol.createPacket(protocol.bidirectionalPackets.heartbeatPacketDefinition, null) ], true);
};
```

**Analysis:** Each heartbeat response creates a new single-element array and packet object. Heartbeats are infrequent (keepalive interval). V8's generational GC handles this efficiently.

---

### S12: `_applyRigidBodyOptions` and `_applyColliderOptions` create arrays of bound functions

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/worlds/physics/RigidBody.ts:1601-1627`:
```typescript
private _applyRigidBodyOptions(options: RigidBodyOptions) {
    const setters: Array<[string, (value: any) => void]> = [
      [ 'additionalMass', this.setAdditionalMass.bind(this) ],
      [ 'additionalMassProperties', this.setAdditionalMassProperties.bind(this) ],
      ...17 entries total...
    ];
    setters.forEach(([ key, setter ]) => {
      if (key in options) {
        setter(options[key as keyof typeof options]);
      }
    });
}
```

Same pattern in `Collider.ts:1572-1593` with ~12 entries.

**Analysis:** Each call creates ~12-17 `[string, function]` tuples with `.bind(this)` closures, discarded after the loop. Only called during entity/collider construction, not per-tick. Microseconds of work.

---

### S13: `_calculateChecksum` reads entire file + base64 encodes

**Verdict: CONFIRMED | Impact: Trivial (startup only)**

`server/src/models/ModelRegistry.ts:545-553`:
```typescript
private _calculateChecksum(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    const fileContent = fs.readFileSync(filePath);
    return crypto.createHash('sha256')
      .update(fileContent.toString('base64'))
      .update(MODEL_REGISTRY_CONFIG.VERSION.toString())
      .digest('hex');
}
```

**Analysis:** `.toString('base64')` allocates a string ~33% larger than the binary data. `crypto.createHash().update()` accepts Buffers directly — the base64 step is unnecessary. Only runs at startup during model preloading/cache validation. For a 5MB model, it allocates an extra ~6.7MB of string temporarily.

---

### S14: Linear scan for entity-attached lookups

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/worlds/audios/AudioManager.ts:74-76`:
```typescript
public getAllEntityAttachedAudios(entity: Entity): Audio[] {
    return this.getAllAudios().filter(audio => audio.attachedToEntity === entity);
}
```

Same pattern in `SceneUIManager.ts:65-66` and `ParticleEmitterManager.ts:72-73`.

**Analysis:** `getAllX().filter(...)` creates a full array then scans linearly. O(N) where N = total items in the manager. Only called during entity despawn (infrequent). Typical world has 10-100 items. A reverse index would be premature optimization.

---

### S15: `_createPaddedTexture` iterates all pixels including interior

**Verdict: CONFIRMED | Impact: Trivial**

`server/src/textures/BlockTextureRegistry.ts:329-337`:
```typescript
for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      if (y < pad || y >= pad + size || x < pad || x >= pad + size) {
        const srcX = Math.max(pad, Math.min(pad + size - 1, x));
        const srcY = Math.max(pad, Math.min(pad + size - 1, y));
        copy(srcX, srcY, x, y);
      }
    }
}
```

**Analysis:** Loop runs over ALL pixels (64×64 = 4096 with default config). The `if` skips interior pixels but the check runs for every pixel. Only ~1440 of 4096 are actually padding. This is startup-only during atlas generation — ~576 wasted branch checks per texture is nanoseconds.

---

### S16: Entity sync reliable/unreliable classification is fragile

**Verdict: CONFIRMED | Impact: Low (maintainability concern)**

`server/src/networking/NetworkSynchronizer.ts:163-176`:
```typescript
if (this._queuedEntitySyncs.broadcast.size > 0) {
    const reliableUpdates: protocol.EntitySchema[] = [];
    const unreliableUpdates: protocol.EntitySchema[] = [];
    for (const entitySync of this._queuedEntitySyncs.broadcast.valuesArray) {
      let isReliableUpdate = false;
      for (const key in entitySync) {
        isReliableUpdate = key !== 'i' && key !== 'p' && key !== 'r';
        if (isReliableUpdate) { break; }
      }
      (isReliableUpdate ? reliableUpdates : unreliableUpdates).push(entitySync);
    }
```

**Analysis:** Uses `for...in` to iterate object keys and checks if any key is NOT `i` (id), `p` (position), or `r` (rotation). Adding new unreliable-safe fields requires modifying this check. Functionally works for the current protocol schema. The concern is maintainability, not runtime performance.

---

### S17: Telemetry spans created every tick even when disabled

**Verdict: REJECTED**

`server/src/metrics/Telemetry.ts:224-234`:
```typescript
public static startSpan<T>(options: TelemetrySpanOptions, callback: (span?: Sentry.Span) => T): T {
    if (Sentry.isInitialized()) {
      return Sentry.startSpan({ ... }, callback);
    } else {
      return callback();
    }
}
```

**Analysis:** When Sentry is NOT initialized, `startSpan` calls `callback()` directly — no span objects created. The options object literal at call sites is still allocated, but that's a trivial V8-optimized short-lived object. The claim is **wrong**.

---

### S18: `getProcessStats` called twice for slow ticks

**Verdict: REJECTED**

`server/src/metrics/Telemetry.ts:163-186`:
```typescript
beforeSend: event => {                          // handles ERROR events
    event.extra = Telemetry.getProcessStats();
    return event;
},
beforeSendTransaction: event => {               // handles TRANSACTION events
    const spanOp = event.contexts?.trace?.op;
    if (spanOp === TelemetrySpanOperation.TICKER_TICK) {
      ...
      if (tickTimeMs > tickTimeMsThreshold) {
        event.measurements = Telemetry.getProcessStats(true);
        return event;
      }
    }
    return null;
},
```

**Analysis:** These are two different Sentry callbacks: `beforeSend` for errors, `beforeSendTransaction` for performance spans. They do NOT fire for the same event. The claim is **factually wrong**.

---

### S19: Ticker uses setTimeout for 60 Hz loop — inherent jitter

**Verdict: PARTIALLY CONFIRMED | Impact: Trivial (correct pattern)**

`server/src/shared/classes/Ticker.ts:147`:
```typescript
this._tickHandle = setTimeout(tick, this._nextTickMs);
```

With fixed-timestep accumulator at lines 123-136:
```typescript
// Accumulates elapsed time and processes multiple updates in a while loop
// TICK_SLOW_UPDATE_CAP = 2, MAX_ACCUMULATOR_TICK_MULTIPLE = 3
```

**Analysis:** `setTimeout` does have scheduling jitter (1-4ms), but the Ticker implements a standard fixed-timestep accumulator pattern that compensates. Physics steps are always the same fixed delta regardless of scheduling variance. The `setTimeout` delay is dynamically calculated based on remaining accumulator time. This is the correct approach used by virtually all game engines. The "jitter" is in scheduling, not in simulation correctness.

---

### S20: Simulation event emission on every step even without listeners

**Verdict: PARTIALLY CONFIRMED | Impact: Trivial**

`server/src/worlds/physics/Simulation.ts:516-544`:
```typescript
public step = (tickDeltaMs: number): void => {
    this.emitWithWorld(this._world, SimulationEvent.STEP_START, {
      simulation: this,
      tickDeltaMs,
    });
    // ... physics step ...
    this.emitWithWorld(this._world, SimulationEvent.STEP_END, {
      simulation: this,
      stepDurationMs: performance.now() - stepStart,
    });
};
```

`server/src/events/EventRouter.ts:46-47`:
```typescript
public emit(eventType: string, payload: any): boolean {
    if (this.listenerCount(eventType) === 0) return false;
```

**Analysis:** Payload object literals (`{ simulation: this, tickDeltaMs }`) are allocated every step regardless. But `EventRouter.emit()` bails out at `listenerCount === 0` — no actual listener dispatch occurs. The payload objects are small, short-lived, and V8 GCs them efficiently.

---

## Full Evidence — Client Performance

---

### C1: No greedy meshing in ChunkWorker

**Verdict: CONFIRMED | Impact: Significant**

`client/src/workers/ChunkWorker.ts:950-1182`:
```typescript
for (const blockFace of blockType.faces) {
  const { normal: faceDir, vertices } = blockType.faceGeometries[blockFace];
  // ... neighbor culling ...
  for (const { pos, uv, ao } of vertices) {
    meshPositions.push(vertexX, vertexY, vertexZ);
    // ... push normals, UVs, colors per vertex
  }
  meshIndices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
}
```

**Analysis:** The code iterates block by block, face by face, emitting a quad (4 vertices, 6 indices) per visible face. There is no merging of coplanar adjacent faces into larger quads. Greedy meshing can reduce vertex count by 10-50x on large flat surfaces (walls, floors, ceilings). Face culling IS present (hidden faces between opaque blocks are skipped), and the engine uses batch meshing (multiple 16³ chunks per batch), which mitigates vs absolute worst case. Still the single biggest rendering optimization opportunity in the engine.

---

### C2: Light calculation iterates all nearby light sources per block

**Verdict: CONFIRMED | Impact: Significant**

`client/src/workers/ChunkWorker.ts:1228-1265`:
```typescript
private _calculateLightLevel(x: number, y: number, z: number, lightSources: LightSource[]): number {
  let maxLightLevel = 0;
  for (let i = 0, len = lightSources.length; i < len; i++) {
    const source = lightSources[i];
    const level = source.level;
    const dx = x - source.position.x + 0.5;
    const dy = y - source.position.y + 0.5;
    const dz = z - source.position.z + 0.5;
    // Quick rejection using absolute values (avoid sqrt)
    if (dx > level || dx < -level || dy > level || dy < -level || dz > level || dz < -level) {
      continue;
    }
    // ...
  }
}
```

Called per-block at line 779:
```typescript
const lightLevel = this._calculateLightLevel(globalX, globalY, globalZ, nearbyLightSources) & 0xF;
```

Light sources are collected from batch chunks plus neighbors (lines 700-724), and the function is called for every block in every chunk of the batch.

**Analysis:** O(blocks_in_batch × nearby_light_sources). For a batch of 8 chunks (2×2×2), that's up to 32,768 blocks, each iterating all nearby light sources. The AABB quick-rejection (`dx > level || dx < -level ...`) efficiently skips distant sources. For worlds with few light sources, the cost is manageable. For worlds with many light-emitting blocks, this becomes the dominant bottleneck. A flood-fill/BFS propagation approach would be O(blocks + sources × range) instead of O(blocks × sources).

---

### C3: ChunkWorker uses number[] arrays for geometry, then converts to typed arrays

**Verdict: CONFIRMED | Impact: Moderate**

`client/src/workers/ChunkWorker.ts:731-755` (allocation):
```typescript
const liquidMeshColors: number[] = [];
const liquidMeshIndices: number[] = [];
const liquidMeshNormals: number[] = [];
const liquidMeshPositions: number[] = [];
const liquidMeshUvs: number[] = [];
// ... same for opaque and transparent
```

`client/src/workers/ChunkWorker.ts:1192-1217` (conversion):
```typescript
return {
  liquidGeometry: liquidMeshPositions.length > 0 ? {
    colors: new Float32Array(liquidMeshColors),
    indices: this._createIndicesTypedArray(liquidMeshIndices, ...),
    normals: new Float32Array(liquidMeshNormals),
    positions: new Float32Array(liquidMeshPositions),
    uvs: new Float32Array(liquidMeshUvs),
  } : undefined,
```

**Analysis:** Geometry is built into regular JS `number[]` arrays via `.push()`, then converted to `Float32Array`/`Uint16Array`/`Uint32Array` at the end. Double memory during build — JS arrays exist alongside newly created typed arrays until GC collects the JS arrays. For a large batch with tens of thousands of faces, this can be several MB of transient memory. Runs in a Web Worker (no main-thread jank). Pre-sizing typed arrays would require knowing final size after culling, which is non-trivial.

---

### C4: BoundaryVolume uses string-key Map for block lookups

**Verdict: CONFIRMED | Impact: Moderate**

`client/src/workers/ChunkWorker.ts:131-152`:
```typescript
class BoundaryVolume {
  private _data = new Map<`${number},${number},${number}`, number>();

  // TODO: Avoid string creation every time to mitigate GC pressure
  private _key(x: number, y: number, z: number): `${number},${number},${number}` {
    return `${x},${y},${z}`;
  }

  public set(x: number, y: number, z: number, value: number): void {
    this._data.set(this._key(x, y, z), value);
  }

  public get(x: number, y: number, z: number): number {
    const key = this._key(x, y, z);
    if (!this._data.has(key)) { ... }
    return this._data.get(key)!;
  }
}
```

**Analysis:** String-key `"x,y,z"` format in a Map. The developers themselves flagged this with a TODO. Scope is limited to boundary data (coordinates outside the chunk's [0,15] range) — main chunk block storage uses `Uint8Array` with integer indexing (`Chunk._getIndex`). String key creation causes GC pressure during sky distance calculation and skylight sampling near chunk edges, not for every block in every chunk.

---

### C5: Every-frame batch view distance check iterates all batches

**Verdict: CONFIRMED | Impact: Moderate**

`client/src/chunks/ChunkManager.ts:68-89`:
```typescript
private _onAnimate = (_payload: RendererEventPayload.IAnimate): void => {
  ChunkStats.reset();
  // Optimization hints for future improvements: Calculating the distance between all
  // batches and the camera every frame might be costly.
  if (!this._game.settingsManager.qualityPerfTradeoff.viewDistance.enabled) {
    this._game.chunkMeshManager.addAllBatchMeshesToScene();
    return;
  }
  const viewDistance = this._game.renderer.viewDistance;
  const viewDistanceSquared = viewDistance * viewDistance;
  const cameraPos = this._game.camera.activeCamera.position;
  this._game.chunkMeshManager.applyBatchViewDistance(
    fromVec2.set(cameraPos.x, cameraPos.z), viewDistanceSquared
  );
}
```

**Analysis:** Iterates all batches every frame for a squared-distance check. The developers acknowledge this in a comment: "Calculating the distance between all batches and the camera every frame might be costly." Simple squared-distance check (no sqrt), only adds/removes from scene graph when state changes. For a typical world with a few hundred batches, sub-millisecond. Scales linearly with batch count.

---

### C6: GLTFManager copies all instance attributes every frame

**Verdict: PARTIALLY CONFIRMED | Impact: Moderate**

`client/src/gltf/GLTFManager.ts:1255-1377`:
```typescript
for (const clonedMesh of clonedMeshes) {
  // Accessing all cloned meshes every animation frame, copying necessary data,
  // and transferring it to the WebGL buffer may be costly for both the CPU and GPU.
  // However, since the rendering cost reduction currently provides a much greater
  // performance benefit, this is not a concern for now.
  instancedMesh.setMatrixAt(index, clonedMesh.matrixWorld);
  instancedMesh.geometry.getAttribute(INSTANCE_SKY_LIGHT_ATTRIBUTE)!.setX(index, ...);
}

if (needsColorAttribute) { /* copy all colors */ }
if (needsOpacityAttribute) { /* copy all opacities */ }
if (needsLightLevelAttribute) { /* copy all light levels */ }
if (needsEmissiveAttribute) { /* copy all emissives */ }
```

**Analysis:** Matrix data IS copied every frame unconditionally (entities can move/rotate at any time). However, color, opacity, light level, and emissive attributes are **conditional** — tracked by counters that increment/decrement when entities have non-default values. If all entities use default color/opacity/emissive, those attributes are skipped. The developers explicitly acknowledge the tradeoff in comments (lines 1256-1262) and note that instanced rendering benefit outweighs the copy cost.

---

### C7: ChunkMeshManager creates new BufferGeometry per update

**Verdict: CONFIRMED | Impact: Moderate**

`client/src/chunks/ChunkMeshManager.ts:36-108`:
```typescript
private _createOrUpdateMesh(id: BatchId, data: BlocksBufferGeometryData, ...): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, ...));
  geometry.setAttribute('normal', new BufferAttribute(normals, ...));
  // ... more attributes ...
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  let mesh = cache.get(id);
  if (mesh) {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  } else {
    mesh = new Mesh(geometry, material);
  }
}
```

**Analysis:** New `BufferGeometry` created every time, old disposed. Triggers GPU resource allocation/deallocation. However, geometry data arrives from the worker as new typed arrays (transferred, not copied), so new GPU buffer uploads are fundamentally necessary. Reusing the geometry object and updating buffer data could avoid some Three.js overhead, but the primary cost (GPU upload) would remain. Only happens on chunk batch rebuilds, not every frame.

---

### C8: Camera allocates vectors per frame in update methods

**Verdict: CONFIRMED | Impact: Moderate**

`client/src/core/Camera.ts:511`:
```typescript
lookAtDirection = new Vector3().subVectors(attachedPosition, lookAtPosition).normalize();
```

`client/src/core/Camera.ts:582`:
```typescript
const lookAtTarget = (lookAtPosition || attachedPosition).clone();
```

`client/src/core/Camera.ts:603`:
```typescript
const positionOffset = this._gameCamera.position.clone().sub(lookAtTarget);
```

`client/src/core/Camera.ts:765-766`:
```typescript
const forward = new Vector3(0, 0, -1).applyEuler(this._spectatorCamera.rotation);
const right = new Vector3(1, 0, 0).applyEuler(this._spectatorCamera.rotation);
```

**Analysis:** 2-3 `Vector3` objects per frame in update methods. Module-level working variables (`vec3`, `vec3b`, `vec3c`) exist and are used elsewhere in the file, but these specific per-frame paths allocate new objects instead of reusing them. The fix is straightforward: use the existing module-level vectors. Minor but real GC pressure every frame.

---

### C9: Outline pass 8-direction per-pixel search

**Verdict: PARTIALLY CONFIRMED | Impact: Moderate**

`client/src/three/postprocessing/SelectiveOutlinePass.ts:264-316`:
```glsl
// Pre-check at max thickness (early-out for most pixels)
bool needsSearch = false;
for (int i = 0; i < 8; i++) {
  vec2 sampleUv = vUv + offsets[i] * texel * maxThickness;
  float s1 = texture2D(tMask, sampleUv).r * 255.0;
  float s2 = texture2D(tMask2, sampleUv).r * 255.0;
  if (abs(s1 - occCenterId) > 0.5 || abs(s2 - nonOccCenterId) > 0.5) {
    needsSearch = true;
    break;
  }
}

// Full search only if pre-check found a boundary
if (needsSearch) {
  for (int t = 1; t <= MAX_THICKNESS; t++) {
    float thickness = float(t);
    if (thickness > maxThickness) { break; }
    for (int i = 0; i < 8; i++) {
      vec2 sampleUv = vUv + offsets[i] * texel * thickness;
      // ... sample mask textures ...
    }
  }
}
```

**Analysis:** Up to 8 × 16 × 2 = 256 texture samples per pixel in the worst case (MAX_THICKNESS = 16). BUT the pre-check samples 8 boundary points at max thickness first — if all match, the expensive loop is skipped entirely. The vast majority of pixels (far from outline edges) only do ~12 total samples. The pass is also disabled entirely when no outline targets exist. Standard GPU outline technique.

---

### C10: `getLightSources` scans all 4096 blocks

**Verdict: PARTIALLY CONFIRMED | Impact: Low**

`client/src/chunks/Chunk.ts:186-217`:
```typescript
public getLightSources(blockTypeRegistry: BlockTypeRegistry): LightSource[] {
  if (this._lightSources === undefined) {
    this._lightSources = [];
    // TODO: Optimize if possible
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const blockId = this.getBlockType({ x, y, z });
          if (blockId !== 0) {
            const blockType = blockTypeRegistry.getBlockType(blockId);
            if (blockType?.lightLevel) {
              this._lightSources.push({ position: { ... }, level: blockType.lightLevel });
            }
          }
        }
      }
    }
  }
  return this._lightSources;
}
```

**Analysis:** DOES iterate all 4096 blocks, but result is **cached** (`this._lightSources`). The full scan only runs once per chunk until cache invalidation (`this._lightSources = undefined` on `setBlock` or `clearLightSourceCache`). Subsequent calls return the cached array immediately. TODO comment shows developers acknowledge this. One-time cost per chunk lifetime.

---

### C11: CSS2DRenderer builds transform strings every frame

**Verdict: PARTIALLY CONFIRMED | Impact: Low**

`client/src/three/CSS2DRenderer.ts:160-170`:
```typescript
private _renderObject(object: CSS2DObject, camera: Camera): void {
  // ...
  tmpEl.style.transform = 'translate3d(' + (-100 * object.center.x) + '%,' + ...;
  if (element.style.transform !== tmpEl.style.transform) {
    element.style.transform = tmpEl.style.transform;
  }
```

**Analysis:** Builds transform strings every frame for every visible CSS2D object. But important optimizations exist: (1) only sets actual element's transform if it CHANGED (the `if` check), (2) has frustum culling to skip offscreen objects, (3) `willChange: 'transform'` hint for GPU compositing. The file header says this is an explicitly optimized fork of Three.js's CSS2DRenderer. String building is cheap; the expensive part (style recalc/reflow) is avoided by change-detection.

---

### C12: Geometry cloned on InstancedMesh resize

**Verdict: CONFIRMED | Impact: Low**

`client/src/gltf/GLTFManager.ts:798-803`:
```typescript
const newSize = threshold * INSTANCED_MESH_RESIZE_INCREASE_FACTOR;
const newPair: InstancedMeshPair = {
  opaque: new InstancedMeshEx(sourceMesh.geometry.clone(), opaqueMaterial, newSize),
  transparent: new InstancedMeshEx(sourceMesh.geometry.clone(), transparentMaterial, newSize)
};
instancedMeshPairs.push(newPair);
```

**Analysis:** Geometry IS cloned when creating a new InstancedMesh tier. But this doesn't happen on every resize — the system uses a tiered approach with `INSTANCED_MESH_RESIZE_INCREASE_FACTOR`. New pairs are only created when count exceeds the current tier's capacity. Previous tier's InstancedMesh remains as a smaller option. One-time cost per tier threshold crossing. Some geometry creation is unavoidable since InstancedMesh needs its own geometry for instance-specific attributes.

---

### C13: Block data copied (not transferred) between main thread and worker

**Verdict: CONFIRMED | Impact: Low (intentional)**

`client/src/chunks/ChunkManager.ts:150-160`:
```typescript
// Since blocks are also managed on the main thread, they are not transferred.
// However, if copying blocks becomes a performance or memory issue, this
// approach may need to be reconsidered.
const message: ChunkWorkerChunkUpdateMessage = {
  type: 'chunk_update',
  originCoordinate,
  blocks,
  blockRotations,
};
this._game.chunkWorkerClient.postMessage(message);
```

**Analysis:** `blocks` is a `Uint8Array` (4096 bytes per 16³ chunk). `postMessage` without transferables causes structured clone (copy). This is **intentional** and **documented** — the main thread also needs the data for block type lookups, liquid detection, etc. The comment explicitly acknowledges the tradeoff. 4KB per chunk is small. Geometry output from worker to main IS properly transferred (not copied), which is the much larger payload.

---

### C14: Deserializer creates many intermediate objects per packet

**Verdict: CONFIRMED | Impact: Low**

`client/src/network/Deserializer.ts:274-642`:
```typescript
public static deserializeEntity(entity: protocol.EntitySchema): DeserializedEntity {
  return {
    id: entity.i,
    emissiveColor: 'ec' in entity ? (entity.ec ? new THREE.Color(...) : null) : undefined,
    position: entity.p ? this.deserializeVector(entity.p) : undefined,
    rotation: entity.r ? this.deserializeQuaternion(entity.r) : undefined,
    tintColor: 't' in entity ? (entity.t ? new THREE.Color(...) : null) : undefined,
    // ... many more fields
  };
}

public static deserializeVector(vector: protocol.VectorSchema): THREE.Vector3Like {
  return { x: vector[0], y: vector[1], z: vector[2] };
}
```

**Analysis:** Standard deserialization practice. Plain objects (`{ x, y, z }`) are extremely cheap in modern JS engines. `THREE.Color` constructors are lightweight. Runs at 30 Hz network rate, not 60 Hz render rate. Object pools would add complexity for minimal gain.

---

### C15: AO cache linear scan of parallel arrays

**Verdict: CONFIRMED | Impact: Trivial**

`client/src/workers/ChunkWorker.ts:1615-1638`:
```typescript
private _sampleAOOpacity(x: number, y: number, z: number): number {
  for (let i = 0; i < aoCacheOpacity.length; i++) {
    if (aoCacheX[i] === x && aoCacheY[i] === y && aoCacheZ[i] === z) {
      return aoCacheOpacity[i];
    }
  }
  // ... compute and push to cache
  aoCacheX.push(x);
  aoCacheY.push(y);
  aoCacheZ.push(z);
  aoCacheOpacity.push(opacity);
  return opacity;
}
```

Cache cleared per-face at lines 991-994.

**Analysis:** Cache is cleared per-face (every 4 vertices). Linear scan is over at most ~3-4 entries per lookup. Linear scan over 3 items is actually **faster** than a hash map or any other data structure. This is an appropriate micro-optimization for the cache size involved.

---

### C16: `getBatchChunkIds` creates new array each call

**Verdict: CONFIRMED | Impact: Trivial**

`client/src/chunks/ChunkRegistry.ts:92-95`:
```typescript
public getBatchChunkIds(batchId: BatchId): ChunkId[] {
  const batch = this._batches.get(batchId);
  return batch ? Array.from(batch.chunkIds) : [];
}
```

**Analysis:** `Array.from()` on a `Set<ChunkId>`. Called on chunk packet arrival (batch rebuilds), NOT per-frame. A batch has at most 8 chunks (2×2×2). Tiny array, negligible allocation.

---

### C17: Legacy BlockTextureAtlasManager has O(n) brute-force space finding

**Verdict: CONFIRMED | Impact: Trivial**

`client/src/workers/BlockTextureAtlasManager.ts:192-215`:
```typescript
const existingTextures = Array.from(this._metadata.values());
for (let y = 0; y <= canvasHeight - tileHeight && !foundSpace; y++) {
  for (let x = 0; x <= canvasWidth - tileWidth; x++) {
    const hasOverlap = existingTextures.some(existing =>
      x < existing.x + existing.width &&
      x + tileWidth > existing.x &&
      y < existing.invertedY + existing.height &&
      y + tileHeight > existing.invertedY
    );
    if (!hasOverlap) { ... foundSpace = true; break; }
  }
}
```

**Analysis:** O(canvas_width × canvas_height × num_existing_textures). This is in the **legacy** atlas manager. The modern `BlockTextureAtlasManager` (line 399+) uses pre-generated atlas metadata and does NOT do runtime packing. Legacy code only runs for old SDK versions. Even in legacy mode, this runs once per unique texture during initialization.

---

### C18: No frustum culling for chunk batch meshes

**Verdict: REJECTED**

`client/src/chunks/ChunkMeshManager.ts:83, 95-97`:
```typescript
geometry.computeBoundingSphere();
// ...
mesh.matrixAutoUpdate = false;
mesh.matrixWorldAutoUpdate = false;
```

Three.js default `frustumCulled = true` is NOT overridden. `computeBoundingSphere()` is called. Additionally, the view distance system in `applyBatchViewDistance` removes distant batches from the scene graph entirely.

**Analysis:** The claim is **wrong**. Meshes ARE frustum culled by Three.js's built-in mechanism, and additionally culled by distance.

---

### C19: Post-processing chain runs all passes unconditionally

**Verdict: REJECTED**

`client/src/core/Renderer.ts:297-317`:
```typescript
const pp = this._game.settingsManager.qualityPerfTradeoff.postProcessing;
if (pp?.outline || pp?.bloom || pp?.smaa) {
  this._renderPass.camera = this._game.camera.activeCamera;
  this._viewModelRenderPass.enabled = this._firstPersonViewModelEntity !== undefined;
  this._outlinePass.enabled = !!pp.outline;
  this._bloomPass.enabled = !!pp.bloom;
  this._smaaPass.enabled = !!pp.smaa;
  this._effectComposer.render();
} else {
  this._renderer.render(this._scene, this._game.camera.activeCamera);
}
```

**Analysis:** Each pass is individually enabled/disabled based on settings. If NO post-processing is enabled, falls through to simple `renderer.render()`. The claim is **wrong**.

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
