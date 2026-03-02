# Client Systems Audit: Network, Input, UI, Entities, Audio, Particles, and More

Auditor: client-systems-auditor
Date: 2026-03-03
Scope: `client/src/network/`, `client/src/input/`, `client/src/mobile/`, `client/src/ui/`, `client/src/entities/`, `client/src/audio/`, `client/src/particles/`, `client/src/players/`, `client/src/settings/`, `client/src/bridge/`, `client/src/arrows/`, `client/src/services/hytopia/`, `client/src/textures/`

---

## Findings

### [BUG] BridgeManager postMessage uses wildcard origin -- security risk
**Benefit: 5/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/bridge/BridgeManager.ts:220`

**Status (verified): partially correct / slightly mis-framed.**

Using `window.parent.postMessage(message, '*')` does mean the client will send bridge data to whatever origin is hosting the parent frame. If the client can be embedded by untrusted origins, this can become a data exfiltration vector. If embedding is restricted (for example via `frame-ancestors` / X-Frame-Options on the served client), the wildcard target origin becomes much less relevant.

The more direct issue is that `_onParentMessage` processes incoming `message` events without validating `event.origin` and without checking `event.source === window.parent` (`client/src/bridge/BridgeManager.ts:152`). A malicious embedding parent (or any window with a handle) could inject:
- `SEND_CHAT_MESSAGE` to send arbitrary chat messages as the player
- `SET_QUALITY_PRESET` to force POWER_SAVING mode (griefing)
- `LOCK_POINTER` / `UNLOCK_POINTER` to disrupt gameplay
- `TOGGLE_DEBUG` to expose debug info

**Fix:** In `_onParentMessage`, validate both `event.source` (must be `window.parent`) and `event.origin` (allowlist) before processing. Optionally also replace `'*'` with the expected parent origin to prevent accidental embedding data leaks.

---

### [BUG] UIManager innerHTML injection allows XSS from server-controlled HTML
**Benefit: 5/5 | Risk: 3/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/UIManager.ts:164`

`_onUIPacket` fetches HTML from `deserializedUI.htmlUri` and sets `this._uiDiv.innerHTML = html` directly. It then executes all `<script>` tags found in that HTML via `_executeScripts`. While the HTML comes from the game server (which the SDK developer controls), this pattern means:

1. Any game server can run arbitrary JS in the client iframe context, accessing `Game.instance`, `NetworkManager`, and all internal state.
2. If a game server is compromised or a malicious SDK game is published, it can exfiltrate player data, hijack sessions, or perform actions on behalf of the player.
3. The `{{CDN_ASSETS_URL}}` replacement at line 163 could be abused if the CDN URL contains special regex characters (unlikely but worth noting).

This is partially by design (SDK developers need to provide UI), but the lack of sandboxing means a rogue SDK game gets full client access.

**Fix:** Consider running game developer UI in a sandboxed iframe with a restrictive CSP, communicating via postMessage. At minimum, document the trust model clearly. For the `{{CDN_ASSETS_URL}}` replacement, use `replaceAll` with string (not regex) to avoid regex injection.

---

### [BUG] Monkey-patched addEventListener does not track removeEventListener
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/UIManager.ts:20-31`

The global `EventTarget.prototype.addEventListener` is monkey-patched to track elements with click/pointer listeners in a `WeakSet`. However, `removeEventListener` is not patched, so once an element is added to `elementsWithClickListeners`, it stays there even if all listeners are removed. This means `eventPathHasClickListener()` may return false positives after a listener is removed, causing interact clicks to be incorrectly suppressed (players tap on areas where UI listeners were removed, but the interaction ray never fires).

Since `WeakSet` only tracks presence, not count, removing the element when a listener is removed requires a reference-counted approach (e.g., a `WeakMap<EventTarget, number>`).

**Fix:** Also monkey-patch `removeEventListener`. Use a `WeakMap<EventTarget, number>` to track listener counts. When count reaches 0, remove the entry.

---

### [PERFORMANCE] Deserializer creates many intermediate objects per packet
**Benefit: 4/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/Deserializer.ts:274-642`

Every deserialization call allocates new objects: `new THREE.Color()`, `new Uint32Array()`, `new Float32Array()`, and plain objects via spread/map. For high-frequency packets like `ENTITIES` (every server tick at 60Hz with potentially dozens of entities), this creates significant GC pressure.

For example, `deserializeEntities` calls `.map()` which creates a new array, then for each entity creates a new object with potentially new `THREE.Color` instances (lines 388, 407), new vectors, etc. With 100 entities, that is hundreds of short-lived objects per tick.

**Fix:** Use an object pool for `DeserializedEntity` objects and `THREE.Color`/`Vector3Like` instances. Alternatively, deserialize in-place by passing the target entity directly to the deserializer. The `Vector3Like` results (just `{x,y,z}`) could reuse a pre-allocated scratch object.

---

### [BUG] Input sequence numbers increment even when not sent
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/NetworkManager.ts:200-206`

`sendInputPacket` increments `_lastInputSequenceNumber` unconditionally at line 206, but the sequence number `sq` is only attached to joystick packets (line 200-201). This means:
1. Non-joystick input packets (key presses) cause sequence number gaps.
2. The server may interpret these gaps as dropped packets and apply unnecessary compensation.

**Fix:** Only increment `_lastInputSequenceNumber` when a joystick packet is actually sent (move the increment inside the `if (changedInputState.jd !== undefined)` block).

---

### [BUG] WebSocket connection promise never rejects on failure
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/NetworkManager.ts:325-342`

`_connectWebSocket` returns a Promise that resolves on `onopen` but never rejects. If the WebSocket connection fails, `onerror` fires and closes the socket, but the promise hangs forever. The `connect()` method at line 148 does `await this._connectWebSocket()` and then checks `!this._ws`, but since `onerror` sets `_ws.close()` which triggers `onclose` -> `_reconnect()`, the await never completes and execution flow becomes unpredictable.

**Fix:** Add a `reject` call in `onerror`/`onclose` handlers, or use a timeout. Store the resolve/reject pair and call reject on connection failure.

---

### [BUG] setInterval timers in NetworkManager leak on reconnect
**Benefit: 4/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/NetworkManager.ts:156-157`

`connect()` creates two `setInterval` timers (synchronize every 2000ms, heartbeat every 5000ms) but never stores the interval IDs. On reconnect (which reloads the iframe), this is fine since the entire context is destroyed. However, if `connect()` were ever called twice without a full page reload, the intervals would stack, sending duplicate sync/heartbeat packets. The `_killConnection` method does not clear these intervals either.

**Fix:** Store the interval IDs and clear them in `_killConnection()`. Also add a guard in `connect()` to prevent re-creating them.

---

### [BUG] Reliable WebTransport packet queue drops silently on overflow
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/NetworkManager.ts:222-225`

When the reliable packet queue exceeds 32 entries, the oldest packet is silently dropped with only a console.warn. For reliable packets (which include all non-camera/joystick input), dropping packets means player actions (jumps, button presses, interact events) can be lost without any server-side awareness.

**Fix:** Instead of silently dropping, consider: (1) increasing the queue size, (2) notifying the server that packets may have been lost, or (3) implementing backpressure by pausing input acceptance when the queue is full. At minimum, increment a counter for telemetry.

---

### [PERFORMANCE] InputManager sends discrete input changes immediately, no batching
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/input/InputManager.ts:337-339`

When a key is pressed/released, `_onInputChange` immediately calls `sendInputPacket` for each individual state change. If a player presses W+Shift simultaneously (common for sprint), two separate packets are sent within the same frame. The continuous input state (camera/joystick) is already batched on a timer, but discrete inputs are not.

**Fix:** Buffer discrete input changes and batch them with the next continuous input packet tick. This would reduce packet count without meaningful latency increase (16ms at 60Hz). The server already handles batched input fields.

---

### [BUG] Mobile camera cleanup clears all camera positions when one finger lifts
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/mobile/MobileManager.ts:143-147`

In `cleanupJoystick`, when a camera joystick is removed (finger lifted), `cameraPositions.clear()` is called, which clears ALL camera positions including the still-active finger. This means:
1. During a pinch-to-zoom, lifting one finger causes the remaining finger's camera delta to be calculated from scratch, producing a sudden camera jump on the next move event.
2. The `lastPinchDist` is also reset to null, so the next pinch distance calculation starts fresh.

**Fix:** Only delete the specific finger's position from `cameraPositions` (`cameraPositions.delete(id)`) instead of clearing the entire map. Reset `lastPinchDist` only when pinch is truly over (both fingers lifted).

---

### [BUG] SceneUI viewDistance of 0 cannot be set (falsy check)
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/UIManager.ts:291-293`

`if (deserializedSceneUI.viewDistance)` uses a truthy check, which means a `viewDistance` of `0` is treated as "not set" and ignored. While a view distance of 0 may seem unlikely, it could be used intentionally to hide a SceneUI at all distances, or it could be set accidentally. The same issue exists at line 279 for `offset` (a zero offset `{x:0,y:0,z:0}` is a valid value that would be skipped).

**Fix:** Use explicit `!== undefined` checks: `if (deserializedSceneUI.viewDistance !== undefined)`.

---

### [BUG] AudioManager uses truthy checks for volume/playbackRate/offset, skipping value 0
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/audio/AudioManager.ts:87-101`

Several property checks in `_updateAudio` use truthy checks:
- `if (deserializedAudio.volume)` - skips volume 0 (mute)
- `if (deserializedAudio.playbackRate)` - skips playback rate 0 (pause)
- `if (deserializedAudio.offset)` - skips offset 0
- `if (deserializedAudio.cutoffDistance)` - skips cutoff 0
- `if (deserializedAudio.referenceDistance)` - skips reference 0
- `if (deserializedAudio.startTick)` - skips tick 0

Setting volume to 0 (muting) is a common operation that would fail silently.

**Fix:** Use `!== undefined` checks for all numeric properties.

---

### [BUG] Nametag chat message XSS vector via innerHTML-adjacent patterns
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/templates/Nametag.ts:62`

Chat messages are filtered through `profanityFilter.clean()` at line 62 and set via `nametagChat.textContent = profanityFilter.clean(chat)`, which is safe. However, `nametagUsername` at line 70 also uses `.textContent` which is safe. The profanity filter itself doesn't sanitize HTML, but since `.textContent` is used rather than `.innerHTML`, the current code is actually safe.

However, this finding is a **preventive warning**: any future change from `.textContent` to `.innerHTML` for styling purposes (bold, color, etc.) would immediately create an XSS vector since profanity filter output is not HTML-escaped.

**Fix:** Add a code comment noting that `.textContent` must be used (not `.innerHTML`) for user-supplied strings. Consider adding HTML entity escaping as defense-in-depth.

---

### [BUG] Assets.urlExists caches errors permanently (rejected promises cached forever)
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/Assets.ts:88-106`

The `ErrorCache` map stores promises for URL existence checks, including rejected promises (from network errors). Once a URL check fails due to a transient network issue, the rejection is cached forever, and subsequent calls for the same URL return the same rejected promise. This means:
- A temporary network blip during model loading permanently prevents that model from loading.
- The `getEffectiveGLTFlUri` method iterates candidates and catches rejections, but the fundamental issue is that network failures are treated as permanent.

**Fix:** On rejection, remove the entry from `ErrorCache` so the next check retries. Optionally add a TTL for negative results.

---

### [BUG] EntityManager._updateEntity processes updates on already-removed entities
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/entities/EntityManager.ts:316-420`

When `deserializedEntity.removed` is true, the entity is released and deleted from the maps at lines 317-325. However, the method continues executing after the `if` block and processes subsequent property updates (blockTextureUri, emissiveColor, modelAnimations, position, etc.) on the now-released entity. While the entity object still exists in memory, calling setters on a released entity can cause warnings, wasted work, or unexpected behavior.

**Fix:** Add a `return` after the removal block:
```typescript
if (deserializedEntity.removed) {
  entity.release();
  this._entities.delete(entity.id);
  this._dynamicEntities.delete(entity.id);
  this._outlines.delete(entity.id);
  return; // <-- add this
}
```

---

### [PERFORMANCE] EntityManager.findEntityByName is O(n) linear scan
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/entities/EntityManager.ts:72-79`

`findEntityByName` iterates all entities to find one by name. The TODO at line 71 acknowledges this. This is called from `hytopia.getEntityIdByName()` which SDK game UI code can call frequently.

**Fix:** Maintain a secondary `Map<string, Entity>` index for name lookups. Update on entity creation, name change, and removal.

---

### [BUG] Modal overlay does not prevent body scrolling on mobile
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/Modal.ts:17-107`

When a modal is displayed, the background body can still scroll on mobile devices (touch events pass through the overlay). This can cause the viewport to scroll while the player is trying to interact with the modal.

**Fix:** Add `overflow: hidden` to `document.body.style` when showing the modal, restore on close. Alternatively, add `touch-action: none` to the overlay element.

---

### [BUG] PlayerManager never cleans up player data, grows unbounded
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/players/PlayerManager.ts:33-56`

When `deserializedPlayer.removed` is true, the player is deleted from `_players`. However, there is no mechanism to handle the case where a player disconnect packet is lost (e.g., on unreliable transport). The `_players` map could accumulate stale entries over long sessions. This is a minor issue since the map is keyed by player ID (string) and players are typically removed by the server.

More importantly, when a player is removed, their `Player` object is just deleted from the map with no cleanup. If anything else holds a reference (unlikely currently), it would leak.

**Fix:** Consider a periodic sweep that reconciles the player list with the server, similar to `AudioManager._cleanupOrphanedAudio()`.

---

### [PERFORMANCE] AudioManager._cleanupIfNeeded creates a full array on every audio update
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/audio/AudioManager.ts:135-141`

`_cleanupIfNeeded` calls `Array.from(this._audios.values()).filter(audio => audio.hasActiveNode).length` on every `_updateAudio` call, creating a temporary array of all audios just to count active nodes. With many audio instances, this is wasteful.

**Fix:** Track `activeNodeCount` as a counter, incrementing when an audio node is created and decrementing when disposed.

---

### [PERFORMANCE] SettingsManager._levelChangeHistory grows unbounded
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/settings/SettingsManager.ts:232`

`_levelChangeHistory` is an array that only grows (via `push`) and is never pruned. The comment at line 230 acknowledges this. While quality changes are infrequent, over a very long session it could grow. The `_reachedMaxBounceCount` method only checks the last N entries.

**Fix:** Keep only the last `MAX_QUALITY_BOUNCE_COUNT * 2` entries by slicing or using a ring buffer.

---

### [BUG] Heartbeat service starts unconditionally on module load, no cleanup
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/services/hytopia/heartbeat.ts:60`

`start()` is called at module load time (line 60), which means the heartbeat polling loop runs from the moment the script is imported. If the player disconnects and reconnects (via iframe reload), a new heartbeat loop starts without stopping the old one. In a single-page-app scenario, this could lead to multiple concurrent heartbeat loops.

The while-true loop at line 33 has no cancellation mechanism (no AbortController, no flag check). The only exit conditions are `invalidToken` or `notInLobby` errors.

**Fix:** Add an AbortController that is signaled on disconnect/cleanup. Expose a `stop()` function. Consider moving the heartbeat start to be triggered by a game lifecycle event rather than module import.

---

### [BUG] CustomTextureManager.load promise never resolves on texture load failure
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/textures/CustomTextureManager.ts:54-79`

The `wrappedTexturePromise` created in `load()` only calls `resolve()` -- there is no `reject()`. The inner `await texturePromise` can throw (texture load failure), but this is unhandled. The TODO at line 55 acknowledges this. If the texture fails to load, the promise hangs forever, and any caller awaiting it hangs too. This could cause particle emitters, entities, and arrows to silently fail to display.

**Fix:** Add a try/catch around the `await texturePromise` and resolve with a fallback texture (e.g., a magenta "missing texture" placeholder) or reject the promise so callers can handle the error.

---

### [FEATURE] Input does not support key rebinding
**Benefit: 3/5 | Risk: 1/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/input/InputManager.ts:57-96`

The `CODE_TO_KEY_MAP` and `SUPPORTED_INPUT_MAP` are hardcoded constants. Players cannot rebind keys. This is a common feature request for PC games and accessibility.

**Fix:** Make the key maps configurable via a settings UI or bridge message. Store bindings in localStorage. Provide a default mapping that matches the current hardcoded one.

---

### [FEATURE] No client-side prediction or reconciliation for player movement
**Benefit: 4/5 | Risk: 4/5 | Effort: 5/5 | Surgical: no | Backwards Compatible: yes**

File: `client/src/input/InputManager.ts:287-303`

The comment at line 288-290 acknowledges this: "we can change this to 30 when we have client prediction." Currently, the client sends input to the server and waits for the server to send back the entity position update. This means all movement has at least one RTT of latency, which feels sluggish especially on higher-latency connections.

**Fix:** Implement client-side prediction with server reconciliation. This is a large architectural change that would require the client to simulate physics locally and reconcile with server-authoritative state.

---

### [BUG] Keyboard input with Shift key can double-fire due to both code and key mapping
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/input/InputManager.ts:89-143`

`CODE_TO_KEY_MAP` maps `ShiftLeft` and `ShiftRight` to `'shift'`, and `SUPPORTED_INPUT_MAP` maps `'shift'` to `'sh'`. However, the `CODE_TO_KEY_MAP` has a comment on line 89 mapping to `'shift'` but `SUPPORTED_INPUT_MAP` maps the key value `'shift'` to `'sh'`. The flow is: `keydown` event -> code `'ShiftLeft'` -> `CODE_TO_KEY_MAP` maps to `'shift'` -> `_onInputChange('shift', true)` -> `SUPPORTED_INPUT_MAP['shift']` = `'sh'` -> sends `{sh: true}`.

For Shift+number combos, the `SUPPORTED_INPUT_MAP` maps `'!'` to `'1'`, `'@'` to `'2'`, etc. But `_onKeyboardInputChange` uses `event.code` (not `event.key`), so these key-based mappings at lines 120-138 are dead code -- they will never be reached via the keyboard code path.

**Fix:** Remove the dead shift+number mappings from `SUPPORTED_INPUT_MAP` since `_onKeyboardInputChange` uses `event.code` via `CODE_TO_KEY_MAP`. If shift+number support is needed, add `Digit1`+shift handling in `CODE_TO_KEY_MAP` or use `event.key` as a fallback.

---

### [BUG] Translations service initializes with hardcoded production URL
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/services/hytopia/translations.ts:4`

`hytopiaTranslations.init('https://prod.translations.hytopia.com')` is hardcoded. In development or staging environments, this still hits production. Not a bug per se, but could cause issues during testing of translation changes.

**Fix:** Use an environment variable or derive the URL from the current environment (local vs production).

---

### [PERFORMANCE] ParticleEmitter._updatePosition always updates matrix even when nothing changed
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/particles/ParticleEmitter.ts:211-226`

`_updatePosition` always calls `updateMatrix()`, `matrixWorld.copy()`, and `updateAABB()` every frame, regardless of whether the position actually changed. The TODO at line 212 acknowledges this.

**Fix:** Track the last applied position and skip the matrix update when the position hasn't changed (compare with epsilon). For entity-attached emitters, check if the entity's position changed since the last update.

---

### [BUG] Arrow constructor error messages reference wrong field names
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/arrows/Arrow.ts:70-71, 76-77`

Line 70: error says "Either sourceEntityId or targetEntityId must be specified" but should say "Either sourceEntityId or sourcePosition must be specified" (validates source, not target).
Line 76: error says "Either targetEntityId or targetEntityId must be specified" but should say "Either targetEntityId or targetPosition must be specified" (also duplicates "targetEntityId").

**Fix:** Correct the error messages:
- Line 70: `"Arrow: Exactly one of sourceEntityId or sourcePosition must be specified."`
- Line 76: `"Arrow: Exactly one of targetEntityId or targetPosition must be specified."`

---

### [PERFORMANCE] Deserializer.deserializeBlocks/Chunks/etc use .map() creating intermediate arrays
**Benefit: 2/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/network/Deserializer.ts:297-374`

All batch deserialization methods (deserializeAudios, deserializeBlocks, deserializeBlockTypes, deserializeChunks, etc.) use `.map()` which creates a new array. For large chunk updates, this can create arrays with thousands of entries. Combined with the per-item object allocation, this creates considerable GC pressure.

**Fix:** Pre-allocate result arrays with known length and fill them in a for loop. For very hot paths (entities, chunks), consider deserializing into a reusable buffer.

---

### [BUG] SceneUI removeFromScene does not clean up containerDiv or template DOM
**Benefit: 2/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/SceneUI.ts:142-144`

`removeFromScene` only calls `this._object.removeFromParent()`. The `_containerDiv` created in `_createObject` (and any DOM elements created by the template renderer) are not explicitly cleaned up. While `removeFromParent()` should detach the CSS2DObject which removes its DOM element from the CSS2DRenderer's DOM tree, any event listeners or timers set up by the template renderer (like the setTimeout in Nametag) are not cleaned up.

**Fix:** Null out `_containerDiv` and `_onStateCallback` in `removeFromScene()`. Call a cleanup/dispose callback if the template renderer registered one.

---

### [BUG] SettingsManager quality adjustment has unreachable else branch
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/settings/SettingsManager.ts:272`

At line 272, there is `} {` instead of `} else {`. This means the `resetDuration = false` block at line 273 always executes when the condition at line 269 is false, making `resetDuration` always false when inside the `stats.thresholdExceeded` block and the duration hasn't reached the threshold yet. This appears to be the intended behavior (don't reset duration while accumulating), but the missing `else` keyword means the code works by accident, not by intent.

Wait -- actually re-reading: the `{ resetDuration = false; }` block at line 272-274 is NOT an else. It is a standalone block that always executes after the `if` at line 269. This means `resetDuration` is set to `false` even when `stats.duration >= stats.durationThreshold` (when quality was just changed), preventing the duration from being reset after a quality change. This could cause an immediate re-trigger.

**Fix:** Add the missing `else` keyword: `} else { resetDuration = false; }`.

---

### [BUG] EntityStats.reset() clears frustumCulledCount twice
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/entities/EntityStats.ts:22, 27`

`EntityStats.frustumCulledCount` is reset to 0 at both line 22 and line 27 in the `reset()` method. This is a harmless duplicate but indicates a copy-paste error.

**Fix:** Remove the duplicate line.

---

### [BUG] StaticEntity.updateLightLevel recalculates globalCoordinate from position that never changes
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/entities/StaticEntity.ts:136-147`

`updateLightLevel()` saves the current global coordinate, recalculates it from `entityRoot.position`, then compares to see if it changed. But since StaticEntity's position never changes (all setPosition calls are overridden to warn and return), the global coordinate will never change either. The comparison is wasted work.

**Fix:** For StaticEntity, calculate the global coordinate once at construction time and skip the comparison in `updateLightLevel()`.

---

### [FEATURE] Mobile pinch-to-zoom should support touchpad two-finger gestures on desktop
**Benefit: 2/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/mobile/MobileManager.ts`

The pinch-to-zoom functionality is only available on mobile (gated by `MobileManager.isMobile`). Laptop users with touchpads who use two-finger pinch gestures get no zoom support. The wheel event is likely handled elsewhere (Camera.ts), but the gesture-based zoom is a nicer UX for touchpad users.

**Fix:** Detect touchpad pinch gestures via the `wheel` event's `ctrlKey` property (browsers set `ctrlKey=true` for pinch gestures) and apply zoom accordingly.

---

### [PERFORMANCE] HytopiaUI.emitData iterates all callbacks even if data is targeted
**Benefit: 1/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `client/src/ui/globals/hytopia.ts:138-142`

`emitData` iterates all registered `_onDataCallbacks` for every data packet. If a game has many data listeners (e.g., for different UI panels), all of them receive every packet and must individually check if the data is relevant to them.

**Fix:** Allow optional topic/type-based filtering when registering callbacks, so only relevant callbacks are invoked.
