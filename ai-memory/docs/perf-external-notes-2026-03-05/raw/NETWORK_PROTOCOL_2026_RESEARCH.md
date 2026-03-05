# Network Protocol 2026 Research

**Purpose:** Modern entity sync and chunk sync patterns for low-bandwidth, low-latency voxel multiplayer.  
**Audience:** Engineers implementing Phase 3 (Entity Sync Compression).

---

## 1. Entity Sync: Industry Patterns

### 1.1 Minecraft (Java)

- Entity position/rotation sent as fixed-point or scaled integers.
- Metadata uses compact type tags.
- Delta updates for moving entities; full state on spawn or major change.

### 1.2 Source Engine / Garry’s Mod

- **Delta compression:** Send only changed fields; baseline is last full update.
- **Quantization:** Position in 1/16 or 1/32 unit; angles in 16-bit.

### 1.3 Overwatch / Modern FPS

- Client-side prediction + server reconciliation.
- Entity updates at 20–60 Hz for nearby; lower for distant.
- Snapshot compression: delta from previous snapshot.

### 1.4 Gaffer On Games (Networked Physics)

- [Snapshot Compression](http://gafferongames.com/networked-physics/snapshot-compression/)
- Quaternion: store 3 largest components (smallest-three); 4th derived.
- Position: fixed-point or quantized.
- Delta encoding: send difference from last acked state.

---

## 2. Quantization Formulas

### 2.1 Position (Fixed-Point)

```ts
const QUANT = 256; // 1/256 block = 0.0039 block precision
const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * QUANT)));

// Encode
pq: [clamp(x), clamp(y), clamp(z)]  // Int16Array or [number, number, number]

// Decode
x = pq[0] / QUANT;
```

**Range:** ±32768 blocks ≈ ±524 km. More than enough.

### 2.2 Quaternion (Smallest-Three)

- Unit quaternion: `q.x² + q.y² + q.z² + q.w² = 1`.
- One component can be derived from the other three.
- Store the 3 components with largest magnitude; 1 byte for index of omitted component.
- Quantize each stored component to 16-bit: `value * 32767` for range [-1, 1].

**Size:** 1 + 3×2 = 7 bytes vs 4×4 = 16 bytes (float32). ~56% smaller.

**Reference:** [Gaffer On Games](http://gafferongames.com/networked-physics/snapshot-compression/)

### 2.3 Yaw-Only (Euler)

- For entities that only rotate around Y: send 1 float (radians) or 16-bit quantized.
- `yaw = 2*PI * (int16 / 65536)`.
- 2 bytes vs 16 bytes for full quaternion.

---

## 3. Distance-Based Sync Rate

| Distance Band | Sync Rate | Use Case |
|---------------|-----------|----------|
| 0–4 chunks | 30 Hz | Player, nearby NPCs |
| 4–8 chunks | 15 Hz | Mid-range entities |
| 8+ chunks | 5 Hz | Far entities, environmental |

**Implementation:** In `checkAndEmitUpdates` or NetworkSynchronizer, compute distance from nearest player; only emit if `tick % rateDivisor === 0`.

---

## 4. Bulk Format (Structure of Arrays)

Instead of:

```json
[
  { "i": 1, "p": [10.5, 20.1, 30.2] },
  { "i": 2, "p": [11.2, 20.0, 31.1] }
]
```

Use:

```json
{
  "ids": [1, 2],
  "p": [[2693, 5146, 7733], [2867, 5120, 7962]]
}
```

- Quantized positions in `p` (Int16).
- Avoids repeating keys; msgpack benefits from smaller maps.
- **Caveat:** New packet type; client must support. Can run parallel to existing EntitiesPacket during migration.

---

## 5. Protocol Versioning

- Add optional fields to EntitySchema: `pq`, `rq`, `ry`.
- Old clients ignore unknown fields; new clients prefer them.
- Server flag: `useQuantizedEntitySync=true` (default for new connections after version bump).

---

## 6. Chunk Delta Updates (Phase 6)

- When a single block changes, send delta: `{ chunkId, blockIndex, blockTypeId }` instead of full chunk.
- Client applies delta to local chunk; requests full chunk if out of sync.
- Reduces bandwidth for frequent block edits (mining, building).

---

## 7. References

- [Gaffer On Games – Snapshot Compression](http://gafferongames.com/networked-physics/snapshot-compression/)
- [Minecraft Protocol – wiki.vg](https://wiki.vg/Protocol)
- [ENTITY_SYNC_DELTA_COMPRESSION_DESIGN.md](../ENTITY_SYNC_DELTA_COMPRESSION_DESIGN.md) – Hytopia-specific design
