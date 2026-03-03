# Entity & Player Systems Audit

> Audited files: `server/src/worlds/entities/` (Entity.ts, PlayerEntity.ts, DefaultPlayerEntity.ts, EntityManager.ts, EntityModelAnimation.ts, EntityModelNodeOverride.ts), `server/src/worlds/entities/controllers/` (BaseEntityController.ts, DefaultPlayerEntityController.ts, SimpleEntityController.ts, PathfindingEntityController.ts), `server/src/players/` (Player.ts, PlayerCamera.ts, PlayerManager.ts, PlayerUI.ts)

---

### [BUG] ColliderMap entity entries leak on entity despawn
**Benefit: 5/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/Entity.ts:1323 (spawn) and server/src/worlds/entities/Entity.ts:782 (despawn)

**Status (verified): false positive under normal simulation stepping.**

Although `Entity.spawn()` registers colliders into `ColliderMap`, collider removal goes through `Simulation.removeRawCollider()`, which queues the collider handle for cleanup and `ColliderMap.cleanup()` runs each physics step. Under normal server operation (world loop continues stepping), stale entity references are cleared and this does **not** grow unboundedly.

**Edge case:** if the simulation stops stepping after removals are queued (e.g., a world is stopped/paused without a final cleanup), queued handles could linger until the next step.

**Fix:** In `Entity.despawn()`, before `this.removeFromSimulation()`, iterate colliders and call `this._world!.simulation.colliderMap.removeColliderEntity(collider)` for each.

---

### [BUG] PlayerEntity.spawn() leaks event listener on player
**Benefit: 5/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/PlayerEntity.ts:137

`PlayerEntity.spawn()` registers an anonymous listener on `this.player` for `PlayerEvent.CHAT_MESSAGE_SEND`. However, `Entity.despawn()` never removes this listener. If a PlayerEntity is despawned and re-spawned (e.g. world switching, respawn mechanics), a new listener is added each time while old ones persist. This causes:
1. Memory leak from accumulated closures referencing despawned entities.
2. Stale `nametagSceneUI.setState()` calls on despawned SceneUIs.

**Fix:** Store the listener reference and remove it in a `despawn()` override, or use `player.on()` with a named function and call `player.off()` in despawn.

---

### [BUG] DefaultPlayerEntity cosmetics applied after despawn (race condition)
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/DefaultPlayerEntity.ts:122

`this.player.cosmetics.then(...)` is an async operation that resolves after network fetch. If the entity is despawned before the promise resolves, the callback at line 122 checks `if (!cosmetics || !this.modelUri) return;` but does NOT check `this.isSpawned`. The code then calls `hairEntity.spawn(world, ...)` and `cosmeticItemEntity.spawn(world, ...)` on a world reference that may have already unregistered this entity. Child entities will be spawned into the world orphaned from their despawned parent.

**Fix:** Add `if (!this.isSpawned) return;` at the top of the `.then()` callback, before any cosmetic processing.

---

### [BUG] EntityManager._nextEntityId monotonically increases (no recycling)
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/EntityManager.ts:66

`_nextEntityId` starts at 1 and increments forever. For long-running servers with high entity churn (thousands of spawns/despawns per minute for projectiles, particles, mobs), the ID will eventually exceed `Number.MAX_SAFE_INTEGER` (2^53 - 1), at which point IDs lose precision and may collide. While this would take an extremely long time in practice, the ID is also sent over the network as a serialized number, and very large numbers increase packet size.

**Fix:** Consider recycling IDs from a free list, or resetting periodically. Alternatively, use a 32-bit counter with wrapping (sufficient for any practical session).

---

### [PERFORMANCE] PathfindingEntityController._reconstructPath uses array.unshift() in loop
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:516-525

`_reconstructPath()` builds the path by calling `path.unshift(curr)` in a while loop. `Array.unshift()` is O(n) because it shifts all existing elements. For a path of length N, this gives O(N^2) total work. With `maxOpenSetIterations` of 200+, paths can be long.

**Fix:** Use `path.push(curr)` and call `path.reverse()` after the loop. This is O(N) total.

---

### [PERFORMANCE] PathfindingEntityController._coordinateToKey creates strings per call
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:528-530

`_coordinateToKey()` creates a template literal string every call: `` `${coordinate.x},${coordinate.y},${coordinate.z}` ``. This is called thousands of times per pathfind (every neighbor, every gScore/fScore lookup, every closedSet check). String creation + GC pressure is significant.

**Fix:** Use a numeric hash: `(x + 1000) * 4000000 + (y + 1000) * 2000 + (z + 1000)` (assuming world bounds). Alternatively, use a 3D key encoding that avoids string allocation.

---

### [PERFORMANCE] PathfindingEntityController._findGroundedStart allocates spread objects in loop
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:651-666

`_findGroundedStart()` creates `{ ...start, y: start.y - dy - 1 }` and `{ ...start, y: start.y - dy }` via spread in a loop. Similarly, the A* loop itself creates spread objects for neighbors (line 450-454) and horizontal offset combinations (line 407-410). Each allocation contributes to GC pressure during pathfinding.

**Fix:** Reuse a mutable coordinate object for lookups instead of allocating new ones per iteration.

---

### [PERFORMANCE] EntityManager query methods allocate arrays every call
**Benefit: 3/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/EntityManager.ts:97-213

`getAllEntities()`, `getAllPlayerEntities()`, `getPlayerEntitiesByPlayer()`, `getEntitiesByTag()`, `getEntitiesByTagSubstring()`, and `getEntityChildren()` all allocate new arrays every call. `getEntityChildren()` is called during `Entity.despawn()` (line 787) meaning every despawn causes an O(N) scan + array allocation over all entities.

**Fix:** For `getEntityChildren()`, consider maintaining a parent->children map. For the others, consider returning iterators or caching results.

---

### [BUG] DefaultPlayerEntityController ground contact count can go negative
**Benefit: 4/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:503

`this._groundContactCount += started ? 1 : -1;` can go negative if a collision-end event arrives without a corresponding collision-start (e.g., due to physics engine edge cases, entity teleportation, or collider removal while in contact). A negative count means `isGrounded` returns false forever (correct), but subsequent contact-start events would increment to 0 and isGrounded would still be false (incorrect - player would be unable to jump even when on the ground).

Similarly, `_liquidContactCount` at line 443 has the same issue.

**Fix:** Clamp to zero: `this._groundContactCount = Math.max(0, this._groundContactCount + (started ? 1 : -1))`. Same for `_liquidContactCount`.

---

### [BUG] DefaultPlayerEntityController._stepAudio not cleaned up on detach/despawn
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:414-421

`_stepAudio` is created in `attach()` but there is no `detach()` or `despawn()` override to stop/dispose it. The entity's `despawn()` does call `world.audioManager.unregisterEntityAttachedAudios(this)` which handles cleanup at the manager level, but the `_stepAudio` reference itself is never cleared, and if the audio is currently playing when despawn happens, there's no explicit stop. This is a minor issue since the audio manager cleanup should handle it, but defensive cleanup would be safer.

**Fix:** Override `despawn()` in the controller to call `this._stepAudio?.pause()` and clear the reference.

---

### [BUG] Player.joinWorld() world switch calls disconnect which triggers LEFT_WORLD twice
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/players/Player.ts:295-321

When switching worlds, `joinWorld()` calls `this.disconnect()` which calls `this._leaveWorld()` then `this.connection.disconnect()`. `_leaveWorld()` emits `PlayerEvent.LEFT_WORLD` and sets `this._world = undefined`. Then `this._world = world` is set on line 318. However, the `disconnect()` call at line 316 triggers the connection close flow, which eventually calls `PlayerManager._onConnectionClosed()` (line 195-213) which calls `player.disconnect()` **again**. Since `_world` is already set to the new world by line 318, `_leaveWorld()` will emit `LEFT_WORLD` for the **new** world, not the old one.

The timing depends on whether connection.disconnect() is synchronous. If it is, the second `disconnect()` call in `_onConnectionClosed` would cause a double LEFT_WORLD emission with the wrong world reference.

**Fix:** Restructure world-switching to not use the disconnect/reconnect path, or guard `_leaveWorld()` against being called when world is already cleared.

---

### [BUG] SimpleEntityController.tick() face yaw extraction is approximate
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/SimpleEntityController.ts:487-489

The yaw extraction formula `Math.atan2(2 * (w * y), 1 - 2 * (y * y))` assumes the quaternion has zero pitch and roll (only yaw). This is correct for Y-axis-only rotations, but if the entity somehow gets pitched or rolled (e.g. from physics before lockAllRotations, or manual setRotation with non-Y components), the extracted yaw will be incorrect, causing the entity to face the wrong direction.

**Fix:** This is acceptable for the current use case since `SimpleEntityController` only sets Y-axis rotation, but document the assumption clearly.

---

### [PERFORMANCE] DefaultPlayerEntityController.tickWithPlayerInput allocates objects per tick
**Benefit: 3/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:565-789

The controller already uses reusable vectors (`_reusableImpulse`, `_reusableTargetVelocities`, etc.) which is good. However, the rotation quaternion at line 782-787 `{ x: 0, y: Math.sin(halfFinalYaw), z: 0, w: Math.cos(halfFinalYaw) }` creates a new object every tick. At 60Hz per player entity, this adds up.

**Fix:** Add a `private readonly _reusableRotation = { x: 0, y: 0, z: 0, w: 1 }` and mutate it in-place.

---

### [BUG] Entity.setModelScale division by zero when current scale component is 0
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/Entity.ts:1041-1045

```typescript
const scalar: Vector3Like = {
  x: modelScale.x / this._modelScale.x,
  y: modelScale.y / this._modelScale.y,
  z: modelScale.z / this._modelScale.z,
};
```

If any current scale component is 0 (which could happen if a developer sets `modelScale: { x: 0, y: 1, z: 1 }` to flatten an entity), dividing by zero produces `Infinity` or `NaN`, which propagates to all collider scales. Rapier may crash or produce undefined behavior.

**Fix:** Guard against zero division: `x: this._modelScale.x === 0 ? 1 : modelScale.x / this._modelScale.x`.

---

### [BUG] PathfindingEntityController setTimeout leaks if entity despawns during jump delay
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:571-601

`_moveToNextWaypoint()` uses `setTimeout()` with a `jumpTimeout` delay. If the entity is despawned before the timeout fires, the callback at line 571 checks `if (!this._entity)` but `this._entity` is only cleared in `detach()`. If the entity is despawned without the controller being properly detached first, or if the entity reference is not nulled, the callback proceeds to call `this.face()` and `this.move()` on a despawned entity.

The `detach` does set `_entity = undefined`, and `Entity.despawn()` does call `controller.detach()`, so the guard works in the normal path. But the setTimeout is never cancelled, meaning it fires wastefully after despawn.

**Fix:** Store the timeout ID and clear it in `detach()`: `clearTimeout(this._jumpTimeoutId)`.

---

### [PERFORMANCE] EntityManager.getEntityChildren scans all entities O(N)
**Benefit: 4/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/EntityManager.ts:203-213

`getEntityChildren()` iterates over ALL entities to find children of a given entity. This is called during every `Entity.despawn()` (line 787). In a world with 1000+ entities, despawning an entity incurs an O(N) scan. Games with heavy entity churn (spawning/despawning hundreds of projectiles or mobs) will feel this.

**Fix:** Maintain a `Map<Entity, Set<Entity>>` children index. Update it in `registerEntity/unregisterEntity` and when `setParent()` is called.

---

### [BUG] Player._onInputPacket sequence number check allows replay on wrap
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/players/Player.ts:522-525

```typescript
if (input.sq !== undefined) {
  if (input.sq < this._lastUnreliableInputSequenceNumber) return;
  this._lastUnreliableInputSequenceNumber = input.sq;
}
```

If `input.sq` wraps around (e.g. from a large number back to 0), all subsequent packets would be rejected because they're less than the last seen number. The code has no wrap-around handling. On reconnection, `_lastUnreliableInputSequenceNumber` is reset to 0 (line 381), which helps for reconnects but not for long sessions where the client-side counter might wrap.

**Fix:** Use modular arithmetic for comparison, or accept packets within a reasonable window of the last seen sequence number.

---

### [BUG] PlayerEntity.tick has unnecessary semicolon after return guard
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/PlayerEntity.ts:146

```typescript
if (!this.isSpawned || !this.world) {
  return;
};
```

The semicolon after the closing brace is a no-op statement. Not a runtime bug, but indicates a potential copy-paste error.

---

### [FEATURE] Entity despawn should clear all event listeners to prevent leaks
**Benefit: 4/5 | Risk: 3/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: no**

File: server/src/worlds/entities/Entity.ts:782-809

Entity extends EventRouter (via RigidBody), but `despawn()` never calls any listener cleanup. External code can register listeners on entities (`entity.on(EntityEvent.TICK, ...)`), and these listeners + their closures will persist after despawn, keeping the entity and its references alive in memory. Since `Entity` is intended to be disposable (despawn = done), all listeners should be cleared on despawn.

**Fix:** Call `this.removeAllListeners()` (from eventemitter3) at the end of `despawn()`. This is backwards-incompatible for any code that registers listeners before spawn and expects them to survive a despawn/respawn cycle, but such usage is unusual.

---

### [FEATURE] PlayerUI.sendData and PlayerUI.load lack input validation
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/players/PlayerUI.ts:97-210

`PlayerUI.load(htmlUri)` and `PlayerUI.append(htmlUri)` accept arbitrary `htmlUri` strings from the server-side SDK developer. If the URI points to a file with unescaped content, or if a developer constructs HTML dynamically, this could lead to XSS in the client iframe. While this is primarily an SDK developer responsibility, there's no validation that the URI is a valid path/URL format, and no documentation warning about injection risks.

`PlayerUI.sendData(data)` accepts arbitrary objects. On the client side, if this data is rendered into DOM without sanitization, it creates an XSS vector. The server doesn't validate or sanitize the data.

**Fix:** Add a warning in documentation about sanitization requirements. Optionally validate that `htmlUri` matches an expected pattern (e.g. starts with `ui/` or is a valid URL).

---

### [FEATURE] PathfindingEntityController path caching for repeated destinations
**Benefit: 3/5 | Risk: 3/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:284-308

`pathfind()` runs the full A* algorithm synchronously every time. If multiple entities pathfind to similar destinations (e.g. 20 zombies targeting the same player), each one runs independent A*. There is no path caching or shared pathfinding.

**Fix:** Implement a path cache keyed by (start_region, end_region) with a short TTL. Or use a flow-field approach for many-to-one pathfinding scenarios.

---

### [PERFORMANCE] PathfindingEntityController A* pushes duplicate entries to open set
**Benefit: 3/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/PathfindingEntityController.ts:495

When a better path to a neighbor is found, the code pushes a new entry to the heap: `openSet.push([neighborKey, neighbor])`. But the OLD entry for the same neighbor key is still in the heap (there's no decrease-key or removal). When the old entry is popped later, it's caught by the `closedSet.has(neighborKey)` check (line 464), but the heap still processes it. This means the heap can contain many duplicate entries, increasing memory and iteration count.

**Fix:** This is a known pattern (lazy deletion) and is acceptable for small heaps, but for large pathfinding operations it can waste iterations. Consider using a proper decrease-key heap or checking `closedSet` after pop.

---

### [FEATURE] Entity re-spawn support
**Benefit: 3/5 | Risk: 4/5 | Effort: 3/5 | Surgical: no | Backwards Compatible: yes**

File: server/src/worlds/entities/Entity.ts:1323-1388

Once despawned, an entity cannot be re-spawned because:
1. `_id` is set to undefined, but `spawn()` checks `if (this.isSpawned)` which only checks `_world`.
2. `removeFromSimulation()` clears `_simulation` and `_rigidBody`, and there's no mechanism to re-add.
3. Colliders are removed and cannot be re-created.

Games frequently want respawn mechanics (e.g. respawning collectibles, mobs). Currently, developers must create an entirely new Entity instance.

**Fix:** This is a larger architectural change. Consider adding a `respawn()` method or making `spawn()` handle re-initialization cleanly.

---

### [BUG] DefaultPlayerEntityController.attach monkey-patches entity.applyImpulse permanently
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:405-412

`attach()` replaces `entity.applyImpulse` with a wrapper that accumulates impulses into `_externalVelocity`. The original is saved in `_internalApplyImpulse`. However, `detach()` (inherited from base) never restores the original `applyImpulse`. If a different controller is attached after this one detaches, the entity's `applyImpulse` still points to the wrapper from the old controller, which writes to a `_externalVelocity` that's no longer being read.

**Fix:** Override `detach()` to restore the original `applyImpulse`: `entity.applyImpulse = this._internalApplyImpulse`.

---

### [BUG] Entity.spawn registers colliders in colliderMap but child-added colliders from controllers are not
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/Entity.ts:1383-1385 and controllers/DefaultPlayerEntityController.ts:478-535

`Entity.spawn()` iterates existing colliders and registers them in the colliderMap (line 1383-1385). But `DefaultPlayerEntityController.spawn()` creates two new child colliders AFTER the entity's spawn completes (called at line 1376 `this._controller.spawn(this)`). These controller-created colliders (groundSensor, wallCollider) are never registered in the colliderMap because the registration loop already ran.

This means raycasts and collision queries that use the colliderMap won't resolve these colliders to their parent entity. For the ground sensor (which is a sensor), this is acceptable since sensors don't participate in normal raycasting. But the wall collider is not a sensor and could be hit by raycasts without being attributed to the entity.

**Fix:** Register colliders in colliderMap inside `createAndAddChildCollider()` if the entity is already spawned, not just in the spawn loop.

---

### [PERFORMANCE] Entity.modelAnimations and Entity.modelNodeOverrides return new arrays every access
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/worlds/entities/Entity.ts:593 and 604

```typescript
public get modelAnimations(): ... { return Array.from(this._modelAnimations.values()); }
public get modelNodeOverrides(): ... { return Array.from(this._modelNodeOverrides.values()); }
```

Every property access allocates a new array. If game code accesses these frequently (e.g. in tick callbacks), this creates unnecessary GC pressure.

**Fix:** Cache the array and invalidate on add/remove, or return a `ReadonlyMap` instead.

---

### [BUG] Player.interact only raycasts against the first player entity
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: server/src/players/Player.ts:542

```typescript
const playerEntity = this.world.entityManager.getPlayerEntitiesByPlayer(this)[0];
```

The raycast excludes only the first player entity's rigid body. If a player has multiple player entities (which the API allows - `getPlayerEntitiesByPlayer` returns an array), the raycast would hit the player's other entities. This is an edge case but could cause self-interaction bugs for games using multiple player entities.

**Fix:** Exclude all player entities' rigid bodies from the raycast, or document that only one player entity per player is expected.
