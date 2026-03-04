# Map Compression Benchmarks + Comparison (2026-03-04)

This repo now supports loading:

- legacy `WorldMap` JSON (`{ blockTypes, blocks, entities }`)
- a compressed map object (`CompressedWorldMap`: `{ data, bounds, ... }`)
- an optional **chunk cache** (`WorldMapChunkCache`) for faster `loadMap(...)` on large maps

All formats are accepted by `World.loadMap()` with auto-detection.

This document records benchmarks from **Tuesday, March 3, 2026**, and compares the native implementation to `hytopia-map-compression`.

## Versions / Environment

- `hytopia-source` branch: `feature/map-compression` (PR head)
- Bun: `1.3.2`
- Node: `v25.2.1`
- Benchmark harness: `server/scripts/worldmap-benchmark.ts`

## Quick Tables (Easy Scan)

### Load Time (medians)

| Map | `WorldMap` | `CompressedWorldMap` | `WorldMapChunkCache` |
|---|---:|---:|---:|
| `sdk-examples/big-world/assets/map.json` | `2.99s` | `2.35s` | `1.08s` |
| `assets/release/maps/boilerplate.json` | `4.97s` | `4.42s` | `2.40s` |

### Load Time (medians) — Game maps (all ran with `--skip-entities`)

| Map | `WorldMap` | `CompressedWorldMap` | `WorldMapChunkCache` |
|---|---:|---:|---:|
| `zoo-game/assets/world-modules/world-6p.pre-fishing-shop.backup.json` | `53.50ms` | `48.23ms` | `39.44ms` |
| `HyFire2/master/assets/map.json` | `81.20ms` | `67.13ms` | `50.61ms` |
| `hytopia-2d-game-test/work1/assets/desktop-arcade-map.json` | `8.34ms` | `6.05ms` | `4.87ms` |
| `astro-breaker/work1/assets/map.json` | `23.55ms` | `21.71ms` | `11.29ms` |

### End-to-End (read + parse + load)

| Map | `WorldMap` | `CompressedWorldMap(file)` | `WorldMapChunkCache(file)` |
|---|---:|---:|---:|
| `sdk-examples/big-world/assets/map.json` | `2.74s` | `2.20s` | `1.03s` |
| `assets/release/maps/boilerplate.json` | `5.16s` | `4.17s` | `2.44s` |

### What You Ship (disk) — Game maps

| Map | `map.json` | `map.compressed.json` | `map.chunks.bin` | `compressed + chunks` |
|---|---:|---:|---:|---:|
| `zoo-game/.../world-6p.pre-fishing-shop.backup.json` | `258.17KB` | `9.23KB` | `4.48KB` | `~13.71KB` |
| `HyFire2/master/assets/map.json` | `649.96KB` | `102.04KB` | `12.41KB` | `~114.46KB` |
| `hytopia-2d-game-test/.../desktop-arcade-map.json` | `92.81KB` | `18.79KB` | `3.56KB` | `~22.36KB` |
| `astro-breaker/work1/assets/map.json` | `206.03KB` | `10.24KB` | `6.27KB` | `~16.51KB` |

### What You Ship (disk)

| Map | `map.json` | `map.compressed.json` | `map.chunks.bin` | `compressed + chunks` |
|---|---:|---:|---:|---:|
| `sdk-examples/big-world/assets/map.json` | `29.99MB` | `1.01MB` | `637.03KB` | `~1.64MB` |
| `assets/release/maps/boilerplate.json` | `28.28MB` | `439.94KB` | `239.37KB` | `~679.31KB` |

### Cold Start Init (add once on boot)

| Map run | init (`RAPIER` + atlas) |
|---|---:|
| `big-world` bench run | `88.52ms` |
| `boilerplate` bench run | `37.79ms` |

Notes:
- If the block texture atlas must be generated (missing/out-of-date `.atlas/atlas.json`), init can take multiple seconds on some game repos; once cached, it’s typically back to sub-100ms.

## Native SDK Implementation (this PR)

- Codec: `server/src/worlds/maps/WorldMapCodec.ts`
- Chunk cache codec: `server/src/worlds/maps/WorldMapChunkCacheCodec.ts`
- Optional file helper: `server/src/worlds/maps/WorldMapFileLoader.ts`
- Auto-load: `server/src/worlds/World.ts` (`loadMap(map: WorldMap | CompressedWorldMap | WorldMapChunkCache)`)
- Key behaviors:
  - **Backwards compatible:** classic JSON maps still load unchanged.
  - **Forward compatible:** `{ data: base64, bounds: {minX..maxZ} }` maps load automatically.
  - **Streaming load:** compressed maps decode into `ChunkLattice.initializeBlockEntries(...)` without building a giant `{ "x,y,z": ... }` object in memory.
  - **Rotations supported:** rotated blocks (`{ i, r }`) are preserved (compressed maps set `options.rotations=true`).
  - **Optional chunk cache:** `.chunks.bin` files can be generated and loaded for faster block initialization.

## Benchmark Method

All timings below are from `bun scripts/worldmap-benchmark.ts`.

Notes:
- `--skip-entities` was used for large maps so entity model URIs don’t affect results.
- `loadMap(...)` time includes **decompression + block placement + collider generation** (i.e., real runtime cost).
- When benchmarking a real game map, use `--cwd <game-root>` so block texture URIs can be validated against that game’s assets (and/or its `node_modules/@hytopia.com/assets` if present).

### Testing an existing game repo (quick)

From this repo:

```bash
cd server

# Pure load/codec perf (recommended; avoids custom entity constructors/models)
bun scripts/worldmap-benchmark.ts \
  --cwd /abs/path/to/game \
  --map assets/map.json \
  --skip-entities --validate --bench-e2e --bench-chunk-cache --iterations 5

# Produce artifacts next to the map (optional)
bun scripts/worldmap-benchmark.ts \
  --cwd /abs/path/to/game \
  --map assets/map.json \
  --skip-entities --validate --iterations 3 \
  --out assets/map.compressed.json \
  --chunk-cache-out assets/map.chunks.bin
```

---

## Results: `sdk-examples/big-world/assets/map.json` (2026-03-04)

Source (upstream): `https://github.com/hytopiagg/sdk-examples/blob/main/big-world/assets/map.json`

Map stats:
- File size: `29.99MB`
- Blocks: `1,216,344`
- BlockTypes: `22`
- Rotations: `false`
- Entities: `0`

### Legacy JSON (`WorldMap`)

- read: `14.63ms`
- parse: `281.23ms`
- `loadMap(WorldMap)`: median `2.99s` (min `2.84s`, max `3.46s`, runs `3`)
- e2e (read+parse+load): `2.74s`

### Native compressed map (`CompressedWorldMap`)

Generated by the benchmark with `brotli` level `9`:
- compressed JSON size: `1.01MB` (`96.62%` smaller vs source file)
- `loadMap(CompressedWorldMap)`: median `2.35s` (min `2.33s`, max `2.52s`, runs `3`)
- e2e (read+parse+load from `map.compressed.json`): `2.20s`
- validate: `ok=true` (same chunk lattice hash)
  - hash: `bae40b954980eae6ea30d75c11321737e0e6f1613d07ca93e5ff343082865fe0`

### Loading from a pre-compressed file (`map.compressed.json`)

When the input file is already compressed (so parse cost is tiny):
- file size: `1.01MB`
- read: `2.31ms`
- parse: `0.08ms`
- `loadMap(CompressedWorldMap)`: median `2.38s` (min `2.37s`, max `2.49s`, runs `3`)

### Optional chunk cache (`map.chunks.bin`)

Generated by the benchmark with chunk-cache `brotli` level `4`:
- cache size: `637.03KB`
- `loadMap(WorldMapChunkCache)`: median `1.08s` (min `1.07s`, max `1.09s`, runs `3`)
- e2e (read+load from `map.chunks.bin`): `1.03s`
- validate: `ok=true` (same chunk lattice hash)

### Size accounting (what you ship)

- `map.json`: `29.99MB`
- `map.compressed.json`: `1.01MB`
- `map.chunks.bin`: `637.03KB`
- `map.json + map.chunks.bin`: `~30.61MB`
- `map.compressed.json + map.chunks.bin`: `~1.63MB`

---

## Results: `assets/release/maps/boilerplate.json` (2026-03-04)

Map stats:
- File size: `28.28MB`
- Blocks: `1,925,122`
- BlockTypes: `154`
- Rotations: `true`
- Entities: `0`

### Legacy JSON (`WorldMap`)

- read: `14.91ms`
- parse: `405.94ms`
- `loadMap(WorldMap)`: median `4.97s` (min `4.82s`, max `5.77s`, runs `3`)
- e2e (read+parse+load): `5.16s`

### Native compressed map (`CompressedWorldMap`)

Generated by the benchmark with `brotli` level `9`:
- compressed JSON size: `439.94KB` (`98.48%` smaller vs source file)
- `loadMap(CompressedWorldMap)`: median `4.42s` (min `4.22s`, max `4.54s`, runs `3`)
- e2e (read+parse+load from `boilerplate.compressed.json`): `4.17s`

### Loading from a pre-compressed file (`/tmp/boilerplate.compressed.json`)

- file size: `439.94KB`
- read: `0.38ms`
- parse: `0.34ms`
- `loadMap(CompressedWorldMap)`: median `4.70s` (min `4.34s`, max `5.11s`, runs `3`)

### Optional chunk cache (`boilerplate.chunks.bin`)

Generated by the benchmark with chunk-cache `brotli` level `4`:
- cache size: `239.37KB`
- `loadMap(WorldMapChunkCache)`: median `2.40s` (min `2.35s`, max `2.51s`, runs `3`)
- e2e (read+load from `boilerplate.chunks.bin`): `2.44s`
- validate: `ok=true` (same chunk lattice hash)

### Size accounting (what you ship)

- `boilerplate.json`: `28.28MB`
- `boilerplate.compressed.json`: `439.94KB`
- `boilerplate.chunks.bin`: `239.37KB`
- `boilerplate.json + boilerplate.chunks.bin`: `~28.51MB`
- `boilerplate.compressed.json + boilerplate.chunks.bin`: `~679.31KB`

---

## Results: Game maps (zoo-game, HyFire2, hytopia-2d-game-test, astro-breaker) (2026-03-04)

All runs below used: `--skip-entities --iterations 5 --bench-e2e --bench-chunk-cache --validate`.

### zoo-game (`assets/world-modules/world-6p.pre-fishing-shop.backup.json`)

Map stats:
- File size: `258.17KB`
- Blocks: `13,238`
- BlockTypes: `19`
- Entities: `19` (skipped during load)

Results:
- `loadMap(WorldMap)`: median `53.50ms`
- `loadMap(CompressedWorldMap)`: median `48.23ms`
- `loadMap(WorldMapChunkCache)`: median `39.44ms`
- Ship size: `compressed + chunks` = `~13.71KB` (vs `258.17KB`)
- validate: `ok=true` (same chunk lattice hash)

### HyFire2 (`assets/map.json`)

Map stats:
- File size: `649.96KB`
- Blocks: `23,867`
- BlockTypes: `42`
- Entities: `331` (skipped during load)

Results:
- `loadMap(WorldMap)`: median `81.20ms`
- `loadMap(CompressedWorldMap)`: median `67.13ms`
- `loadMap(WorldMapChunkCache)`: median `50.61ms`
- Ship size: `compressed + chunks` = `~114.46KB` (vs `649.96KB`)
- validate: `ok=true` (same chunk lattice hash)

### hytopia-2d-game-test (`assets/desktop-arcade-map.json`)

Map stats:
- File size: `92.81KB`
- Blocks: `2,995`
- BlockTypes: `8`
- Rotations: `true`
- Entities: `53` (skipped during load)

Results:
- `loadMap(WorldMap)`: median `8.34ms`
- `loadMap(CompressedWorldMap)`: median `6.05ms`
- `loadMap(WorldMapChunkCache)`: median `4.87ms`
- Ship size: `compressed + chunks` = `~22.36KB` (vs `92.81KB`)
- validate: `ok=true` (same chunk lattice hash)

### astro-breaker (`assets/map.json`)

Map stats:
- File size: `206.03KB`
- Blocks: `10,327`
- BlockTypes: `43`
- Entities: `0`

Results:
- `loadMap(WorldMap)`: median `23.55ms`
- `loadMap(CompressedWorldMap)`: median `21.71ms`
- `loadMap(WorldMapChunkCache)`: median `11.29ms`
- Ship size: `compressed + chunks` = `~16.51KB` (vs `206.03KB`)
- validate: `ok=true` (same chunk lattice hash)

---

## Comparison: `hytopia-map-compression`

Repo: `https://github.com/web3dev1337/hytopia-map-compression`

### Feature matrix (high level)

| Capability | Native SDK (this PR) | `hytopia-map-compression` |
|---|---:|---:|
| Load legacy `WorldMap` JSON | ✅ | ✅ |
| Load compressed map object | ✅ (auto-detect in `World.loadMap`) | ✅ (plugin loader) |
| Preserve rotated blocks (`{ i, r }`) | ✅ | ❌ (blocks assumed numeric IDs) |
| Streaming decode (avoid materializing `{ "x,y,z": ... }`) | ✅ | ❌ (unless using chunk caches) |
| Precomputed chunk caches (`.chunks`, `.chunks.bin`) | ✅ (`.chunks.bin`) | ✅ |
| Hash-based disk cache invalidation | ✅ (optional) | ✅ |
| Avoid private-field writes / monkey patching | ✅ | ❌ (for fastest path) |

### What matches (core compression)

Both implementations use essentially the same “HyFire-style” core encoding:
- sort blocks by `y,x,z`
- delta encode `x,y,z`
- zigzag + varint encode
- brotli compress → base64 string

**Measured on `sdk-examples/big-world/assets/map.json`:**
- `hytopia-map-compression` `MapCompressor` (brotli level 9):
  - compress time: `~1186ms`
  - compressed JSON bytes: `~1,063,478` (`~1.06MB`)
- Native `WorldMapCodec.compress` (brotli level 9):
  - compress time: `~846ms`
  - compressed JSON size: `~1.01MB`

### Native SDK advantages (clean + compatible)

- **No monkey patching / private field writes:** stays on official SDK behavior.
- **Loads plugin-generated compressed maps:** detection only requires `data` + numeric `bounds`, and defaults to brotli if `algorithm` is missing.
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
