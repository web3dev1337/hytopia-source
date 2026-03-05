# Greedy Meshing Implementation Guide

**Purpose:** Step-by-step guide for implementing greedy quad merging (cubic/canonical meshing) in Hytopia’s ChunkWorker.  
**Audience:** Engineers implementing Phase 4 (Greedy Meshing).  
**Prerequisites:** Read [0fps Part 1](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/) and [Part 2](https://0fps.net/2012/07/07/meshing-minecraft-part-2/).

---

## 1. Algorithm Overview

### 1.1 Input and Output

- **Input:** Chunk of 16³ blocks. Each block has type ID, optional rotation.
- **Output:** Merged quads (position, size, normal, block type, AO, light).

### 1.2 High-Level Steps

1. **Group by (block type, normal, material flags).** Faces with same texture and normal are mergeable.
2. **For each direction** (±X, ±Y, ±Z):
   - Build a 2D slice of visible faces (e.g. for +Y, iterate Y layers; for each layer, collect top faces).
   - Run 2D greedy merge: combine adjacent same-type faces into rectangles.
3. **Emit merged quads** with correct UVs, AO, and lighting.

---

## 2. Detailed Algorithm (0fps Style)

### 2.1 Slice Extraction

For direction `+Y` (top faces):

- For each Y level `y = 0..15`:
  - For each (x, z) in 16×16:
    - If block at (x, y, z) is solid and block at (x, y+1, z) is air/transparent:
      - Add face with normal (0, 1, 0), block type = block at (x, y, z).
  - This gives a 16×16 grid of “face presence” per block type.
  - Run 2D greedy merge on this grid.

Repeat for −Y, ±X, ±Z.

### 2.2 2D Greedy Merge (Per Slice, Per Block Type)

```
for each row j in slice:
  for each column i in slice:
    if visited[i,j]: continue
    if no face at (i,j): continue
    blockType = face at (i,j)
    width = 1
    while i+width < 16 and same block at (i+width, j) and same AO/light:
      width++
    height = 1
    while j+height < 16:
      row OK = true
      for k = 0 to width-1:
        if different block or visited[i+k, j+height]: row OK = false; break
      if !row OK: break
      height++
    mark (i,j)..(i+width-1, j+height-1) as visited
    emit quad: origin (i,j), size (width, height), blockType
```

### 2.3 Lexicographic Order (0fps)

To get deterministic, visually stable meshes, merge in a fixed order (e.g. top-to-bottom, left-to-right) and prefer the lexicographically smallest representation when multiple merges are possible.

---

## 3. Integration with ChunkWorker

### 3.1 Current Flow (Simplified)

```
for each block in chunk:
  for each face (6 directions):
    if face visible (neighbor empty/transparent):
      emit quad
```

### 3.2 New Flow

```
// Group 1: Opaque solid blocks (greedy)
for dir in [+X,-X,+Y,-Y,+Z,-Z]:
  slice = extractVisibleFaces(chunk, dir)
  for blockType in unique block types in slice:
    subslice = slice filtered by blockType
    quads = greedyMerge2D(subslice, dir)
    emit quads with AO, light

// Group 2: Transparent / special (per-face, existing logic)
for each block in chunk:
  if block is transparent or special:
    for each face:
      if visible: emit quad
```

### 3.3 AO and Lighting

- Ambient occlusion: compute per-vertex AO from neighbor blocks (as today).
- Light: sample from light volume (as today).
- For merged quads: corners may have different AO/light. Options:
  - **Option A:** Use min AO/light of the merged region (slightly darker; simpler).
  - **Option B:** Subdivide quad where AO/light changes (more quads, better quality).
  - **Recommendation:** Start with Option A; optimize later.

---

## 4. Data Structures

### 4.1 Slice Representation

```ts
// 16x16 grid, value = block type ID (0 = no face)
type Slice = Uint8Array; // 256 elements

// Or: (blockTypeId, ao, light) per cell if we merge only when all match
interface SliceCell {
  blockTypeId: number;
  ao: number;
  light: number;
}
```

### 4.2 Visited Mask

```ts
// 16x16 boolean
const visited = new Uint8Array(256); // 1 bit per cell, or just 256 bytes
```

### 4.3 Merged Quad Output

```ts
interface MergedQuad {
  x: number;      // local origin
  y: number;
  z: number;
  width: number;  // in blocks, along one horizontal axis
  height: number; // in blocks, along other axis
  normal: [number, number, number];
  blockTypeId: number;
  ao: number;     // or per-corner if subdividing
  light: number;
}
```

---

## 5. Implementation Order

| Step | Task | Est. Time |
|------|------|-----------|
| 1 | Slice extraction for +Y (top faces) | 1 day |
| 2 | 2D greedy merge for +Y slice | 1 day |
| 3 | Apply to all 6 directions | 0.5 day |
| 4 | AO/light handling for merged quads | 1 day |
| 5 | Integration: replace per-face loop for opaque solids | 1 day |
| 6 | Benchmark: vertex count and build time | 0.5 day |
| 7 | Edge cases: chunk boundaries, multi-type batches | 1 day |

---

## 6. Expected Results

| Terrain Type | Before (vertices) | After (est.) | Reduction |
|--------------|-------------------|--------------|-----------|
| Flat 16×16 | ~6000 | ~200 | ~30× |
| Hilly | ~8000 | ~800 | ~10× |
| Caves | ~4000 | ~600 | ~7× |
| Mixed | ~6000 | ~500 | ~12× |

Build time may increase by 10–30% due to extra passes; vertex reduction should yield net FPS gain.

---

## 7. References

- [0fps Part 1 – Meshing in a Minecraft Game](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/)
- [0fps Part 2 – Multiple block types](https://0fps.net/2012/07/07/meshing-minecraft-part-2/)
- [mikolalysenko/greedy-mesher](https://github.com/mikolalysenko/greedy-mesher) (JavaScript reference)
- [Vercidium greedy voxel meshing gist](https://gist.github.com/Vercidium/a3002bd083cce2bc854c9ff8f0118d33)
