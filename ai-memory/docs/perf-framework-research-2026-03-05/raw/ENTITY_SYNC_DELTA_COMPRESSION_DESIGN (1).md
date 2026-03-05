# Entity Sync: Delta / Compression Design

**Goal:** Reduce entity position/rotation packet size and bandwidth (currently ~90% of all packets) by replacing full pos/rot with delta or compressed formats.

---

## 1. Current State

### Flow
- **Server:** Every tick, `entityManager.checkAndEmitUpdates()` runs; each entity calls `checkAndEmitUpdates()`.
- **Entity:** Emits `UPDATE_POSITION` or `UPDATE_ROTATION` when change exceeds threshold:
  - **Position:** `ENTITY_POSITION_UPDATE_THRESHOLD_SQ = 0.04²` (0.04 block)
  - **Rotation:** `ENTITY_ROTATION_UPDATE_THRESHOLD = cos(3°/2)` (~3°)
  - **Player:** Looser position threshold `0.1²` blocks
- **NetworkSynchronizer:** Queues `{ i: id, p: [x,y,z] }` and/or `{ i: id, r: [x,y,z,w] }`.
- **Every 2 ticks (30 Hz):** Splits into reliable vs unreliable; pos/rot-only goes to **unreliable** channel.
- **Serializer:** `serializeVector` → `[x, y, z]`, `serializeQuaternion` → `[x, y, z, w]` (full floats).
- **Transport:** msgpackr with `useFloat32: FLOAT32_OPTIONS.ALWAYS` → 4 bytes per float.

### Per-Entity Packet Size (approx)
| Format | Bytes (msgpack) |
|--------|-----------------|
| `{ i, p }` pos-only | ~25–35 |
| `{ i, r }` rot-only | ~30–40 |
| `{ i, p, r }` both | ~50–65 |
| 10 entities, pos+rot | ~500–650 |

With 20 entities at 30 Hz: **~15–20 KB/s** for entity sync alone.

---

## 2. Options for Delta / Compression

### Option A: Quantized Position (Fixed-Point)

**Idea:** Encode position as integers. 1 unit = 1/256 block → 0.004 block precision.

- Range ±32768 blocks → 16-bit signed per axis.
- 3 × 2 bytes = **6 bytes** vs 3 × 4 = 12 bytes (float32).
- **~50% smaller** for position.

**Implementation:**
```ts
// Server
const QUANT = 256;
p: [Math.round(x * QUANT), Math.round(y * QUANT), Math.round(z * QUANT)]

// Client
position.x = p[0] / QUANT;  // etc.
```

**Trade-off:** Precision ~0.004 block. For player/NPC movement this is fine. For very small objects, may need higher quant (e.g. 1024).

---

### Option B: Quantized Quaternion (Smallest-Three)

**Idea:** Unit quaternion has `q.x² + q.y² + q.z² + q.w² = 1`. Store the 3 components with largest magnitude; reconstruct 4th.

- 3 × 2 bytes (quantized) = **6 bytes** vs 4 × 4 = 16 bytes.
- **~62% smaller** for rotation.

**Implementation:** Standard "smallest three" quaternion compression (e.g. [RigidBodyDynamics](https://github.com/gameworks-builder/rigid-body-dynamics) style). Needs protocol change to support packed format.

---

### Option C: Yaw-Only for Player Rotation

**Idea:** Many entities (players, NPCs) only rotate around Y. Send 1 float (yaw) instead of 4.

- **4 bytes** vs 16 bytes.
- **75% smaller** for rotation when applicable.

**Caveat:** Doesn't work for entities with pitch/roll (e.g. flying, vehicles). Use as opt-in per entity type.

---

### Option D: Delta Encoding (Δ from Last Sent)

**Idea:** Send `Δp = p - p_last` instead of absolute `p`. Small movements → small deltas → msgpack encodes as smaller integers.

- No schema change; still `[dx, dy, dz]` but values typically small.
- msgpack variable-length integers: small values use 1 byte.
- **Benefit:** 20–50% smaller when movement is small. No extra state on client if server tracks last-sent.

**Implementation:** Server stores `_lastSentPosition` per entity per player (or broadcast). Send delta; client adds to last known position. Requires client to track "last applied" position.

---

### Option E: Bulk / AoS Format

**Idea:** Instead of `[{i:1,p:[x,y,z]},{i:2,p:[x,y,z]},...]` use structure of arrays:

```ts
{ ids: [1,2,3], p: [[x,y,z],[x,y,z],[x,y,z]] }
```

- Avoids repeating keys `i`, `p` for every entity (msgpack dedup helps but structure still has overhead).
- **Benefit:** ~15–25% smaller from less map/array framing.

**Caveat:** Requires new packet schema and client deserializer changes. All-or-nothing; can't mix with current EntitySchema in same packet.

---

### Option F: Distance-Based Sync Rate

**Idea:** Sync nearby entities at 30 Hz, distant at 10 Hz or 5 Hz.

- **Benefit:** Fewer packets for far entities; natural LOD.
- **Implementation:** In `checkAndEmitUpdates` or NetworkSynchronizer, track distance from each player; only queue updates for entity if `tick % rateDivisor === 0` based on distance band.

---

## 3. Recommended Approach

### Phase 1: Low-Risk Wins (1–2 days each)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Quantized position** (1/256 block) | ~50% smaller pos | 1 day |
| 2 | **Distance-based sync rate** (30/15/5 Hz bands) | Fewer far-entity updates | 1 day |
| 3 | **Yaw-only rotation** for player entities | ~75% smaller rot for players | 0.5 day |

### Phase 2: Schema Changes (3–5 days)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| 4 | **Quantized quaternion** (smallest-three) | ~62% smaller rot | 2–3 days |
| 5 | **Bulk entity update packet** | ~15–25% smaller framing | 2 days |

### Phase 3: Advanced (Optional)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| 6 | **Delta encoding** | Additional 20–50% when movement small | 2–3 days |
| 7 | **Client-side prediction** | Reduce perceived latency, fewer corrections | 1+ week |

---

## 4. Protocol Changes Required

### Option 1: Extend EntitySchema (Backwards Compatible)

Add optional compressed fields; client detects and uses when present:

```ts
// New optional fields
EntitySchema = {
  i: number;
  p?: VectorSchema;           // existing: [x,y,z] float
  r?: QuaternionSchema;       // existing: [x,y,z,w] float
  pq?: [number,number,number]; // quantized position (1/256 block)
  rq?: [number,number,number]; // quantized quaternion (smallest-three)
  ry?: number;                // yaw only (radians)
  // ...
}
```

- Server sends `pq` instead of `p` when quantized format enabled.
- Client checks `pq` first, falls back to `p`.
- Old clients ignore `pq`; new clients prefer `pq` when present.

### Option 2: New Packet Type

Add `EntityPosRotBulkPacket`:

```ts
{
  ids: number[],
  positions?: Int16Array | number[][],  // quantized
  rotations?: number[][] | Int16Array[] // quantized or yaw-only
}
```

- Used only for unreliable pos/rot updates.
- Existing `EntitiesPacket` still used for spawn/reliable updates.

---

## 5. Key Files

| Component | Path |
|-----------|------|
| Entity update emission | `server/src/worlds/entities/Entity.ts` (checkAndEmitUpdates) |
| Player threshold | `server/src/worlds/entities/PlayerEntity.ts` |
| Network sync queue | `server/src/networking/NetworkSynchronizer.ts` |
| Serializer | `server/src/networking/Serializer.ts` |
| Protocol schema | `protocol/schemas/Entity.ts` |
| Client deserializer | `client/src/network/Deserializer.ts` |
| Client entity update | `client/src/entities/EntityManager.ts` (_updateEntity) |
| Transport | `server/src/networking/Connection.ts`, `client/.../NetworkManager.ts` |

---

## 6. Quantization Constants (Suggested)

```ts
// Position: 1/256 block = 0.0039 block precision
const POSITION_QUANT = 256;

// Position range: ±32768 blocks (16-bit signed)
// Covers ~1km in each direction
const POSITION_MAX = 32767;
const POSITION_MIN = -32768;

// Quaternion: 16-bit per component, range [-1, 1] → 1/32767 precision
const QUATERNION_QUANT = 32767;
```

---

## 7. Success Metrics

| Metric | Current | Target (Phase 1) | Target (Phase 2) |
|--------|---------|------------------|------------------|
| Entity bytes/update (10 entities) | ~500–650 | ~300–400 | ~200–280 |
| Entity sync % of total packets | ~90% | ~70% | ~50% |
| Bandwidth (20 entities, 30 Hz) | ~15–20 KB/s | ~8–12 KB/s | ~5–8 KB/s |

---

## 8. References

- [Quaternion Compression (smallest three)](http://gafferongames.com/networked-physics/snapshot-compression/)
- [Minecraft entity sync (delta/quantization)](https://wiki.vg/Protocol#Entity_Metadata)
- Current codebase: `Entity.ts` (checkAndEmitUpdates), `NetworkSynchronizer.ts` (entity sync split), `Serializer.ts` (serializeVector/Quaternion)
