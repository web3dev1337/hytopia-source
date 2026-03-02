# iPhone Pro Performance Analysis — Lag, Input Delay & Overheating

## Accuracy / Scope

This doc is written to be **factually accurate** by:
- Separating **verified code facts** from **hypotheses / expected impact**.
- Avoiding device-spec claims (thermals, bandwidth, exact DPR/model mappings, exact latency deltas) unless they are measured and recorded.

All code references were verified against the current repo state on **2026-03-02**.

## Problem Statement (Reported)

Reported on high-end iPhones (13 Pro, 14 Pro, 15 Pro, 16 Pro):
- Sustained lag and frame drops after a few minutes of gameplay
- Perceived input delay
- Device overheating / thermal throttling

Reported that some lower-end iPhones (SE, 12, 13 base, 14 base) run at acceptable performance with the same codebase.

## Root Cause Summary (Most Likely, Based on Code)

On devices where `requestAnimationFrame()` runs at higher refresh rates (for example 120Hz ProMotion):
- The default mobile quality preset is `MEDIUM`, and `MEDIUM` has **no FPS cap**. (`client/src/settings/SettingsManager.ts`, `client/src/core/Renderer.ts:249-271`)
- The renderer runs at full `window.devicePixelRatio * resolution.multiplier` (no DPR cap). (`client/src/core/Renderer.ts:495`, `client/src/core/Renderer.ts:593`)
- `MEDIUM` enables **outline + bloom + SMAA** post-processing. (`client/src/settings/SettingsManager.ts:86-101`)

Expected impact (hypothesis): total per-second render work scales roughly with:

`frames/sec * pixels/frame * (full-screen passes + scene passes)`

So a device that drives the game loop at 120Hz can be pushed much harder than a 60Hz device if we do not cap FPS and/or resolution.

---

## Issue List (Prioritized)

Ranked by expected impact based on code inspection (profiling still required).

| # | Issue | Verified in code? | Fix complexity |
|---|-------|-------------------|----------------|
| 1 | No FPS cap on `MEDIUM` (default mobile) | Yes | Low |
| 2 | Pixel ratio uses full `window.devicePixelRatio` (no cap) | Yes | Low |
| 3 | Outline pass has high worst-case texture sampling cost | Yes | Medium |
| 4 | `MEDIUM` enables all post-processing effects | Yes | Low |
| 5 | Auto-quality thresholds are poorly suited to high refresh rates | Yes | Medium |
| 6 | Mobile input packets are sent at 30Hz | Yes | Low |
| 7 | CSS2DRenderer updates DOM every frame | Yes | Medium |
| 8 | gzip decompression + msgpack decode are synchronous on main thread | Yes | High |
| 9 | WebTransport availability is browser-dependent; fallback is WebSocket | Yes | N/A |
| 10 | Chunk batch build messages are posted in a burst (no throttling) | Yes | Medium |
| 11 | Chunk meshing runs in a single Web Worker | Yes | Medium |
| 12 | Pointer listeners are not registered as passive | Yes | Low |
| 13 | Entity update skipping is per-frame, so higher FPS means more updates/sec | Yes | Medium |

---

## Detailed Analysis

### 1. No FPS Cap on MEDIUM/HIGH Presets (The Smoking Gun)

**Location:** `client/src/settings/SettingsManager.ts:86-139`, `client/src/core/Renderer.ts:249-271`

Verified:
- Only `POWER_SAVING` sets `fpsCap` (`fpsCap: 30`). `MEDIUM` and `HIGH` do not set `fpsCap`. (`client/src/settings/SettingsManager.ts:86-139`)
- The FPS cap only applies when `fpsCap` is set; otherwise, the render loop runs on every `requestAnimationFrame()` tick. (`client/src/core/Renderer.ts:249-271`)

```typescript
MEDIUM: {
  antialias: true,
  resolution: { multiplier: 1.0 },
  viewDistance: { enabled: true, distance: 150, ... },
  postProcessing: { outline: true, bloom: true, smaa: true },
  // fpsCap: undefined — NO CAP
},
```

Expected impact (hypothesis):
- On high-refresh-rate devices, `requestAnimationFrame()` can fire faster (often up to 120Hz).
- With no FPS cap on `MEDIUM`, every frame runs the full client update/render pipeline, including post-processing when enabled. (`client/src/core/Renderer.ts:249-320`)

**Suggested fix:** Add `fpsCap: 60` to the `MEDIUM` preset. This will cause the render loop to early-return on some `requestAnimationFrame()` ticks to keep updates/renders at or below the cap. (`client/src/core/Renderer.ts:256-271`)

---

### 2. Device Pixel Ratio Is Uncapped

**Location:** `client/src/core/Renderer.ts:495`

```typescript
this._renderer.setPixelRatio(window.devicePixelRatio * resolution.multiplier);
```

Verified:
- Effective pixel ratio is `window.devicePixelRatio * multiplier` and is not capped anywhere in the renderer. (`client/src/core/Renderer.ts:495`, `client/src/core/Renderer.ts:593`)

Facts (math):
- Pixels per frame scale with the **square** of effective pixel ratio.
- Example ratio: if effective DPR is 3 vs 2 at the same CSS size, pixel count is `(3/2)^2 = 2.25x`.

**Suggested fix:** Cap effective pixel ratio for mobile:
```typescript
const cappedDpr = MobileManager.isMobile ? Math.min(window.devicePixelRatio, 2.0) : window.devicePixelRatio;
this._renderer.setPixelRatio(cappedDpr * resolution.multiplier);
```

---

### 3. Outline Pass Worst-Case Sampling Cost Is High

**Location:** `client/src/three/postprocessing/SelectiveOutlinePass.ts:284-316`

Verified:
- The outline shader has a bounded nested loop up to `MAX_THICKNESS` (16) and 8 directions. (`client/src/three/postprocessing/SelectiveOutlinePass.ts:20-21`, `client/src/three/postprocessing/SelectiveOutlinePass.ts:284-316`)
- Each inner iteration samples **both** mask textures (`tMask` and `tMask2`) and may also sample depth textures. (`client/src/three/postprocessing/SelectiveOutlinePass.ts:292-313`)

```glsl
for (int t = 1; t <= MAX_THICKNESS; t++) {       // t = 1..16
  float thickness = float(t);
  for (int i = 0; i < 8; i++) {                   // 8 directions
    vec2 sampleUv = vUv + offsets[i] * texel * thickness;
    float sId1 = texture2D(tMask, sampleUv).r * 255.0;
    float sId2 = texture2D(tMask2, sampleUv).r * 255.0;
    // depth reads are conditional on edge detection
  }
}
```

Facts (shader worst-case bounds, per pixel):
- Pre-check loop: 8 directions × 2 mask samples = **16** mask texture samples. (`client/src/three/postprocessing/SelectiveOutlinePass.ts:265-273`)
- Search loop: 16 thickness steps × 8 directions × 2 mask samples = **256** mask texture samples, plus conditional depth reads. (`client/src/three/postprocessing/SelectiveOutlinePass.ts:284-316`)

Expected impact (hypothesis):
- This pass is a full-screen post-process; on high FPS and/or high effective DPR, it can dominate GPU time.

**Suggested fix:** Reduce outline thickness on mobile (for example clamp `maxThickness` lower), or disable outline in mobile presets where needed.

---

### 4. All Post-Processing Enabled on MEDIUM

**Location:** `client/src/settings/SettingsManager.ts:86-101`

MEDIUM enables the full post-processing pipeline:
```typescript
postProcessing: {
  outline: true,
  bloom: true,
  smaa: true,
}
```

LOW only disables bloom and SMAA but keeps outline. There is no intermediate preset like "outline only at 1.0x resolution" — you either get all three effects or drop to LOW's 0.85x resolution multiplier.

**Suggested fix:** Create a `MEDIUM_MOBILE` preset or disable bloom+SMAA on mobile MEDIUM.

---

### 5. Auto-Quality Thresholds Don’t Scale Well With High Refresh Rates

**Location:** `client/src/settings/SettingsManager.ts:181-193, 287-311`

The auto-quality system uses `refreshRate` as the target FPS:
```typescript
const targetFps = this._game.performanceMetricsManager.refreshRate;
```

Verified:
- Upgrade condition: `fps >= targetFps - 1` for 5 seconds. (`client/src/settings/SettingsManager.ts:310`, `client/src/settings/SettingsManager.ts:181-183`)
- Downgrade condition: `fps < min(30, targetFps * 0.5)` for 3 seconds. (`client/src/settings/SettingsManager.ts:311`, `client/src/settings/SettingsManager.ts:175-176`, `client/src/settings/SettingsManager.ts:181-183`)

Implication (fact from the above thresholds):
- For `targetFps = 120`, the upgrade threshold is ~119 FPS, while the downgrade threshold is still **30 FPS** (because `min(30, 120 * 0.5) = 30`).
- That means the auto-quality system is unlikely to react while running in the “degraded but not catastrophic” range (for example 40–100 FPS).

Also verified:
- On mobile, automatic quality increases are capped at `MEDIUM` (`MAX_QUALITY_LEVEL`). (`client/src/settings/SettingsManager.ts:198-199`)

**Suggested fix:** Use a capped target FPS (e.g. 60) for auto-quality decisions, or redesign thresholds so they scale with refresh rate in a way that still responds meaningfully on 120Hz devices.

---

### 6. Mobile Input Hardcoded to 30Hz

**Location:** `client/src/input/InputManager.ts:287-302`

```typescript
const inputUpdateHz = MobileManager.isMobile ? 30 : 60;

setInterval(() => {
  if (this._continuousInputState.cp === undefined &&
      this._continuousInputState.cy === undefined &&
      this._continuousInputState.jd === undefined) return;
  this._game.networkManager.sendInputPacket(this._continuousInputState);
  this._continuousInputState = {};
}, 1000 / inputUpdateHz); // 33ms on mobile
```

Facts:
- On mobile, continuous input packets are sent at 30Hz.
- On a 120Hz render loop, that is up to a **4x rate mismatch** between visual updates and input packet sends.

Expected impact (hypothesis):
- This mismatch can increase perceived latency/desync (especially if render FPS is high but network input is limited to 30Hz).
- Because input sending uses `setInterval()`, it is also sensitive to main-thread stalls (callbacks can be delayed under heavy load).

**Suggested fix:** Increase mobile input Hz to 60, or tie input dispatch to `requestAnimationFrame` with a minimum interval.

---

### 7. CSS2DRenderer DOM Thrashing at 120fps

**Location:** `client/src/three/CSS2DRenderer.ts:100-191`

The file itself contains a comment admitting: *"CSS2DRenderer appears to be a major performance bottleneck."*

Every frame, for every visible scene UI element:
1. Compute clip-space position and do a viewport visibility check
2. Potentially write `element.style.display`
3. Potentially write `element.style.transform`
4. Compute `distanceToSquared()` and store in a Map
5. Sort visible objects by distance (O(n log n))
6. Potentially write `element.style.zIndex` for each visible object

Expected impact (hypothesis):
- This work scales with FPS and number of visible scene UI elements.
- Even when the DOM writes are guarded by string comparison, the per-frame traversal, sorting, and style comparisons can be significant on mobile browsers.

**Suggested fix:** Throttle CSS2DRenderer to 30Hz maximum regardless of frame rate. Cache distance calculations and only update on significant position changes (>1 unit delta).

---

### 8. Synchronous Decompression on Main Thread

**Location:** `client/src/network/NetworkManager.ts:376-385`

```typescript
private _onMessage = (data: Uint8Array): void => {
  let dataUint8Array = data;

  if (this._isGzip(dataUint8Array)) {
    dataUint8Array = new Uint8Array(gunzipSync(dataUint8Array));
  }

  const decodedData = packr.unpack(dataUint8Array);
  // ... process packets ...
};
```

Facts:
- gzip decompression (when present) and msgpack decode both happen synchronously on the main thread.
- Large payloads can therefore consume a meaningful portion of a frame budget, especially at higher refresh rates.

**Suggested fix:** Move decompression + deserialization to a Web Worker. Post processed events back to main thread.

---

### 9. WebTransport Fallback to WebSocket Is Common (Browser-Dependent)

**Location:** `client/src/network/NetworkManager.ts:141-149`

Verified:
- The client attempts WebTransport when the global `WebTransport` exists, and falls back to WebSocket if it is unavailable or fails. (`client/src/network/NetworkManager.ts:141-149`)

```typescript
if (typeof WebTransport !== 'undefined') {
  await this._connectWebTransport();
}
if (!this._wt) {
  await this._connectWebSocket(); // Fallback
}
```

Expected impact (hypothesis):
- When WebSocket is used instead of WebTransport, head-of-line blocking and higher latency variance can make input feel worse, especially when combined with low input send rates. This needs measurement on target devices/browsers.

---

### 10. Aggressive Chunk Batch Loading

**Location:** `client/src/chunks/ChunkManager.ts:176-192`

When a chunks packet arrives, ALL affected batches are posted to the worker simultaneously:

```typescript
sortedBatches.forEach(batchId => {
  this._game.chunkWorkerClient.postMessage({
    type: 'chunk_batch_build',
    batchId,
    chunkIds,
  });
});
```

Facts:
- There is no throttling; the main thread posts a build message for every affected batch immediately.
- The worker then processes those messages sequentially.

**Suggested fix:** Rate-limit to 4-6 batch dispatches per frame.

---

### 11. Single Web Worker Bottleneck

**Location:** `client/src/workers/ChunkWorkerClient.ts:18`

```typescript
private _worker: Worker = new Worker(new URL('./ChunkWorker.ts', import.meta.url), { type: 'module' });
```

Only one Web Worker handles all chunk mesh generation. If many batches are queued (for example due to fast movement/teleports or large view distances), the worker processes them sequentially, which can become a bottleneck.

**Suggested fix:** Spawn 2 workers on capable devices (use `navigator.hardwareConcurrency` check).

---

### 12. Pointer Event Listeners Are Not Registered as Passive

**Location:** `client/src/input/InputManager.ts:281-284`

```typescript
window.addEventListener('pointerdown', (event) => this._onPointerDown(event));
window.addEventListener('pointerup', (event) => this._onPointerUp(event));
```

Facts:
- These listeners do not pass `{ passive: true }`.
- The handlers shown do not call `preventDefault()` (so they are eligible to be passive). (`client/src/input/InputManager.ts:343-389`)

**Suggested fix:** Add `{ passive: true }` where appropriate, then measure if it changes input/event handling performance on iOS.

---

### 13. Entity Updates Never Skip on High-FPS Devices

**Location:** `client/src/entities/Entity.ts:1494-1537`

```typescript
private _shouldUpdateAnimationAndLocalMatrix(frameCount: number): boolean {
  const distanceRatio = this._distanceToCameraSquared / (viewDistance * viewDistance);
  const skipFrames = Math.min(MAX_UPDATE_SKIP_FRAMES, Math.floor(distanceRatio * MAX_UPDATE_SKIP_FRAMES));
  if ((frameCount + this.id) % (skipFrames + 1) === 0) return true;
  return false;
}
```

Frame skipping is based on distance ratio; larger view distances reduce `distanceRatio`, which reduces `skipFrames` for a given entity distance. Because this decision is evaluated per frame, higher FPS also means more animation/matrix updates per second for entities that are scheduled to update.

**Suggested fix:** Factor in actual frame rate, not just distance — skip more at 120fps.

---

## Work Scaling (Why 120Hz Can Hurt)

Facts (math):
- If FPS doubles (60 → 120) and the same work is done each frame, per-second work roughly doubles.
- If effective DPR increases (2 → 3), pixels per frame increase by `(3/2)^2 = 2.25x`.
- Combined worst-case example: `2x * 2.25x = 4.5x` more fragment work per second.

Important: which iPhone models map to which DPR values depends on the model and iOS settings; do not assume “Pro = DPR 3, base = DPR 2”. Measure `window.devicePixelRatio` and the measured `requestAnimationFrame()` refresh rate on the actual target devices.

---

## Recommended Fix Priority

### Immediate (Low Complexity, High Impact)

1. **Add `fpsCap: 60` to MEDIUM preset** — 1 line, immediate thermal relief
2. **Cap mobile effective DPR to 2.0** — reduces pixels/frame on devices where `devicePixelRatio > 2`
3. **Disable bloom + SMAA on mobile MEDIUM (if needed)** — keep outline only, or disable outline first depending on profiling
4. **Increase mobile input Hz from 30 to 60** — reduces input/render rate mismatch on high-refresh devices

### Short-Term (Medium Complexity)

5. **Use capped target FPS (e.g. 60) for auto-quality decisions** instead of raw refresh rate
6. **Throttle CSS2DRenderer to 30Hz** regardless of frame rate
7. **Rate-limit chunk batch dispatch** to worker (max 4-6 per frame)
8. **Clamp outline thickness lower on mobile** (for example `maxThickness <= 8`)

### Medium-Term (Higher Complexity)

9. **Move gunzipSync + deserialization to Web Worker**
10. **Spawn multiple chunk mesh workers** on capable devices
11. **Add passive flag to pointer event listeners (where safe)**
12. **Scale entity update frequency by actual FPS** (skip more at 120Hz)

### Not Fixable (Apple Platform Limitation)

13. **WebTransport on iOS (if unsupported)** — if the browser does not support WebTransport, the client must use WebSocket
