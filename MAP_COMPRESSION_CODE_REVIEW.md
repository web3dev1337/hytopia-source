# Map Compression + Chunk Cache — Code Review (2026-03-04)

Scope:
- `WorldMapCodec` (compressed JSON maps)
- `WorldMapChunkCacheCodec` + `.chunks.bin` path
- `World.loadMap(...)` integration
- Benchmark tooling (`server/scripts/worldmap-benchmark.ts`)
- `WorldMapFileLoader` (“use cache only if it exists” + invalidation)

This review focuses on correctness + maintainability + pragmatic performance, not theoretical micro-optimizations.

## Overall

The implementation is solid and “surgical”:
- Backwards compatible with existing `WorldMap`.
- Adds two optional acceleration layers (`CompressedWorldMap`, then `.chunks.bin`).
- Uses official engine code paths for collider build and avoids private-field mutation (except an internal `Chunk.initializeRaw` hook, which is contained and reasonable).

## What’s Good

- Streaming decode for `CompressedWorldMap` avoids materializing a giant `{ "x,y,z": ... }` object (good for large maps).
- `.chunks.bin` is versioned and self-identifying via an 8-byte magic header.
- `World.loadMap(...)` auto-detects formats; call sites don’t need to change.
- Optional hash-based invalidation prevents silent stale cache loads.

## High Priority (Correctness / Future-Proofing)

### 1) Cache invalidation depends on a sibling `*.compressed.json`

`WorldMapFileLoader` validates `.chunks.bin` only when a sibling `*.compressed.json` exists. If a project only ships `map.json` + `map.chunks.bin` and edits `map.json` later, the cache can become stale without detection. (`server/src/worlds/maps/WorldMapFileLoader.ts:28`)

Pragmatic options:
- Treat `*.compressed.json` as the canonical “source of truth” when using caches (recommended); document that cache validation requires it.
- Or embed **two hashes** in metadata: `{ jsonSha256, compressedJsonSha256 }` and validate against whichever source file exists.

### 2) Metadata decode currently decompresses the whole cache

`WorldMapChunkCacheCodec.decodeMetadata(...)` runs through `_decodeFile(...)`, which decompresses the entire cache body even if we only need the hash for invalidation. (`server/src/worlds/maps/WorldMapChunkCacheCodec.ts:332`)

This is not wasted when we actually *use* the cache, but it is wasted on the “stale cache → fallback” path.

Pragmatic improvement (if we see this in practice):
- Put a small, uncompressed header block containing `sourceSha256` + metadata length, so invalidation checks don’t require full decompression.

### 3) Chunk origins are trusted

Cache decode yields `originCoordinate` per chunk and the lattice accepts it without verifying it’s aligned to 16. (`server/src/worlds/blocks/ChunkLattice.ts:411`)

Pragmatic safety improvement:
- Validate `originCoordinate.{x,y,z} % 16 === 0` in `initializeChunkCacheChunks` and fatal if not.

## Medium Priority (Readability / Duplication)

### 4) `World.loadMap(...)` duplication

Previously, `World.loadMap(...)` had duplicated “register block types” and “spawn entities” loops. This was refactored into local helpers for readability (good). (`server/src/worlds/World.ts:513`)

Remaining improvement:
- Consider extracting the coordinate parsing (`"x,y,z"`) into a shared helper (still repeated in codecs and loaders).

### 5) Cache codec complexity is OK, but could use clearer naming

In `WorldMapChunkCacheCodec.decode(...)`, variables like `rMetaLen`, `rRotCount` are fine but slightly “codec-y”. (`server/src/worlds/maps/WorldMapChunkCacheCodec.ts:218`)

Pragmatic option:
- Rename to `metaLenVarint`, `rotCountVarint` when touching the file again.

## Performance Notes (Pragmatic)

### 6) `initializeChunkCacheChunks` still does a “second scan”

The cache path builds `_blockTypeChunkMasks` + `_blockTypeCounts`, then later `_getBlockTypePlacements(...)` scans masks again to build collider placements. (`server/src/worlds/blocks/ChunkLattice.ts:451`)

This is consistent with the existing non-cache path, but the cache path has an opportunity to do better:
- While scanning chunk blocks the first time, also accumulate `BlockPlacement[]` per block type (using chunk rotations).
- Use that array for collider creation, while still keeping masks/counts for later incremental operations.

If we want the “plugin-style” peak load speeds, this is one of the next wins (still clean, still official behavior).

### 7) `Buffer.concat` in cache creation copies memory

`WorldMapChunkCacheCodec.create(...)` uses `Buffer.concat([header, bodyCompressed])`. (`server/src/worlds/maps/WorldMapChunkCacheCodec.ts:196`)

Not a big deal (header is tiny), but if we want to be picky:
- Allocate once and copy to avoid the concat allocation.

## Tooling / Benchmarking

### 8) Script linting vs `tsconfig.json`

Running `npx eslint ./src ./scripts` fails because `server/tsconfig.json` only includes `src/**/*`. The current workflow lints `./src` only. If we want scripts linted too, we should add a separate `tsconfig.scripts.json` and point ESLint at it. (`server/tsconfig.json:26`)

### 9) Benchmarks now capture “what you mean”

The `--bench-e2e` numbers are the right thing to use when comparing shipping formats:
- disk read + parse (if any) + `loadMap`
- and a “cold start init” line so you can add it when measuring full boot time

(`server/scripts/worldmap-benchmark.ts`)

## API/Behavior Surface Area

### 10) Events

`initializeChunkCacheChunks` emits `ADD_CHUNK` but does not emit `SET_BLOCK` per block (by design, for speed). If any game code depends on `SET_BLOCK` events at map-load time, it will behave differently only when using `.chunks.bin`. (`server/src/worlds/blocks/ChunkLattice.ts:417`)

Pragmatic stance:
- Keep as-is; “fast path” should not spam millions of events.
- Document this in SDK docs if it becomes a public/encouraged workflow.

## Summary Recommendation

Yes, this feature set is worth keeping:
- `CompressedWorldMap` stays the portable baseline format.
- `.chunks.bin` stays an optional acceleration layer.
- Hash invalidation should stay (prevents the worst class of “why is my world wrong?” bugs).

If you want the next speed increment without “hacky” plugin approaches:
- add an optional `blockPlacementsByType` accumulation inside `initializeChunkCacheChunks` to avoid rescanning chunk masks during collider creation.

