# Map Compression — Benchmark Snapshot (2026-03-04)

This PR supports loading:
- legacy `WorldMap` JSON (`map.json`)
- `CompressedWorldMap` (`map.compressed.json`)
- optional chunk cache (`map.chunks.bin`) for faster `loadMap(...)` on large maps

Bench harness: `server/scripts/worldmap-benchmark.ts`. The tables below are the high-signal snapshot used in the PR description.

## Highlights (median `loadMap(...)`)

| Map | WorldMap | Compressed | Chunk cache |
|---|---:|---:|---:|
| big-world | 2.99 s | 2.35 s | 1.08 s |
| boilerplate | 4.97 s | 4.42 s | 2.40 s |
| HyFire2 | 81.20 ms | 67.13 ms | 50.61 ms |

## Highlights (disk)

| Map | map.json | map.compressed.json | compressed + chunks |
|---|---:|---:|---:|
| big-world | 29.99 MB | 1.01 MB | ~1.64 MB |
| boilerplate | 28.28 MB | 439.94 KB | ~679.31 KB |
| HyFire2 | 649.96 KB | 102.04 KB | ~114.46 KB |

## Highlights (end-to-end: read + parse + load)

| Map | WorldMap(file) | Compressed(file) | Chunk cache(file) |
|---|---:|---:|---:|
| big-world | 2.74 s | 2.20 s | 1.03 s |
| boilerplate | 5.16 s | 4.17 s | 2.44 s |

## How to reproduce

```bash
cd server
bun scripts/worldmap-benchmark.ts \
  --map ../sdk-examples/big-world/assets/map.json \
  --skip-entities --validate --bench-e2e --bench-chunk-cache --iterations 3
```

Notes:
- `--skip-entities` only affects spawning during load; entities are still preserved in the compressed formats.
- **Rotations preserved:** the native codec supports rotated block values (`{ i, r }`). The plugin’s compressors/tools assume `blocks: { [key]: string]: number }` and don’t encode rotations.
- **Streaming decode:** avoids materializing a massive coordinate-keyed blocks object when loading compressed maps.

### Plugin-only features (not implemented natively)

The plugin includes a cache pipeline and “precomputed chunks” formats (`.chunks`, `.chunks.bin`) aimed at **much faster** loading by bypassing normal per-block placement.

On `sdk-examples/big-world/assets/map.json`, generating caches with the plugin’s tooling produced:
- `.chunks.bin`: `~16.71MB` in `~1050ms`
- `.chunks` (brotli JSON): `~1.75MB` in `~4703ms` (compressed from `~172.91MB` JSON payload)

Important caveat for the current SDK:
- The plugin’s “direct chunk injection” loader is tightly coupled to specific internal shapes (e.g., a string-keyed chunk map and custom chunk objects) and doesn’t rebuild the current engine’s collider/mask structures.
- Because the native SDK `loadMap(...)` includes collider creation, “50x faster load” isn’t apples-to-apples unless an equivalent **official** precomputed-chunk + collider pipeline exists.

## Takeaway

Native compressed maps give:
- **Huge disk/transfer win** (e.g., 30MB → ~1MB),
- **Lower parse cost** (hundreds of ms → ~0.1ms),
- **Moderate `loadMap(...)` speedup** (~1.2–1.3× on multi‑million‑block maps) while keeping full physics/collider correctness and backward compatibility.

**Update (Wednesday, March 4, 2026):** adding an optional `.chunks.bin` chunk cache yields a larger `loadMap(...)` speedup on very large maps (about **~2×** in the benches below) because it bypasses per-block `"x,y,z"` key parsing and per-block placement bookkeeping.

### Cache invalidation (optional)

`WorldMapFileLoader` prefers a sibling `*.chunks.bin` only if it looks valid. If the cache contains `metadata.source.sha256` and a sibling `*.compressed.json` exists, it validates that hash and **falls back automatically** when it doesn’t match (stale cache).

### Chunk cache benches (2026-03-04)

All runs: `bun server/scripts/worldmap-benchmark.ts --bench-chunk-cache --bench-e2e --validate --iterations 3`
