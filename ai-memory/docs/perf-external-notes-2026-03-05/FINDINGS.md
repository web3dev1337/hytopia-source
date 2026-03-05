# External Notes vs. HYTOPIA Source (Verification + PR Cross-Check)

Base reference for verification in this branch: `origin/master` at `24a295d` (2026-03-05).

## What Was Imported

Unmodified external notes live in `ai-memory/docs/perf-external-notes-2026-03-05/raw/`.

## Quick Take

The external docs mix:

- **Accurate observations about the current client** (notably: face culling exists; greedy meshing does not; geometry churn is high; packet decompression is synchronous).
- **Roadmap/architecture assumptions that do not match `master`** (procedural streaming, time-budgeted collider queues, LOD/occlusion/face-limit systems, several referenced constants/functions).

So: use them as *idea input*, but treat many “current state” statements as unverified unless they point to code that exists on `master`.

## Claim Verification (Against `master`)

### Client meshing/rendering

- ✅ **Face culling exists**: `client/src/workers/ChunkWorker.ts` culls faces when neighbor blocks are solid/opaque.
- ❌ **Greedy meshing is not implemented**: `client/src/workers/ChunkWorker.ts` emits per-face quads (4 vertices per visible face) with no quad merging pass.
- ❌ **Vertex pooling is not present**: `client/src/chunks/ChunkMeshManager.ts` recreates a new `BufferGeometry` for each batch update and disposes the old geometry.
- ❌ **LOD / cave occlusion / “face limit safety caps” described in notes are not found** via repo search on `client/src/` (`lod`, `occlusion`, face-count thresholds, BFS visibility, etc.).

### Client networking

- ✅ **Synchronous gzip decompression on the main thread**: `client/src/network/NetworkManager.ts` calls `gunzipSync` (fflate) before msgpack decode.

### Server networking (entity/chunk sync)

- ✅ **Entity pos/rot are a dominant sync path (and split to unreliable when pos/rot-only)**: `server/src/networking/NetworkSynchronizer.ts`.
- ❌ **No entity quantization/delta fields exist today**: `protocol/schemas/Entity.ts` has only `p` (Vector) and `r` (Quaternion). `server/src/networking/Serializer.ts` serializes full float arrays.
- ❌ **No chunk pacing/segmentation is implemented**: `server/src/networking/NetworkSynchronizer.ts` batches *all queued chunk syncs* into a single packet each sync.

### Server colliders / chunk streaming

Several external docs reference a *procedural streaming* pipeline (chunks-per-tick, queued collider chunk processing, async region I/O). Those specific codepaths/constants (e.g. `CHUNKS_PER_TICK`, `processPendingColliderChunks`, `COLLIDER_MAX_CHUNK_DISTANCE`, `server/src/worlds/maps/*`) are **not present on `master`**.

## Notable Errors / Corrections in the Notes

- **Quantized position range math is wrong as written**:
  - If you encode `pq = round(x * 256)` into **int16**, the representable world range is about **±128 blocks**, not ±32768 blocks.
  - To keep **1/256 block precision** over large worlds, you need larger integers (e.g. int32), smaller quantization, or chunk-relative encoding.

## How This Relates to Your Performance PRs

PRs authored by you that touch performance (as of 2026-03-05):

- #2 (OPEN) `analysis/codebase-audit`: https://github.com/web3dev1337/hytopia-source/pull/2
- #3 (OPEN) `docs/iphone-pro-performance-analysis`: https://github.com/web3dev1337/hytopia-source/pull/3
- #4 (OPEN) `fix/fps-cap-medium-low`: https://github.com/web3dev1337/hytopia-source/pull/4
- #5 (OPEN) `fix/cap-mobile-dpr`: https://github.com/web3dev1337/hytopia-source/pull/5
- #6 (OPEN) `feature/map-compression`: https://github.com/web3dev1337/hytopia-source/pull/6
- #7 (OPEN) `review/mirror-upstream-pr-9`: https://github.com/web3dev1337/hytopia-source/pull/7
- #8 (OPEN) `review/mirror-upstream-pr-10` (stacked on #7): https://github.com/web3dev1337/hytopia-source/pull/8
- #9 (OPEN) `review/mirror-upstream-pr-11`: https://github.com/web3dev1337/hytopia-source/pull/9
- #10 (CLOSED) `fix/cap-mobile-devicepixelratio` (superseded): https://github.com/web3dev1337/hytopia-source/pull/10

Where they overlap with the external notes:

- **High-DPI / mobile GPU load**:
  - #4 adds a 60 FPS cap for MEDIUM/LOW (matches the “uncapped 120Hz” problem described in #3).
  - #5 caps mobile pixel ratio (matches the “3x DPR” issue described in #3).
  - #9 introduces a **pixel budget** based effective pixel ratio and reduces outline overhead (complementary to #3).
- **Outline pass overhead**:
  - #9 removes per-mesh define mutation in `SelectiveOutlinePass` by prebuilding shader variants (reduces CPU/shader churn). It does **not** reduce the outline shader’s sampling cost.
- **View-distance mesh visibility**:
  - `master` currently iterates all batch meshes each frame. #9 adds cached visibility sets and updates visibility only when the camera crosses a “cell” boundary or settings change.
- **Map size / load time**:
  - #6 (compressed maps) addresses the external “JSON map size” concern; the external “binary streaming maps” discussion is broader than #6’s scope.

## What’s Still Missing (Relative to the External Notes + Your PRs)

- **Greedy meshing / quad merging** in `client/src/workers/ChunkWorker.ts`.
- **Entity sync quantization / deltas / distance-based rates** (protocol + serializer + client deserializer work).
- **Chunk packet pacing/segmentation** to avoid bursty chunk arrays at join / fast movement.
- **Off-main-thread decompression/decoding** for network payloads (or reduced use of sync `gunzipSync`).

