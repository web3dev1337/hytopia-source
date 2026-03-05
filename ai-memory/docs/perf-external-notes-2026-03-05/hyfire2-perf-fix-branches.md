# HyFire2 Performance Branch Research

Research date: 2026-03-05
Source repo: ~/GitHub/games/hyfire2
All perf/* branches merged to master. fix/* performance branches: some merged, some open.

---

## PERF/* BRANCHES (All Merged)

### 1. perf/cache-sceneui-takedamage (PR #1446)
**Problem:** `updateTeammateNameTagHealth()` called `sceneUIManager.getAllSceneUIs()` on every damage event, iterating ALL SceneUIs in the world just to find the 1-4 nametags attached to the damaged player. Combined with takeDamage hot path, this was causing multi-ms spikes per hit.

**Fix:**
- Cache array of SceneUIs attached to each player (`_teammateNameTagSceneUIs: SceneUI[]`)
- First call: search all SceneUIs, build cache. Subsequent calls: use cached array directly.
- Added full performance instrumentation to `takeDamage()` with checkpoint timing (logging, healthCalc, nametag, mvpTracking, sourceTracking, audioAndEffects, healthUI, damageEffectUI)
- Same instrumentation added to `handleDeath()` (init, botCacheInvalidate, audioCleanup, deathEffects, bombCancellation, broadcast, uiNotify, itemDrop)

**Profiling pattern:** `performance.now()` checkpoints at each section boundary, logged as `perfCheckpoints` object with `.toFixed(3)` values.

**Results from PERFORMANCE_FINDINGS.md:**
- Death handling: 3ms avg -> 1.5ms avg (50% improvement)
- weaponDrop bottleneck: ~1ms (JSON.stringify for deathEvent + grenade disposal logging)
- Removed `JSON.parse(JSON.stringify())` from deathEvent dispatch, saved ~0.5ms
- Optimized grenade disposal logging (batch instead of per-grenade), saved ~0.1ms

---

### 2. perf/stopping-power-optimization (PR #1451)
**Problem:** `StoppingPowerManager` was loaded via `require()` on every tick and every damage event. Module resolution is not free.

**Fix:**
- Cached `require()` result in module-level variable with lazy initialization pattern:
  ```typescript
  let stoppingPowerManagerCache: StoppingPowerManagerType | null = null;
  const getStoppingPowerManager = (): StoppingPowerManagerType => {
    if (!stoppingPowerManagerCache) {
      const { StoppingPowerManager } = require('./managers/StoppingPowerManager');
      stoppingPowerManagerCache = StoppingPowerManager.getInstance();
    }
    return stoppingPowerManagerCache;
  };
  ```
- Applied in GameManager tick handler AND GamePlayerEntity damage handler
- Added early exit in `StoppingPowerManager.update()` when no active effects: `if (this.activeEffects.size === 0 && this.cumulativeHits.size === 0) return;`

**Key pattern:** Cache dynamic `require()` calls at module scope. Check empty collections before doing work.

---

### 3. perf/reduce-weapon-fire-spike (PR #1457)
**Problem:** Multiple bots firing simultaneously caused massive frame spikes from synchronous projectile creation (physics body creation is expensive in Rapier3D).

**Fixes:**
1. **Deferred projectile creation:** Wrapped `ProjectileEntity` creation + spawn + fire in `setTimeout(() => { ... }, 0)` to spread physics body creation across ticks
2. **Removed redundant planting/defusing checks** from `_canShoot()` (already done in `shoot()`)
3. **Throttled recoil UI updates** to every 50ms (20/sec max) instead of every tick
4. **Skip zero-recoil updates:** Early return when `Math.abs(recoilOffset.x) < 0.0001 && Math.abs(recoilOffset.y) < 0.0001`

**Key pattern:** `setTimeout(fn, 0)` to defer expensive synchronous work to next tick. Reduces spike severity at cost of 1-frame latency (imperceptible).

---

### 4. perf/reduce-bot-combat-spike (PR #1458)
**Problem:** Multiple bots independently raycasting to check visibility against the SAME targets on the same tick. 5v5 = up to 25 raycasts/tick when all bots in combat. Profiling showed 120ms+ spikes from `BotCombatSystem.validateTargetVisibility`.

**Fix:** Created `RaycastCacheService` singleton:
- Per-tick cache (Map keyed by `${botId}_${targetId}`)
- Cleared every tick via `onTick()` called from GameManager tick handler
- **Bidirectional caching:** If A can see B, cache both A->B and B->A (visibility is symmetric along a raycast line)
- Also added zone-based pre-check in `BombVisibilityService`: `ZoneVisibilityService.shouldCheckVisibility()` before expensive raycast

**Results:** 39% overall raycast reduction. Peak 59.2% during intense combat. Scales better with more bots.

**Key pattern:** Per-tick cache with bidirectional key storage. Clear cache at tick boundary.

---

### 5. perf/fix-damage-ui-spikes (PR #1462)
**Problem:** Damage audio playback and hit effects (blood particles, damage direction UI) were synchronous in the takeDamage hot path. When multiple players take damage simultaneously, these stack.

**Fix:** Deferred non-critical work to next tick using `setTimeout(() => { ... }, 0)`:
- Damage audio playback
- Blood hit effect creation (PlayerEffectsController)
- Damage direction UI update to client

**Key pattern:** Same `setTimeout(fn, 0)` deferral pattern for non-gameplay-critical visual/audio effects.

---

### 6. perf/optimize-death-visibility-check (PR #1463)
**Problem:** Death handling did synchronous physics updates (disable collisions, move player below map) which blocked the main thread for ~1.5ms.

**Fixes:**
1. **Deferred physics updates** on death: collision group clearing + position teleport wrapped in `setTimeout(() => { ... }, 0)`
2. **Cached `require()` for DeathCameraSystem** using same module-level lazy pattern as stopping power

**Key pattern:** `setTimeout(fn, 0)` for physics state changes that don't need to be frame-perfect. Cache dynamic imports.

---

### 7. perf/investigate-weapon-drop (PR #1465)
**Problem:** Dropping weapons/grenades on death was synchronous and caused spikes, especially with multiple grenades.

**Fix:** Rewrote item dropping to be sequential-deferred:
- Collect all items to drop (best weapon + grenades) into an array
- Drop them one-per-tick using recursive `setTimeout`:
  ```typescript
  const dropItemsSequentially = (items, tickIndex = 0) => {
    if (tickIndex >= items.length) return;
    setTimeout(() => {
      // drop items[tickIndex]
      dropItemsSequentially(items, tickIndex + 1);
    }, 0);
  };
  ```

**Key pattern:** Sequential deferred processing for batch operations that would otherwise spike a single tick.

---

### 8. perf/optimize-mvp-tracking (PR #1469)
**Problem:** MVP damage tracking (scoreboard updates, XP tracking) was synchronous in takeDamage hot path. Also did expensive `gameManager.getPlayer(killerId)` lookup to check if attacker was a bot.

**Fixes:**
1. **Deferred MVP tracking** to next tick via `setTimeout(fn, 0)`
2. **Replaced expensive bot check:** Instead of `gameManager.getPlayer(killerId) -> attackerEntity.isBot()`, used simple string prefix check: `killerId.startsWith('bot_')`

**Key pattern:** Replace expensive lookups with convention-based shortcuts when possible. Defer non-critical tracking.

---

### 9. perf/remove-damage-debug-logging (PR #1470)
**Problem:** Extensive debug logging in the damage source tracking hot path was causing 4ms+ spikes. Logs included `Array.from(gameManager.players.keys())` and multiple `eventLogger.debug/info/warn` calls per hit.

**Fix:** Removed all debug/info/warn logging from the damage source tracking section and stopping power application section. Kept only error-level logging.

**Key insight:** In a 60Hz game loop, even "debug" logging has real cost. String interpolation, object creation for log context, and the logger's own overhead add up when called 10+ times per damage event.

---

### 10. perf/rate-limit-bot-navigator-warnings (PR #1471)
**Problem:** Bot navigator warnings for "cannot navigate" (dead bot) and "position access error" fired every tick per affected bot, creating log spam.

**Fix:** Added rate limiting with timestamps:
```typescript
private lastCannotNavigateTime: number = 0;
private readonly WARNING_RATE_LIMIT_MS = 5000;

if (now - this.lastCannotNavigateTime > this.WARNING_RATE_LIMIT_MS) {
  eventLogger.warn(...);
  this.lastCannotNavigateTime = now;
}
```

**Key pattern:** Time-based rate limiting for warnings that can fire every tick.

---

### 11. perf/remove-grenade-logging-overhead (PR #1515)
**Problem:** Grenade attack attempt logging was extremely verbose, firing on every left-click when holding a grenade. Included pouchSize, activeGrenadeIndex, cooldown calculations. Cooldown UI feedback was also sent on every blocked click.

**Fix:** Removed all verbose logging from grenade attack path. Removed cooldown UI feedback messages. Kept only the error-level log for failed attacks.

**Savings:** ~44 lines of logging code removed from the per-click hot path.

---

### 12. perf/optimize-recoil-offset-calls (PR #1255)
**Problem:** `RecoilSystem.getCurrentRecoilOffset()` called every tick per player (and in `_canShoot()`), always cloning the vector and applying recovery calculation.

**Fixes:**
1. **Added frame-level cache** to RecoilSystem:
   ```typescript
   private cachedOffset: Vector3 | null = null;
   private lastCacheTime: number = 0;
   private readonly CACHE_DURATION_MS = 16; // 1 frame at 60fps
   ```
2. Cache invalidated on `addRecoil()` and `reset()`
3. Skip recoil UI updates when offset is near-zero

**Key pattern:** Frame-duration caching for values computed multiple times per tick.

---

### 13. perf/web-audio-kill-sounds (PR #1678)
**Problem:** Kill sounds used `new Audio()` + `cloneNode()` (HTML5 Audio API), which has high latency and creates DOM elements.

**Fix:** Rewrote to use Web Audio API:
- Create `AudioContext` on first user interaction (autoplay policy compliance)
- Pre-decode all audio files into `AudioBuffer` objects on init
- On kill: create lightweight `BufferSource` node, connect to gain node, `source.start(0)`
- Latency: ~5-20ms (vs ~100-200ms for HTML5 Audio)
- No DOM element creation, no cloneNode overhead

**Key pattern:** Pre-decode audio into AudioBuffers for instant playback. BufferSource nodes are designed for single use and are lightweight.

---

### 14. perf/add-bot-combat-instrumentation (Open, not merged)
**What it does:** Adds `performance.now()` timing to two bot combat methods:
- `BotCombatSystem` angle-based reaction modifier calculation
- `shouldAllowMovementDuringCombat()` check

Pure instrumentation branch, no optimization. Logged as `perfMs` in existing event logger calls.

---

### 15. perf/bomb-retrieval-optimization (Open, not merged)
**Problem:** Bomb retrieval bot selection was slow due to:
1. Awaited logging calls (`await eventLogger.debug(...)`) blocking the selection loop
2. `Math.sqrt()` for distance calculations when only relative comparison needed
3. No position/distance caching

**Fixes:**
1. **Fire-and-forget logging:** Changed `await eventLogger.debug(...)` to `eventLogger.debug(...).catch(() => {})` throughout BotNavigator and BotGameService
2. **Squared distance comparison:** Replaced `Math.sqrt(dx*dx + dz*dz)` with raw `dx*dx + dz*dz` for scoring (sqrt is monotonic, so comparison order preserved)
3. **Performance instrumentation** throughout entire call chain with timing for each phase

**Key pattern:** Never `await` logging in hot paths. Use squared distance for comparisons.

---

### 16. perf/optimize-bot-updates (Open, not merged)
**Problem:** `TerroristSupportStrategy.execute()` taking 3.2ms per bot, with `brain.supportExecute` at 2.2ms (95% self-time). Root causes:
- `Array.from(assignedHoldPositions.values()).includes()` = O(n^2)
- `findBombCarrier()` cache too short (100ms)
- `getBots()` iterated frequently

**Fixes:**
1. **O(n^2) -> O(1):** Replaced `Array.from().includes()` with `new Set().has()` for hold position filtering
2. **Bomb carrier cache extended:** 100ms -> 500ms (carrier rarely changes)
3. **Entry fragger cache invalidation:** Added `clearEntryFraggerCache()` called when roles change (support promoted to entry fragger)
4. **Comprehensive performance instrumentation** with labeled checkpoints per objective phase
5. **Build position-to-bot map once** instead of `Array.from().some()` per position in patrol logic

**Key pattern:** Use Set for O(1) lookups instead of Array.includes(). Extend cache durations with proper invalidation.

---

### 17. perf/optimize-logging-overhead (Open, not merged)
**Problem:** `BotCoverServiceV2` logged extensively even in production. `EventLogger` always ran `Promise.all([logToConsole, logToFile])` even when both were disabled.

**Fixes:**
1. **Environment-gated logging:** Added `BOT_COVER_LOGS_ENABLED` env var check; skip all info/debug logging unless enabled
2. **Early exit in EventLogger.log():** Check if any output targets are enabled BEFORE constructing log entry:
   ```typescript
   const shouldLogToConsole = this.config.console.enabled && this.shouldLog(level, 'console');
   const shouldLogToFile = this.config.file.enabled && this.shouldLog(level, 'file');
   if (!shouldLogToConsole && !shouldLogToFile && !shouldNotifySubscribers) return;
   ```
3. **Conditional Promise.all:** Only create promise array for enabled outputs

**Key pattern:** Early exit before constructing log objects. Gate verbose logging behind env vars.

---

## FIX/* PERFORMANCE BRANCHES

### 18. fix/10v10-performance-analysis (Open, not merged)
**Problem:** 10v10 mode (20 players) caused severe performance degradation. Root cause: O(n^2) broadcast -- every player's state sent to every other player every tick.

**Fixes:**
1. **DistanceCullingService:** Skip updates for players beyond max distance (60 units default, 40 in perf mode). Different update rates by distance tier:
   - Close (<20): every tick
   - Medium (<40): every 3 ticks
   - Far (<60): every 6 ticks
2. **OptimizedBroadcastService:** Batched updates with priority scoring (distance + team + armed). Limits max players per update (12 in perf mode, 20 default).
3. **Accuracy data dedup:** Only send UI updates when JSON.stringify(data) changes
4. **Teammate nametag SceneUIs disabled** (load calls commented out) for testing

**Key pattern:** Distance-based LOD for network updates. Tiered update rates. Dedup before send.

---

### 19. fix/teammate-ui-performance-lag (Open, not merged)
**Problem:** SceneUI-based teammate nametags were a massive GPU/CPU bottleneck:
- Each SceneUI creates a DOM layer with CSS compositing
- `text-shadow` on nametags caused per-frame GPU repaints
- Duplicate SceneUIs created (one per viewer per teammate = n^2 SceneUIs)
- `getAllSceneUIs()` iterated on every health update

**Fix progression (11 commits, iterative):**
1. Removed `text-shadow` (GPU repaint trigger)
2. Removed forced GPU layer (`will-change`, `transform: translateZ(0)`)
3. Eliminated duplicate SceneUI creation (50% reduction)
4. Added memoization + visibility optimization
5. **Final solution:** Replaced all SceneUI nametags with screen-space UI. Server sends `teammate_positions` data every 3 ticks via `player.ui.sendData()`, client renders nametags in HTML overlay using camera projection.
6. Reverted intermediate approaches that didn't work

**Key insight:** SceneUI (world-space HTML overlay per entity) is expensive at scale. Screen-space UI (single HTML layer with projected positions) is far cheaper.

---

### 20. fix/memory-optimizations (Open, not merged)
**Problem:** Chrome heap timeline showed 12-30MB garbage collected every 5 seconds. 1,331 Array references, 372 Set references in heap dump. Mouse skipping and micro-stutters from GC pauses.

**Root causes identified:**
1. `BotManager.getBots()` returned `[...this._bots]` (new array copy) on every call, called 10+ times/sec
2. A* pathfinding created `new Map()` + `new Set()` per path request. 10 bots x 10 ticks/sec = 300 Maps/Sets per second
3. Player filtering via `Array.from(map.values()).filter()` creating 2 arrays per call
4. Blood particle test spawning particles every 5 seconds during warmup

**Fixes:**
1. **BotManager.getBots():** Return `readonly` reference to internal array (zero allocation)
2. **PathfindingCache:** Pre-allocated pool of 20 Maps and 20 Sets. A* acquires from pool, uses, releases back. Path results cached for 30 seconds with LRU eviction.
3. **PlayerCache:** Singleton that pre-categorizes players by team/alive/human/bot in single pass. Reuses same array instances (`array.length = 0` + push). Returns `readonly` references.
4. **Disabled blood particle test** during warmup

**MEMORY_OPTIMIZATION_FINDINGS.md documents:** Bun/JSC Rust aliasing rules that can crash the server if you do `entity.position.x = 5; entity.position.y = 10;` (multiple mutable borrows). Must copy position first.

**Key patterns:** Object pooling for hot-path allocations. Return readonly references instead of copies. Pre-categorize collections in single pass. `array.length = 0` to reuse array identity.

---

## CROSS-CUTTING PATTERNS SUMMARY

### Profiling Techniques Used
1. **Checkpoint timing:** `const perfStart = performance.now(); ... perfCheckpoints.name = performance.now() - perfStart;`
2. **Conditional logging:** Only log when time exceeds threshold (0.1ms, 0.3ms, 0.5ms)
3. **Per-tick cache stats:** Hit/miss counters with periodic reporting (every 60 ticks)
4. **Chrome heap timeline analysis:** For memory/GC issues (identified 1331 Array refs, 372 Set refs)

### Top Optimization Patterns (Ranked by Impact)
1. **setTimeout(fn, 0) deferral** -- Used in 5+ branches. Spreads synchronous work across ticks. Best for: audio, effects, physics state, item drops, MVP tracking. Cost: 1 frame latency (imperceptible).
2. **Per-tick raycast cache** -- 39% raycast reduction with bidirectional keying. Scales with player count.
3. **Object/collection pooling** -- PathfindingCache pools Maps/Sets. PlayerCache reuses arrays. Eliminated 300+ allocations/sec.
4. **Replace SceneUI with screen-space UI** -- n^2 SceneUI DOM layers replaced with single HTML overlay + projected positions.
5. **Cache dynamic require()** -- Module-level lazy singleton pattern. Eliminates module resolution on every call.
6. **Set-based lookups** -- Replace `Array.from(map.values()).includes()` (O(n)) with `new Set(map.values()).has()` (O(1)).
7. **Squared distance comparison** -- Skip Math.sqrt() when only comparing relative distances.
8. **Fire-and-forget logging** -- `.catch(() => {})` instead of `await` for log calls in hot paths.
9. **Rate-limited warnings** -- Timestamp-based throttle for per-tick warnings.
10. **Remove debug logging from hot paths** -- Even "debug" level has real cost (string creation, object allocation, logger overhead).

### Recurring Anti-Patterns Found
- `await eventLogger.debug(...)` in loops (blocks iteration on log I/O)
- `Array.from(map.values()).includes()` (O(n) scan, creates intermediate array)
- `[...this._bots]` on every getter call (constant array allocation)
- `require('module')` inside tick/damage handlers (module resolution overhead)
- `JSON.parse(JSON.stringify(obj))` for deep copy (expensive serialization roundtrip)
- `sceneUIManager.getAllSceneUIs()` to find specific UI elements (full scan)
- Verbose logging in per-damage, per-tick, per-grenade paths
- Creating new Map/Set in A* pathfinding (GC pressure at 300/sec)
