# Map Compression + Chunk Cache — Ship-Ready Review (updated 2026-03-04)

Scope (current code):
- `WorldMapCodec` (`CompressedWorldMap`)
- `WorldMapChunkCacheCodec` (`WorldMapChunkCache` + `.chunks.bin`)
- `WorldMapChunkCacheFormat` (file-format constants)
- `World.loadMap(...)` integration
- `WorldMapFileLoader` (optional “use cache if present” + invalidation)
- Bench tooling (`server/scripts/worldmap-benchmark.ts`)

## ✅ Ship-Ready Checks (Implemented)

- Backwards compatible: legacy `WorldMap` still loads unchanged.
- Portable compressed format: `CompressedWorldMap` streaming decode (no giant blocks object).
- Optional cache format: `.chunks.bin` is versioned + magic-headered (`HYTCHUNK`).
- Entities preserved: `entities` are carried through `CompressedWorldMap` + `.chunks.bin` metadata; loader can overlay entities/blockTypes from sibling JSON when caches were generated without them.
- Safe cache load: chunk origins validated (integer, 16-aligned) + duplicate chunks rejected.
- Faster cache path: collider placements are accumulated during cache scan (avoids rescanning masks to build placements).
- Auto-detect: `World.loadMap(...)` accepts all formats without call-site changes.
- Optional invalidation: cache can include `metadata.source.sha256`; loader can reject stale caches when a sibling `*.compressed.json` exists.

## ⚠️ Remaining Caveats (Known, Acceptable)

### 1) Invalidation requires an available “source”

`WorldMapFileLoader` validates `metadata.source.sha256` only when it can read a sibling `*.compressed.json`. If you ship only `map.json + map.chunks.bin`, hash-validation can’t run and the cache is accepted.

Pragmatic “ship” guidance:
- If you want reliable invalidation, ship `map.compressed.json + map.chunks.bin` together.
- If you want invalidation against `map.json` too, extend metadata to store both hashes (not implemented).

### 2) `decodeMetadata()` still decompresses the cache

To read `metadata.source.sha256`, the codec currently decompresses the cache body first. That’s fine for normal cache loads, but can be “wasted work” if we’re going to reject the cache and fall back.

If this ever matters:
- Introduce a tiny uncompressed prefix header for metadata/hash (not implemented).

### 3) Events differ on the fast path

Chunk cache initialization emits `ADD_CHUNK` but not per-block `SET_BLOCK` events (by design, to avoid millions of events). If any code expects `SET_BLOCK` during initial map load, it must not rely on the cache path.

## Cosmetic / Optional Tweaks (Low Priority)

- `Buffer.concat` in cache creation copies; header is tiny so it’s fine.
- Script linting: `server/tsconfig.json` excludes `scripts/`, so the current lint workflow only covers `src/`.
