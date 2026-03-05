# Hytopia Map Engine Architecture

This document describes how the Hytopia map engine is set up, its data flow, and a roadmap for adapting it to support **binary maps** for extremely large worlds (e.g., 100k×100k×64 blocks).

---

## 1. Architecture Overview

The map engine spans **server** (authoritative block state), **client** (rendering, meshing), and **protocol** (network serialization). Maps are loaded once at world initialization and populate a chunk-based block lattice.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MAP LOAD PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   JSON Map File          World.loadMap()         ChunkLattice            │
│   (blockTypes, blocks,   ───────────────►       initializeBlockEntries() │
│    entities)                        │                    │               │
│         │                           │                    ▼               │
│         │                           │           ChunkLattice clears,     │
│         │                           │           creates Chunks,          │
│         │                           │           builds colliders         │
│         │                           │                    │               │
│         │                           ▼                    ▼               │
│         │                   BlockTypeRegistry      Map<bigint, Chunk>    │
│         │                   (block types)          (sparse chunks)       │
│         │                                                    │           │
│         │                                                    ▼           │
│         │                                           NetworkSynchronizer  │
│         │                                           (chunk sync to       │
│         │                                            clients)            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. WorldMap Interface (JSON Format)

Maps conform to the `WorldMap` interface used by `World.loadMap()`:

| Section       | Purpose                                                | Location                      |
|---------------|--------------------------------------------------------|-------------------------------|
| `blockTypes`  | Block type definitions (id, name, textureUri, etc.)    | `server/src/worlds/World.ts`  |
| `blocks`      | Block placements keyed by `"x,y,z"` string             | `WorldMap.blocks`             |
| `entities`    | Entity spawns keyed by `"x,y,z"` position              | `WorldMap.entities`           |

### Block Format in JSON

Each block entry is either:

- **Short form:** `"x,y,z": <blockTypeId>`  (e.g. `"-25,0,-16": 7`)
- **Extended form:** `"x,y,z": { "i": <blockTypeId>, "r": <rotationIndex> }`

Coordinates are **world block coordinates** (integers). Block type IDs are 0–255 (0 = air, 1–255 = registered block types).

### Size Implications of JSON Maps

| Factor                    | Impact                                                                 |
|---------------------------|-----------------------------------------------------------------------|
| Sparse object keys        | Each block = `"x,y,z"` string key (10–20+ chars) + JSON overhead      |
| No chunk-level batching   | All blocks listed individually; no spatial grouping                   |
| Parsing cost              | Full JSON parse loads entire map into memory before processing        |
| File size                 | `boilerplate-small.json` ≈ 4,600+ lines; `big-world` ≈ 309,000+ lines |

For a **100k×100k×64** fully dense map:

- Blocks: 640 billion
- JSON would be impractically huge (hundreds of GB+ as text)
- Even sparse terrain would produce multi-GB JSON for large worlds

---

## 3. Chunk Model

### Chunk Dimensions

| Constant       | Value | Location                             |
|----------------|-------|--------------------------------------|
| `CHUNK_SIZE`   | 16    | `server/src/worlds/blocks/Chunk.ts`  |
| `CHUNK_VOLUME` | 4096  | 16³ blocks per chunk                 |
| `MAX_BLOCK_TYPE_ID` | 255 | `Chunk.ts`                      |

Chunk origins are multiples of 16 on each axis (e.g. `(0,0,0)`, `(16,0,0)`, `(0,16,0)`).

### Chunk Storage

- **`Chunk._blocks`:** `Uint8Array(4096)` – block type ID per voxel
- **`Chunk._blockRotations`:** `Map<number, BlockRotation>` – sparse map of block index → rotation
- **Block index:** `x + (y << 4) + (z << 8)` (local coords 0–15)

Chunks are stored in `ChunkLattice._chunks` as `Map<bigint, Chunk>` keyed by packed chunk origin:

```typescript
// ChunkLattice._packCoordinate() – 54 bits per axis
chunkKey = (x << 108) | (y << 54) | z
```

---

## 4. Load Flow: `World.loadMap()`

```typescript
// server/src/worlds/World.ts
public loadMap(map: WorldMap) {
  this.chunkLattice.clear();

  // 1. Register block types
  if (map.blockTypes) {
    for (const blockTypeData of map.blockTypes) {
      this.blockTypeRegistry.registerGenericBlockType({ ... });
    }
  }

  // 2. Iterate blocks as generator, feed to ChunkLattice
  if (map.blocks) {
    const blockEntries = function* () {
      for (const key in mapBlocks) {
        const blockValue = mapBlocks[key];
        const blockTypeId = typeof blockValue === 'number' ? blockValue : blockValue.i;
        const blockRotationIndex = typeof blockValue === 'number' ? undefined : blockValue.r;
        const [x, y, z] = key.split(',').map(Number);
        yield { globalCoordinate: { x, y, z }, blockTypeId, blockRotation };
      }
    };
    this.chunkLattice.initializeBlockEntries(blockEntries());
  }

  // 3. Spawn entities
  if (map.entities) { ... }
}
```

### `ChunkLattice.initializeBlockEntries()`

- Clears the lattice
- For each block: resolves chunk, creates chunk if needed, calls `chunk.setBlock()`
- Tracks block placements per type for colliders
- After all blocks: builds one collider per block type (voxel or trimesh)

---

## 5. Client-Server Chunk Sync

Chunks are serialized and sent to clients via `NetworkSynchronizer`:

| Protocol Field | Description                          |
|----------------|--------------------------------------|
| `c`            | Chunk origin `[x, y, z]`             |
| `b`            | Block IDs `Uint8Array \| number[]` (4096) |
| `r`            | Rotations: flat `[blockIndex, rotIndex, ...]` |
| `rm`           | Chunk removed flag                   |

- **Serializer:** `Serializer.serializeChunk()` → `protocol.ChunkSchema`
- **Client:** `Deserializer.deserializeChunk()` → `DeserializedChunk`
- **ChunkWorker:** Receives `chunk_update`, registers chunk, builds meshes

The client does **not** load the JSON map. It receives chunks from the server over the network after a player joins a world.

---

## 6. Key Files Reference

| Component            | Path                                             |
|----------------------|--------------------------------------------------|
| WorldMap interface   | `server/src/worlds/World.ts`                     |
| loadMap              | `server/src/worlds/World.ts`                     |
| ChunkLattice         | `server/src/worlds/blocks/ChunkLattice.ts`       |
| Chunk                | `server/src/worlds/blocks/Chunk.ts`              |
| ChunkSchema (proto)  | `protocol/schemas/Chunk.ts`                      |
| Serializer           | `server/src/networking/Serializer.ts`            |
| ChunkWorker (client) | `client/src/workers/ChunkWorker.ts`              |
| Deserializer         | `client/src/network/Deserializer.ts`             |

---

## 7. Binary Map Adaptation Roadmap for 100k×100k×64

To support huge maps efficiently, the engine should move from JSON to **binary map sources** with **chunk-level loading** and **streaming**.

### 7.1 Binary Chunk Format (Proposed)

Store one file or region per chunk (or region of chunks):

```
chunk.{cx}.{cy}.{cz}.bin   OR   region.{rx}.{ry}.{rz}.bin
```

**Suggested layout per chunk (raw):**

| Offset | Size   | Content                                  |
|--------|--------|------------------------------------------|
| 0      | 12     | Origin (3× int32: x, y, z)               |
| 12     | 4096   | Block IDs (Uint8Array)                   |
| 4108   | var    | Sparse rotations: count + [idx, rot]...  |

Or use a compact format (e.g. run-length encoding for air, or palette indices) for sparse chunks.

### 7.2 Streaming / Lazy Loading

- **Do not** load the entire map into memory.
- Use a **chunk provider** that:
  - Accepts `(chunkOriginX, chunkOriginY, chunkOriginZ)` and returns chunk data
  - Reads from binary files, memory-mapped files, or a database
- Replace the current `loadMap()` bulk load with:
  - Initial load of a small seed area (e.g. spawn region)
  - On-demand loading when `ChunkLattice.getOrCreateChunk()` needs a chunk not yet in memory

### 7.3 Implementation Strategy

1. **`MapProvider` interface**
   ```typescript
   interface MapProvider {
     getChunk(origin: Vector3Like): ChunkData | null | Promise<ChunkData | null>;
     getBlockTypes(): BlockTypeOptions[];
   }
   ```

2. **`BinaryMapProvider`**
   - Reads `.bin` chunk files from disk or object storage
   - Maps chunk origin → file path or byte range
   - Returns `{ blocks: Uint8Array, rotations: Map<number, number> }`

3. **ChunkLattice changes**
   - Replace `initializeBlockEntries()` full load with lazy `getOrCreateChunk()` that:
     - Checks `_chunks` cache
     - If miss: calls `MapProvider.getChunk()`, creates `Chunk`, inserts into `_chunks`
   - Optionally preload chunks in a radius around player(s)

4. **Block types**
   - Keep block types in a small JSON or separate binary; they are tiny compared to block data.
   - Load once at startup; no need to stream.

### 7.4 Scale Estimates for 100k×100k×64

| Metric                    | Value                    |
|---------------------------|--------------------------|
| World dimensions          | 100,000 × 100,000 × 64   |
| Chunks (16³)              | 6,250 × 6,250 × 4 ≈ 156M chunks |
| Bytes per chunk (raw)     | ~4.1 KB (blocks only)    |
| Raw block data (if dense) | ~640 GB                  |
| Sparse (e.g. surface)     | Much less; only store non-air chunks |

Binary format advantages:

- No JSON parsing; direct `Uint8Array` use
- Chunk-level I/O; load only what’s needed
- Possible memory-mapping for large files
- Optional compression (e.g. LZ4, Zstd) per chunk or region

### 7.5 Migration Path

1. **Phase 1:** Add `BinaryMapProvider` that reads chunk `.bin` files; `loadMap()` can accept `WorldMap | MapProvider`.
2. **Phase 2:** Make `ChunkLattice.getOrCreateChunk()` use the provider when a chunk is missing.
3. **Phase 3:** Add tooling to convert existing JSON maps → binary chunk files.
4. **Phase 4:** Optional region/compression format for production.

---

## 8. Summary

| Current (JSON)              | Target (Binary + Streaming)      |
|----------------------------|----------------------------------|
| Full map in memory         | Chunk-level loading              |
| Single large JSON parse    | Small reads per chunk            |
| Sparse object keys         | Dense `Uint8Array` per chunk     |
| Not viable for 100k³ scale | Designed for huge worlds         |

The existing `Chunk` and `ChunkLattice` design already matches a chunk-oriented model. The main changes are:

1. Replace JSON as the map source with a binary chunk provider.
2. Add lazy loading so chunks are fetched on demand.
3. Provide conversion tools and a clear binary chunk layout.
