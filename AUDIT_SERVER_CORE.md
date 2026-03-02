# Server Core, Persistence, Events & Shared Utilities Audit

## Findings

### [BUG] PersistenceManager.setPlayerData Never Persists to Storage
**Benefit: 5/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/persistence/PersistenceManager.ts:115-121

**Status (verified): false positive (with a caveat).**

`SaveStatesClient.load()` returns a proxied object that tracks mutations and is periodically flushed by the SaveStates client itself (and on `unload()`). In that model, mutating the returned object is the intended way to persist changes; an explicit `save()` call is not required.

**Caveat:** `PersistenceManager.getPlayerData()` currently returns `{}` when the persistence load fails. Mutating that fallback object will not persist anything. That is a real behavior gap, but it is different from “writes never persist”.

```typescript
public async setPlayerData(player: Player, data: Record<string, unknown>): Promise<void> {
    const playerData = await this.getPlayerData(player);
    for (const [ key, value ] of Object.entries(data)) {
      playerData[key] = value;
    }
    // BUG: Missing this._saveStatesClient.save(this._getPlayerKey(player), playerData);
}
```

**Recommended fix:** Add `await this._saveStatesClient.save(this._getPlayerKey(player), playerData);` after the merge loop, or if SaveStatesClient returns a mutable cached reference that auto-flushes, verify that contract and document it.

---

### [BUG] PersistenceManager.getGlobalData Crashes on Network Error (null deref)
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/persistence/PersistenceManager.ts:56-71

**Status (verified): likely incorrect as written.**

`PlatformGateway.getGlobalData()` returns a `ServiceResponseDto`-shaped object (success variant has `error: undefined`, error variant has `error: { code, message }`). It should not return `undefined`/`null` unless it throws/rejects.

The real risk here is **uncaught exceptions / rejected promises** from the gateway call causing `getGlobalData()` itself to reject (no retry), rather than a deterministic “null deref” at `dataResult.error.code`.

```typescript
if (dataResult && !dataResult.error) {  // dataResult=undefined -> false
    return dataResult;
}
if (dataResult.error.code === 'keyNotFound') {  // TypeError: Cannot read property 'error' of undefined
```

**Recommended fix:** Add a null guard: `if (!dataResult) { ... continue to retry ... }` before accessing `dataResult.error`.

---

### [BUG] ErrorHandler.enableCrashProtection Registers Duplicate Handlers on Multiple Calls
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/errors/ErrorHandler.ts:108-122

`enableCrashProtection` has no guard against being called multiple times. While currently called once from `GameServer.start()`, if it were ever called again (e.g., after a restart attempt), each call adds new `process.on` handlers that stack. The `uncaughtException` handler calls `process.exit(1)` after 1 second, and multiple handlers would log duplicate messages.

**Recommended fix:** Add a static `_crashProtectionEnabled` flag and early-return if already set.

---

### [BUG] Ticker._tick Swallows Non-Error Exceptions Silently
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/shared/classes/Ticker.ts:172-181

When the tick callback throws something that is not an `Error` instance and there IS a `_tickErrorCallback`, the error is silently swallowed. The `else` branch only fires when `error` is NOT an Error OR there's no callback. But if `error` is NOT an Error AND there IS a callback, neither branch handles it.

```typescript
if (error instanceof Error && this._tickErrorCallback) {
    this._tickErrorCallback(error);  // only if Error AND callback exists
} else {
    ErrorHandler.warning(...);       // fires for: (not Error) || (no callback)
}
```

Actually this logic is correct -- if it's not an Error, it falls to `else` which logs a warning. But the warning message coerces `error` as `Error` which is misleading. The real issue is that if `error` IS an Error but there's no callback, the warning uses the wrong template (it says "not an instance of Error" when it actually is). Consider splitting the conditions.

---

### [BUG] EventRouter.emit Returns True Even When Final Listener Throws
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/events/EventRouter.ts:46-57

The `emit` method catches exceptions from both `_emitter.emit` and `_finalListeners` invocation in a single try/catch. If the normal emitter succeeds but the final listener throws, the error is logged but `true` is still returned, misleading callers into thinking emission was fully successful. More critically, if `_emitter.emit` throws, the final listener is skipped entirely.

**Recommended fix:** Either invoke the final listener in its own try/catch block, or document that emit's return value only indicates listener presence, not success.

---

### [BUG] SceneUI Constructor Rejects Valid Configurations (Neither Entity Nor Position)
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: no**

File: server/src/worlds/ui/SceneUI.ts:140

The constructor uses `!!options.attachedToEntity === !!options.position` to require exactly one of entity or position. However, this also throws a fatal error when BOTH are undefined (both are falsy, so `false === false` is true). A SceneUI that starts with neither and has entity/position set later via `setAttachedToEntity`/`setPosition` is impossible to create. This forces SDK users to always provide one up front.

**Recommended fix:** Change condition to explicitly check for both being set: `if (options.attachedToEntity && options.position)` and allow neither.

---

### [PERFORMANCE] ModelRegistry.preloadModels Loads Models Sequentially
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:181-187

Models are loaded one-by-one in a `for...of` loop with `await`. For games with dozens of models, this serializes all I/O and optimization work. The optimization step spawns `npx` subprocesses, which could easily run in parallel (bounded by CPU cores).

```typescript
for (const absoluteModelPath of absoluteModelPaths) {
    if (this.optimize) {
        await this._resolveOptimizedModelPath(absoluteModelPath);
    }
    await this._loadModelData(absoluteModelPath);
}
```

**Recommended fix:** Use `Promise.all` with a concurrency limiter (e.g., `p-limit`) to parallelize model loading, especially the optimization step. Even just parallelizing data loading (after optimization) would help.

---

### [PERFORMANCE] ModelRegistry._calculateChecksum Reads Entire File + Base64 Encodes
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:545-553

The checksum calculation reads the entire file into memory synchronously (`fs.readFileSync`), then converts to base64 before hashing. The base64 conversion is unnecessary overhead -- hashing the raw buffer is both faster and produces an equally valid checksum. For large model files (10+ MB), this doubles memory usage unnecessarily.

```typescript
return crypto.createHash('sha256')
    .update(fileContent.toString('base64'))  // unnecessary base64 conversion
    .update(MODEL_REGISTRY_CONFIG.VERSION.toString())
    .digest('hex');
```

**Recommended fix:** Pass `fileContent` (Buffer) directly to `.update()` without the `.toString('base64')` conversion.

---

### [PERFORMANCE] AudioManager/SceneUIManager/ParticleEmitterManager Entity Lookups Use Linear Scan
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/audios/AudioManager.ts:74-76
File: server/src/worlds/ui/SceneUIManager.ts:65-67
File: server/src/worlds/particles/ParticleEmitterManager.ts:72-73

All three managers find entity-attached items via `getAllX().filter(x => x.attachedToEntity === entity)`, which iterates the entire collection, allocates intermediate arrays, and is O(n). When despawning entities with many audio/particle/UI items in a world with hundreds of such items, this becomes expensive.

**Recommended fix:** Maintain a secondary `Map<Entity, Set<T>>` index for entity-attached lookups. This would make cleanup O(1) per entity instead of O(n) over all items.

---

### [PERFORMANCE] BlockTextureRegistry._createPaddedTexture Iterates All Pixels Including Interior
**Benefit: 2/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/textures/BlockTextureRegistry.ts:329-337

The padding loop iterates over every pixel in the padded texture (including the interior where the original texture already exists), checking if each pixel is in the padding region. For a 24px texture with 20px padding, the padded size is 64x64 = 4096 pixels, but only the ~3520 padding pixels need to be visited. The interior 576 pixels are checked and skipped.

**Recommended fix:** Split into 4 loops that iterate only the padding regions (top/bottom strips, left/right strips, corners). This is a startup-only cost so the benefit is minor.

---

### [PERFORMANCE] Telemetry.getProcessStats Called Twice for Slow Ticks
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/metrics/Telemetry.ts:163-167

In `beforeSend`, `getProcessStats()` (no arg, returns values) is called for every error event. In `beforeSendTransaction`, `getProcessStats(true)` (returns measurements) is called for slow ticks. Both call `process.memoryUsage()` which is not free. If an error occurs during a slow tick, the stats are gathered twice.

This is minor since it only happens on error/slow-tick events, not per-tick.

---

### [BUG] ModelRegistry._preprocessOptimizableModel Temp Files Can Collide
**Benefit: 3/5 | Risk: 3/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:778-781

Preprocessed models are written to `os.tmpdir()/hytopia-models-temp/<basename>`. If two models in different directories share the same filename (e.g., `assets/weapons/sword.glb` and `assets/armor/sword.glb`), the second write overwrites the first. If optimization ever becomes parallel, this would cause corrupted output.

```typescript
const tempPath = path.join(tempDir, path.basename(inputPath));
```

**Recommended fix:** Include a hash of the full path or the source directory in the temp filename to avoid collisions.

---

### [BUG] ModelRegistry._optimizeModel Returns inputPath on First Run Failure, Skipping Remaining Runs
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:678-681

When optimization fails for one run variant (e.g., the default variant), the method returns `inputPath` immediately, skipping all remaining optimizer runs AND the checksum write. This means subsequent runs (named-nodes, no-animations) are never generated, and the next startup will try to optimize again since no checksum was saved.

**Recommended fix:** Continue to the next run on failure rather than returning early, and only skip the checksum write if ALL runs failed.

---

### [BUG] Audio.setPosition Shallow-Compares Object References
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/audios/Audio.ts:423

`setPosition` uses `this._position === position` which compares object references, not values. If a caller creates a new `{x:1, y:2, z:3}` object with identical values, the check fails and an unnecessary event is emitted. Conversely, if the caller mutates the same object reference, the check passes and no update is sent.

The same pattern exists in `SceneUI.setPosition` (line 255) and `SceneUI.setOffset` (line 234).

**Recommended fix:** Compare x/y/z values individually, or accept that reference comparison is intentional (document it).

---

### [FEATURE] EventRouter Has No Way to Remove All Listeners for a Specific Instance
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/events/EventRouter.ts

When entities/audio/UI are destroyed, their EventRouter listeners on external routers (world, global) may linger. There is `offAll(eventType?)` but no `removeAllListenersOf(targetRouter)` pattern. Individual `off()` calls are needed for each registered listener, which is error-prone and relies on callers tracking their own listener references.

**Recommended fix:** This is somewhat mitigated by the per-instance EventRouter pattern (each object IS its own router). But for cross-router subscriptions (e.g., ChatManager subscribing to world events), provide a `dispose()` method that auto-removes all subscriptions.

---

### [FEATURE] ChatManager Command Registration Has No Duplicate Protection
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/chat/ChatManager.ts:114-116

`registerCommand` silently overwrites existing commands with the same name. If two game systems independently register `/help`, the second silently replaces the first with no warning.

**Recommended fix:** Log a warning when overwriting an existing command, or provide a `forceRegister` option.

---

### [FEATURE] ChatManager Has No Command Validation or Sanitization
**Benefit: 2/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/chat/ChatManager.ts:164-175

`handleCommand` does not validate or sanitize the message before splitting and dispatching. While the command callbacks receive raw `args`, there is no built-in length limiting, rate limiting, or character filtering. Long messages could produce very large `args` arrays.

The chat system itself does not appear vulnerable to injection since messages are dispatched through the event system and serialized via protocol buffers, but command callbacks written by SDK users may be vulnerable if they concatenate args into shell commands or database queries.

**Recommended fix:** Document security considerations for command callbacks. Optionally add a max message length check.

---

### [PERFORMANCE] ModelRegistry Reads Source File Twice During Data Regeneration
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:427-456

`_loadModelData` first calls `_calculateChecksum(absoluteModelPath)` which reads the entire file via `fs.readFileSync`, then if data needs regeneration, creates a `NodeIO().read(absoluteModelPath)` which reads the file again. For large model files, this doubles I/O.

**Recommended fix:** Cache the file buffer from the checksum calculation and pass it to `NodeIO` if available, or restructure to avoid the double-read.

---

### [BUG] startServer Uses init.length for Arity Detection (Unreliable with Default Parameters)
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/GameServer.ts:74

`init.length > 0` checks the function's `length` property to determine if it expects a `world` parameter. JavaScript's `Function.length` only counts parameters before the first one with a default value. So `(world = defaultWorld) => {...}` would have `length === 0` and wouldn't receive the world, which is surprising.

**Recommended fix:** Document this behavior, or provide separate `startServer` overloads / a config object rather than relying on arity detection.

---

### [BUG] Ticker Accumulator Can Cause Dropped Ticks When TICK_SLOW_UPDATE_CAP < MAX_ACCUMULATOR_TICK_MULTIPLE
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/shared/classes/Ticker.ts:4-5, 125-137

`TICK_SLOW_UPDATE_CAP = 2` limits updates per loop iteration, while `MAX_ACCUMULATOR_TICK_MULTIPLE = 3` allows the accumulator to hold up to 3 ticks worth of time. If the accumulator reaches 3x and only 2 ticks are processed, 1 tick worth of time remains. On the next iteration, if it stays behind, the accumulator is clamped again and the deficit grows. This means the game permanently runs slower than real time under sustained load instead of catching up.

This is actually the intended behavior (graceful degradation under load), but the constants should be aligned or the relationship documented.

---

### [BUG] ErrorHandler Crash Protection Calls process.exit After 1 Second Regardless of Recovery
**Benefit: 2/5 | Risk: 3/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/errors/ErrorHandler.ts:117-118

The `uncaughtException` handler logs the error and then unconditionally schedules `process.exit(1)` after 1 second. The comment and log message say "[FATAL]" but the method called is `this.error()` (non-fatal). The 1-second delay allows some I/O to flush but the process always exits regardless of whether the exception was actually fatal. Meanwhile `unhandledRejection` does NOT exit, creating inconsistent behavior between sync and async errors.

**Recommended fix:** This is debatable -- Node.js docs recommend exiting after uncaughtException. But the inconsistency with unhandledRejection should be documented or aligned.

---

### [PERFORMANCE] Vector3/Quaternion Extend Float32Array (Allocation Cost)
**Benefit: 2/5 | Risk: 5/5 | Effort: 5/5 | Surgical: no | Backwards Compatible: no**

File: server/src/shared/classes/Vector3.ts, Quaternion.ts

`Vector3` and `Quaternion` extend `Float32Array`, which means each `new Vector3(...)` allocates a typed array (involving ArrayBuffer backing store). In V8, typed arrays have higher allocation overhead than plain objects. For a game engine creating many temporary vectors per tick, this adds GC pressure.

However, this design enables direct passing to gl-matrix functions without conversion, which is a significant benefit. Changing this would break the entire SDK API surface.

**Not recommended for change** -- the tradeoff is reasonable. Noted for awareness.

---

### [BUG] ModelRegistry._optimizeModel Writes Checksum Even When UASTC Compression Fails
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts:695-703

When the `uastc` compression step fails, a warning is logged but the loop continues. The checksum is then saved at line 701, marking the model as "optimized." On next startup, the checksum matches and the uncompressed model is served. The user may not notice the warning and silently serve larger uncompressed textures.

**Recommended fix:** Either don't save the checksum when compression fails (so optimization is retried), or log a more prominent error.

---

### [FEATURE] AudioManager Never Cleans Up Non-Looping Audio That Finishes Playing
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/audios/AudioManager.ts

One-shot audio instances are registered in the manager but never automatically unregistered after playback completes. The `_audios` map grows indefinitely if many one-shot sounds are played. While the audio plays client-side and naturally stops, the server-side tracking remains, consuming memory.

**Recommended fix:** Add a TTL-based cleanup that periodically removes non-looping audio instances whose expected duration (based on `startTick` + `duration`) has elapsed. Or require explicit `unregisterAudio` calls from game code (but document this requirement).

---

### [BUG] Ajv Singleton Inconsistency: Class and Static Instance Are Different
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/shared/classes/Ajv.ts:12-16

The class extends `Ajv` but the static `instance` creates a plain `new Ajv()`, not a `new` of the subclass. This means `AjvWrapper.instance instanceof AjvWrapper` is false. While functionally harmless (the wrapper adds nothing), it's confusing.

```typescript
export default class extends Ajv {
    public static readonly instance = new Ajv();  // not new (this class)
}
```

---

### [FEATURE] PersistenceManager.setGlobalData Has No Retry Logic Unlike getGlobalData
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/persistence/PersistenceManager.ts:104-112

`getGlobalData` retries up to `maxRetries` times on failure, but `setGlobalData` attempts only once. A transient network error during a write loses data silently with only a warning.

**Recommended fix:** Add retry logic to `setGlobalData` consistent with `getGlobalData`, or document that writes are fire-and-forget.

---

### [FEATURE] SceneUI State Merge Is Shallow Only
**Benefit: 2/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: no**

File: server/src/worlds/ui/SceneUI.ts:273-274

`setState` does a shallow merge (`{ ...this._state, ...state }`). Nested object properties are replaced entirely rather than merged. This is a common footgun for SDK users who expect deep merge behavior.

**Recommended fix:** Document clearly that setState is a shallow merge, or provide a `setStateDeep` alternative.

---

### [BUG] EventRouter.emit listenerCount Check Disagrees with Actual Emission
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/events/EventRouter.ts:47

`emit` returns false if `listenerCount === 0`, skipping both normal and final listeners. However, `listenerCount` includes both the emitter's listeners and the final listener. The check is actually correct, but if a `once` listener was the only listener and it fires during the same `emit` call, the count could be stale. This is a theoretical edge case since eventemitter3 handles this correctly.

---

### [PERFORMANCE] BlockTextureRegistry.preloadAtlas Loads All Textures Into Memory At Once
**Benefit: 2/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/textures/BlockTextureRegistry.ts:168-179

All block textures are loaded simultaneously via `Promise.all`. For games with hundreds of block textures, this creates a memory spike. Each Jimp image allocates a bitmap buffer.

Since block textures are small (24x24), this is unlikely to be a practical issue. Noted for completeness.

---

### [FEATURE] ModelRegistry Has No Way to Register Models at Runtime
**Benefit: 2/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/models/ModelRegistry.ts

All models are discovered and loaded at startup. There is no public API to register a model at runtime (e.g., for user-uploaded content or dynamically generated assets). Adding a `registerModel(uri, path)` method would enable dynamic content loading.

---

### [BUG] AssetsLibrary.syncAsset Uses Relative Path Without CWD Context
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/assets/AssetsLibrary.ts:72-73

`path.join('assets', relativePath)` creates a relative path, meaning it depends on `process.cwd()` being the project root. This is typically true in HYTOPIA's runtime, but if the server is started from a different directory, assets would be written to the wrong location.

**Recommended fix:** Use `path.resolve(process.cwd(), 'assets', relativePath)` for explicit CWD resolution.
