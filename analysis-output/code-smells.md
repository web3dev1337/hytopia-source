# Hytopia Codebase -- Code Smells Analysis

**Analyzed files:** 40+ files across `server/src/`, `client/src/`, and `protocol/`
**Date:** 2026-03-08

---

## Table of Contents

1. [God Classes](#1-god-classes)
2. [Long Methods / Excessive Repetition](#2-long-methods--excessive-repetition)
3. [Feature Envy](#3-feature-envy)
4. [Primitive Obsession / Data Clumps](#4-primitive-obsession--data-clumps)
5. [Type Safety Issues](#5-type-safety-issues)
6. [Magic Numbers and Strings](#6-magic-numbers-and-strings)
7. [DRY Violations](#7-dry-violations)
8. [Memory Leak Risks](#8-memory-leak-risks)
9. [Error Handling Issues](#9-error-handling-issues)
10. [Console / Debug Leftovers](#10-console--debug-leftovers)
11. [Dead Code / TODOs](#11-dead-code--todos)
12. [Coupling Issues](#12-coupling-issues)
13. [Mutable State Issues](#13-mutable-state-issues)
14. [Inconsistencies](#14-inconsistencies)
15. [Promise Anti-patterns](#15-promise-anti-patterns)

---

## 1. God Classes

### CRITICAL: `NetworkSynchronizer` -- 1561 lines

**File:** `server/src/networking/NetworkSynchronizer.ts`
**Responsibilities:** Event subscription, state queuing, sync serialization, packet batching, per-player routing, singleton/collection sync abstraction, entity model sync, camera sync.

This is the most extreme God Class in the codebase. It has:
- **60+ private event handler methods** (lines ~400-1305), each following the exact same pattern: create-or-get a sync object, set a single property on it
- ~15 `_createOrGetQueued*Sync` methods (lines ~1320-1447)
- 2 generic sync collection methods
- 2 sync output collection methods
- A `synchronize()` method that orchestrates everything

**Suggested improvement:** Extract domain-specific synchronizers (AudioSyncHandler, EntitySyncHandler, CameraSyncHandler, ParticleEmitterSyncHandler, etc.) that each handle their own event subscriptions and sync queuing. The NetworkSynchronizer becomes an orchestrator that registers handlers and calls `synchronize()`.

**Standard for:** EXISTING codebase should refactor. NEW code must not add to this file.

---

### CRITICAL: Client `Entity` -- 2900 lines

**File:** `client/src/entities/Entity.ts`
**Responsibilities:** 3D model management, animation playback, interpolation, block entity rendering, material/texture management, frustum culling, bounding box computation, light level tracking, parent-child attachment, node overrides, custom textures, emissive color management.

This is the largest file in the entire codebase. It has:
- 50+ private fields (lines 175-265)
- Multiple concerns mixed: rendering, animation, spatial queries, material management

**Suggested improvement:** Extract `EntityAnimationManager`, `EntityMaterialManager`, `EntityCullingManager`, `EntityInterpolator` as separate classes. The Entity becomes a coordinator.

**Standard for:** EXISTING codebase should refactor. NEW code must not add rendering logic here.

---

### MAJOR: `RigidBody` and `Collider` -- 1760 and 1750 lines each

**Files:** `server/src/worlds/physics/RigidBody.ts`, `server/src/worlds/physics/Collider.ts`

Both classes are very large wrappers around RAPIER physics. They expose dozens of getters/setters that largely proxy to the underlying physics engine.

**Suggested improvement:** These are somewhat acceptable as facade wrappers, but the setter-per-property pattern with event emission could be generated or handled via a generic property-change observer pattern to reduce boilerplate.

**Standard for:** Acceptable for EXISTING code. NEW physics features should extract sub-concerns (e.g., `ColliderShapeFactory`).

---

### MAJOR: `GLTFManager` -- 1812 lines

**File:** `client/src/gltf/GLTFManager.ts`

Handles model loading, caching, texture compression, mesh optimization, instancing, material pipeline, and resource cleanup -- all in one file.

**Standard for:** EXISTING codebase should consider splitting. NEW code should not add to this file.

---

## 2. Long Methods / Excessive Repetition

### CRITICAL: NetworkSynchronizer event handlers -- 60+ identical-pattern methods

**File:** `server/src/networking/NetworkSynchronizer.ts:400-977`

```typescript
// This exact pattern repeats 60+ times:
private _onParticleEmitterSetColorEnd = (payload: EventPayloads[ParticleEmitterEvent.SET_COLOR_END]) => {
    const particleEmitterSync = this._createOrGetQueuedParticleEmitterSync(payload.particleEmitter);
    particleEmitterSync.ce = payload.colorEnd ? Serializer.serializeRgbColor(payload.colorEnd) : undefined;
};
```

Each handler: (1) gets a sync object, (2) assigns one property. This is the textbook case for a data-driven approach (a mapping table from event type to sync property + optional serializer).

**Suggested improvement:** Replace with a registration table:
```typescript
// Instead of 60 handler methods:
const particleEmitterMappings = [
  { event: ParticleEmitterEvent.SET_COLOR_END, key: 'ce', field: 'colorEnd', serializer: Serializer.serializeRgbColor },
  // ... etc
];
```

**Standard for:** EXISTING codebase should refactor. NEW code must NOT add more handler methods to this file.

---

### MAJOR: `DefaultPlayerEntityController.tickWithPlayerInput` -- ~225 lines

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:565-789`

This single method handles:
- Input parsing
- Swimming state
- Movement animations (3 branches, each with animation loops)
- Movement rotation calculation (joystick + WASD)
- Interaction handling
- Horizontal velocity calculation
- Swimming physics
- Jumping logic
- Platform velocity
- External impulse decay
- Final impulse application
- Character rotation

**Suggested improvement:** Decompose into `_handleAnimations()`, `_calculateMovementVelocity()`, `_handleSwimmingPhysics()`, `_handleJumping()`, `_applyPhysicsImpulses()`, `_applyRotation()`.

**Standard for:** Both EXISTING and NEW code. Methods should be under ~40 lines.

---

### MAJOR: Animation management repetition in DefaultPlayerEntityController

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:597-630`

The same pattern repeats 3 times for ground/swim/idle animations:
```typescript
entity.stopAllModelAnimations(animation => animations.includes(animation.name) || animation.loopMode === EntityModelAnimationLoopMode.ONCE);
for (const animation of animations) {
    entity.getModelAnimation(animation)?.setLoopMode(EntityModelAnimationLoopMode.LOOP);
    entity.getModelAnimation(animation)?.play();
}
```

**Suggested improvement:** Extract a `_playAnimationSet(entity, animations)` helper.

**Standard for:** Both EXISTING and NEW code.

---

### MAJOR: Setter method boilerplate in Entity, PlayerCamera, ParticleEmitter

**Files:** Multiple server files

Every property setter follows an identical pattern:
```typescript
public setSomething(value: T) {
    if (this._something === value) return;
    this._something = value;
    if (this.isSpawned) {
        this.emitWithWorld(this._world!, EventType.SET_SOMETHING, { entity: this, something: value });
    }
}
```

This pattern repeats 20+ times in `Entity.ts`, 15+ times in `PlayerCamera.ts`, 30+ times in `ParticleEmitter.ts`.

**Suggested improvement:** Consider a generic `_setAndEmit<K>()` helper or decorator-based approach.

**Standard for:** Acceptable pattern for EXISTING code but NEW code should consider reducing boilerplate.

---

## 3. Feature Envy

### MAJOR: NetworkSynchronizer reaching into every domain object

**File:** `server/src/networking/NetworkSynchronizer.ts`

This class imports and directly accesses internals of: Audio, BlockType, Chunk, Entity, EntityModelAnimation, EntityModelNodeOverride, ParticleEmitter, Player, PlayerCamera, PlayerUI, SceneUI, World, Simulation. It subscribes to events from all of them.

The synchronizer knows more about each domain object's internal structure than the objects themselves -- it accesses `.id`, `.serialize()`, `.position`, `.isSpawned`, etc.

**Standard for:** The event-based pattern is intentional and performance-critical. NEW code should use the `serialize()` pattern consistently rather than having the synchronizer know individual fields.

---

### MINOR: Serializer accessing many domain object internals

**File:** `server/src/networking/Serializer.ts`

The Serializer directly accesses dozens of properties from Audio, Entity, ParticleEmitter, PlayerCamera, World, etc. This is somewhat expected for a serializer, but it creates tight coupling.

**Standard for:** Acceptable for EXISTING code. Each domain object already has a `serialize()` method that delegates to `Serializer` -- this is a reasonable pattern.

---

## 4. Primitive Obsession / Data Clumps

### MAJOR: `RgbColor` used as raw `{ r, g, b }` everywhere

**Files:** Throughout server and client

`RgbColor` is a type alias for `{ r: number, g: number, b: number }` and is compared manually:
```typescript
// Entity.ts:973-978
if ((!emissiveColor && !this._emissiveColor) || (emissiveColor && this._emissiveColor &&
    emissiveColor.r === this._emissiveColor.r &&
    emissiveColor.g === this._emissiveColor.g &&
    emissiveColor.b === this._emissiveColor.b)) {
    return;
}
```

This equality check pattern repeats for `setEmissiveColor` and `setTintColor` in the same file (lines 973-978 and 1273-1277).

**Suggested improvement:** Create an `RgbColor.equals(a, b)` utility or make `RgbColor` a proper value object.

**Standard for:** NEW code must use a comparison utility rather than inline field-by-field comparison.

---

### MAJOR: Coordinate string keys `"x,y,z"` for Map lookups

**Files:** `server/src/networking/NetworkSynchronizer.ts:1329`, `server/src/worlds/World.ts:538-564`

```typescript
// NetworkSynchronizer.ts:1329
const id = `${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z}`;
```

String keys from coordinates are used for map lookups, creating GC pressure from string allocations.

**Suggested improvement:** Use a packed numeric key (e.g., `ChunkLattice` already uses `bigint` packed keys). Apply consistently.

**Standard for:** NEW code should use numeric/packed keys for hot-path map lookups.

---

### MINOR: Vector3Like `{ x, y, z }` inline construction

Inline `{ x: 0, y: 0, z: 0 }` appears dozens of times. This is fine for a data-oriented architecture but watch for excessive object allocation in hot paths.

**Standard for:** Acceptable pattern. The `DefaultPlayerEntityController` already uses reusable vectors (`_reusableImpulse`, `_reusableTargetVelocities`), which is the correct approach for hot paths.

---

## 5. Type Safety Issues

### MAJOR: `type?: any` in WorldMap entity options

**File:** `server/src/worlds/World.ts:51`

```typescript
rigidBodyOptions?: Omit<NonNullable<EntityOptions['rigidBodyOptions']>, 'type'> & { type?: any }
```

An explicit `any` cast to work around JSON map imports where `type` is a string, not a `RigidBodyType` enum. The code even has a comment acknowledging it.

**Suggested improvement:** Create a `WorldMapRigidBodyType` that accepts `string | RigidBodyType` with validation at parse time.

**Standard for:** NEW code must not introduce `any` in public/exported types.

---

### MAJOR: EventRouter method overloads with `any` payload

**File:** `server/src/events/EventRouter.ts:45-46, 72-73, 94-95, 118-119`

```typescript
public emit(eventType: string, payload: any): boolean;
```

All EventRouter methods have a `string, any` overload alongside the typed overload. This allows emitting untyped events that bypass the type system.

**Suggested improvement:** The dual overload pattern is intentional for extensibility, but could be tightened with `unknown` instead of `any` on the fallback overload.

**Standard for:** Acceptable architectural decision. NEW code should prefer the typed overload.

---

### MINOR: `as any` in client code

**File:** `client/src/particles/ParticleEmitterCore.ts:403, 418`

```typescript
(this._options as any)[key] = options[key as keyof ParticleEmitterCoreOptions];
```

**Standard for:** NEW code should use properly typed index access or a mapping approach.

---

### MINOR: Accessing internal Three.js properties

**File:** `client/src/entities/Entity.ts:72-78`

```typescript
interface AnimationActionEx extends AnimationAction {
    _propertyBindings: PropertyMixer[];
}
```

Accessing private/undocumented Three.js internals. The code has a TODO acknowledging the risk.

**Standard for:** Avoid in NEW code. File a Three.js issue or find a public API workaround.

---

## 6. Magic Numbers and Strings

### MAJOR: Animation name strings hardcoded across the codebase

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:199-248`

```typescript
public idleLoopedAnimations: string[] = [ 'idle-upper', 'idle-lower' ];
public runLoopedAnimations: string[] = [ 'run-upper', 'run-lower' ];
public walkLoopedAnimations: string[] = [ 'walk-upper', 'walk-lower' ];
public swimLoopedAnimations: string[] = [ 'swim-forward' ];
public jumpOneshotAnimations: string[] = [ 'jump-loop' ];
```

While these are configurable defaults, the animation name strings are scattered as defaults. If the standard player model changes its animation names, multiple locations must update.

**Standard for:** Acceptable since they are configurable overrides. NEW controllers should follow the same pattern.

---

### MINOR: Physics constants as class statics

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:135-158`

These are well-structured as `private static readonly` constants. Good pattern to follow.

---

### MINOR: Step audio URI hardcoded

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:414-421`

```typescript
this._stepAudio = new Audio({
    uri: 'audio/sfx/step/stone/stone-step-04.mp3',
    ...
});
```

The step audio URI is hardcoded and not configurable via constructor options.

**Standard for:** NEW code should make asset URIs configurable.

---

## 7. DRY Violations

### CRITICAL: Identical setter+emit pattern repeated 70+ times

**Files:** `Entity.ts`, `PlayerCamera.ts`, `ParticleEmitter.ts`, `World.ts`

Every property setter across these files follows the exact same template:
1. Check if value changed
2. Update internal field
3. If spawned/loaded, emit event with `emitWithWorld()`

**ParticleEmitter.ts** is the worst offender with 30+ nearly identical setter methods across 1323 lines.

**Suggested improvement:** A generic `_setProperty(field, eventType, payload)` or decorator-based property change notification.

**Standard for:** NEW code should reduce boilerplate with a helper if adding many property setters.

---

### MAJOR: Server Entity + Client Entity duplication

**Files:** `server/src/worlds/entities/Entity.ts` and `client/src/entities/Entity.ts`

Both define entity concepts with overlapping field names, options, and behaviors. While server and client have different concerns, the data shapes (EntityData, EntityOptions) are nearly identical, leading to drift risk.

**Standard for:** This is a fundamental client-server architecture choice. The `protocol/` layer bridges them. NEW code should ensure protocol schemas remain the single source of truth.

---

### MAJOR: Color comparison logic duplicated

**File:** `server/src/worlds/entities/Entity.ts:973-978` and `Entity.ts:1273-1277`

The exact same RGB color equality check is copied for `setEmissiveColor` and `setTintColor`:
```typescript
if ((!color && !this._color) || (color && this._color &&
    color.r === this._color.r &&
    color.g === this._color.g &&
    color.b === this._color.b)) {
    return;
}
```

**Suggested improvement:** Extract `rgbColorEquals(a, b)` utility.

**Standard for:** NEW code must use a shared utility for value equality checks.

---

## 8. Memory Leak Risks

### MAJOR: Event listeners not cleaned up on some code paths

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:427`

The `entity.on(EntityEvent.BLOCK_COLLISION, ...)` listener is added in `attach()` but there's no corresponding `off()` in `detach()`. The `detach()` method is inherited from `BaseEntityController` and may not clean up the lambda.

**Suggested improvement:** Store the listener reference and remove it in `detach()`.

**Standard for:** Both EXISTING and NEW code. Event listeners must be paired with cleanup.

---

### MAJOR: `Connection._cachedPacketsSerializedBuffer` as static Map

**File:** `server/src/networking/Connection.ts:65`

```typescript
private static _cachedPacketsSerializedBuffer: Map<AnyPacket[], Buffer> = new Map();
```

This uses `AnyPacket[]` (array references) as map keys. Since new arrays are created each tick, old entries should be cleaned up. The code does call `clearCachedPacketsSerializedBuffers()` (line 134-138), but if any code path skips this call, the map grows unboundedly.

**Standard for:** Acceptable since cleanup is called. NEW code using caches must ensure cleanup paths exist.

---

### MINOR: `_animationFadeTimeouts` Map in client Entity

**File:** `client/src/entities/Entity.ts:177`

```typescript
private _animationFadeTimeouts: Map<string, NodeJS.Timeout> = new Map();
```

Timeout handles stored but need verification that all timeouts are cleared when the entity is removed.

**Standard for:** NEW code must clear all timers in disposal/cleanup methods.

---

## 9. Error Handling Issues

### MAJOR: Debug packet handler logs raw packet

**File:** `server/src/players/Player.ts:511`

```typescript
private _onDebugConfigPacket = (packet: protocol.DebugConfigPacket) => {
    console.log(packet);
};
```

A debug handler that just `console.log`s the raw packet with no processing. In production, `console.log` is disabled (ErrorHandler.ts:13), so this is a no-op. But it's dead code that signals an unfinished feature.

**Standard for:** NEW code must not include placeholder handlers. Either implement or remove.

---

### MAJOR: Empty catch blocks in Connection

**File:** `server/src/networking/Connection.ts:274, 490`

```typescript
} catch {
    this._wtBinding = false;
    return;
}
// and
setTimeout(() => { try { wtToClose.close(); } catch { /* NOOP */ } }, 50);
```

Silent error swallowing during WebTransport binding. While some "best effort close" silencing is acceptable, the first catch discards all binding errors silently.

**Standard for:** NEW code must at minimum log errors to ErrorHandler, even in catch blocks.

---

### MINOR: `ErrorHandler.fatalError` used for validation in Serializer

**File:** `server/src/networking/Serializer.ts:49-51, 133, 224, 376`

```typescript
if (audio.id === undefined) {
    ErrorHandler.fatalError(`Serializer.serializeAudio(): Audio ${audio.uri} is not playing!`);
}
```

Using `fatalError` (which calls `process.exit`) for what should be defensive validation. If an audio object somehow reaches the serializer without an ID, the entire server crashes.

**Suggested improvement:** Use `ErrorHandler.error()` for recoverable validation failures and skip the serialization.

**Standard for:** NEW code should use `fatalError` only for truly unrecoverable states (corrupted memory, impossible invariant violations).

---

## 10. Console / Debug Leftovers

### MINOR: `console.log` in Player debug handler

**File:** `server/src/players/Player.ts:511`

```typescript
console.log(packet);
```

**Standard for:** NEW code must not use `console.log` for production code. Use `console.info` or `ErrorHandler`.

---

### MINOR: `console.log` in AssetsLibrary

**File:** `server/src/assets/AssetsLibrary.ts:98, 102`

```typescript
console.log(`AssetsLibrary.syncAsset(): Copied model from asset library...`);
```

Development-only logging that persists. Acceptable since it's gated by sync operations.

**Standard for:** NEW code should use `console.info` instead of `console.log` (since log is disabled in production).

---

### MINOR: PathfindingEntityController debug logging

**File:** `server/src/worlds/entities/controllers/PathfindingEntityController.ts:432`

```typescript
console.log(`PathfindingEntityController._calculatePath: Path found after ${openSetIterations}...`);
```

Debug-level logging left in production code.

**Standard for:** NEW code should use a debug flag or remove before merging.

---

## 11. Dead Code / TODOs

### MAJOR: 60+ TODOs across the client codebase

**Files:** Primarily `client/src/entities/Entity.ts`, `client/src/gltf/GLTFManager.ts`, `client/src/particles/`, `client/src/workers/`

The client has a very high density of `TODO` comments indicating known issues:
- `client/src/entities/Entity.ts`: 16 TODOs (error handling, optimization, design concerns)
- `client/src/gltf/GLTFManager.ts`: 14 TODOs (error handling, naming, design)
- `client/src/particles/`: 7 TODOs
- `client/src/workers/`: 6 TODOs
- `client/src/textures/`: 4 TODOs (error handling)

Many of these are about **missing error handling** (e.g., "TODO: Better error handling?", "TODO: Proper error handling").

**Standard for:** NEW code must not have TODOs for error handling. Handle errors before merging.

---

### MINOR: Two TODOs in server code

**Files:** `server/src/players/Player.ts:488`, `server/src/worlds/physics/Simulation.ts:138`

Only 2 TODOs in the entire server codebase -- significantly cleaner than the client side.

**Standard for:** Server code sets a good standard. NEW code should aim for zero TODOs at merge time.

---

## 12. Coupling Issues

### MAJOR: NetworkSynchronizer imports 15+ domain classes

**File:** `server/src/networking/NetworkSynchronizer.ts:1-30`

The synchronizer imports types and event enums from every major domain: Audio, BlockType, ChatManager, ChunkLattice, Entity, EntityModelAnimation, EntityModelNodeOverride, ParticleEmitter, Player, PlayerCamera, PlayerUI, SceneUI, Simulation, World.

This creates a "hub" that must change whenever any domain object changes.

**Standard for:** Inevitable for a synchronizer. NEW domain objects should follow the existing pattern but consider plugin-style registration.

---

### MAJOR: Monkey-patching in DefaultPlayerEntityController

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:405-412`

```typescript
this._internalApplyImpulse = entity.applyImpulse.bind(entity);
entity.applyImpulse = (impulse: Vector3Like) => {
    const mass = entity.mass || 1;
    this._externalVelocity.x += impulse.x / mass;
    // ...
};
```

The controller replaces `entity.applyImpulse` with a wrapped version. This is fragile:
- Other code calling `applyImpulse` gets the wrapped version silently
- Multiple controllers on the same entity would chain unpredictably
- No cleanup in `detach()`

**Suggested improvement:** Use a composition pattern (e.g., `entity.addImpulseInterceptor()`) instead of monkey-patching.

**Standard for:** NEW code must never monkey-patch methods on other objects.

---

## 13. Mutable State Issues

### MAJOR: Public mutable arrays for animation names

**File:** `server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:199-248`

```typescript
public idleLoopedAnimations: string[] = [ 'idle-upper', 'idle-lower' ];
public runLoopedAnimations: string[] = [ 'run-upper', 'run-lower' ];
```

All animation name arrays are `public` and mutable. External code can push to, splice from, or replace these arrays at any time, potentially causing subtle bugs.

**Suggested improvement:** Make these `readonly` or provide setter methods.

**Standard for:** NEW code should use `readonly` arrays for configuration data.

---

### MINOR: `_input` mutated via `Object.assign`

**File:** `server/src/players/Player.ts:527`

```typescript
Object.assign(this._input, input);
```

Merges untrusted client input directly into the input object. No validation or sanitization of the incoming input packet.

**Standard for:** NEW code should validate input before assignment.

---

## 14. Inconsistencies

### MAJOR: `isSpawned` uses `!!this._world` but still requires `!` assertions

**File:** `server/src/worlds/entities/Entity.ts:733`

```typescript
public get isSpawned(): boolean { return !!this._world; }
// But then everywhere:
this._world!.entityManager...
this.emitWithWorld(this._world!, ...);
```

The code even has a comment: `// this should prob be changed to type predicate so we don't have to assert (!) in areas.`

Using `isSpawned` as a guard doesn't narrow the type of `_world`. Every subsequent access requires `!`.

**Suggested improvement:** Make `isSpawned` a type predicate: `public get isSpawned(): this is Entity & { _world: World }` (would require refactoring private field access), or use a `_requireSpawned()` pattern that returns the world.

**Standard for:** NEW code should use type predicates or assertion functions instead of `!` assertions after guards.

---

### MINOR: Inconsistent event emission patterns

Server `Entity` uses `emitWithWorld(this._world!, ...)` for most events but `emit(...)` for `TICK`.
`World` uses `emit(...)` directly. `Player` uses `emitWithWorld(...)`.
`GameServer` uses `EventRouter.globalInstance.emit(...)`.

The scoping is intentional (local vs world vs global), but the lack of documentation about when to use which pattern creates confusion.

**Standard for:** NEW code must document which scope is intended. Use `emitWithWorld` for events that the world's NetworkSynchronizer needs to observe.

---

### MINOR: Naming inconsistency for packed data keys

Protocol schemas use cryptic single-letter keys (`i`, `m`, `p`, `e`, `n`, `r`, etc.) across all schemas. This is intentional for bandwidth optimization but creates readability challenges when debugging.

**Standard for:** Acceptable. NEW protocol fields should follow the existing abbreviated key convention.

---

## 15. Promise Anti-patterns

### MINOR: `.catch(() => {})` silencing in Connection

**File:** `server/src/networking/Connection.ts:250`

```typescript
wt.closed.catch(() => { /* NOOP */}).finally(() => wt.userData.onclose?.());
```

Silently catches all WebTransport close errors.

**Standard for:** Acceptable for transport close cleanup. NEW code should log at debug level.

---

### MINOR: `startServer` chaining without structured error handling

**File:** `server/src/GameServer.ts:67-89`

```typescript
RAPIER.init().then(() => {
    return GameServer.instance.blockTextureRegistry.preloadAtlas();
}).then(() => {
    return GameServer.instance.modelRegistry.preloadModels();
}).then(() => { ... }).catch(error => {
    ErrorHandler.fatalError(...);
});
```

The `.then()` chain is acceptable but modern `async/await` would be clearer and allow per-step error handling.

**Standard for:** NEW code should prefer `async/await` over `.then()` chains.

---

## Summary by Severity

### Critical (4 findings)
| # | Finding | Location | Action |
|---|---------|----------|--------|
| 1 | God Class: NetworkSynchronizer (1561 lines, 60+ handlers) | `server/src/networking/NetworkSynchronizer.ts` | Refactor to domain-specific sync handlers |
| 2 | God Class: Client Entity (2900 lines) | `client/src/entities/Entity.ts` | Extract animation, material, culling managers |
| 3 | 60+ identical event handler methods | `NetworkSynchronizer.ts:400-977` | Replace with data-driven mapping table |
| 4 | 70+ identical setter+emit patterns | Entity, PlayerCamera, ParticleEmitter | Create generic setter helper |

### Major (18 findings)
| # | Finding | Location |
|---|---------|----------|
| 1 | RigidBody (1760 lines) / Collider (1750 lines) | `server/src/worlds/physics/` |
| 2 | GLTFManager (1812 lines) | `client/src/gltf/GLTFManager.ts` |
| 3 | DefaultPlayerEntityController.tickWithPlayerInput (225 lines) | Server controllers |
| 4 | Animation management code duplicated 3x | DefaultPlayerEntityController |
| 5 | `type?: any` in WorldMap | `server/src/worlds/World.ts:51` |
| 6 | EventRouter `any` payload overloads | `server/src/events/EventRouter.ts` |
| 7 | Inline RgbColor equality checks duplicated | `Entity.ts:973, 1273` |
| 8 | String coordinate keys for map lookups | NetworkSynchronizer, World |
| 9 | Server/Client Entity data shape duplication | Cross-package |
| 10 | Event listeners not cleaned up in DefaultPlayerEntityController | `attach()` without matching `detach()` cleanup |
| 11 | Debug packet handler is dead code | `Player.ts:511` |
| 12 | Empty catch blocks in Connection | `Connection.ts:274, 490` |
| 13 | `fatalError` used for validation in Serializer | `Serializer.ts` |
| 14 | 60+ TODOs about missing error handling (client) | `client/src/` |
| 15 | NetworkSynchronizer coupled to 15+ domain classes | Imports |
| 16 | Monkey-patching `applyImpulse` | DefaultPlayerEntityController |
| 17 | Public mutable animation arrays | DefaultPlayerEntityController |
| 18 | `isSpawned` doesn't narrow types, causes `!` assertions | `Entity.ts:733` |

### Minor (14 findings)
| # | Finding | Location |
|---|---------|----------|
| 1 | `as any` in client code | ParticleEmitterCore, ChunkWorker |
| 2 | Accessing private Three.js internals | Client Entity |
| 3 | Hardcoded step audio URI | DefaultPlayerEntityController |
| 4 | `_animationFadeTimeouts` cleanup | Client Entity |
| 5 | `console.log` in Player debug handler | Player.ts:511 |
| 6 | `console.log` in AssetsLibrary | AssetsLibrary.ts |
| 7 | PathfindingEntityController debug logging | PathfindingEntityController |
| 8 | 2 TODOs in server code | Player.ts, Simulation.ts |
| 9 | `Object.assign` for input without validation | Player.ts:527 |
| 10 | Inconsistent event emission scope patterns | Multiple files |
| 11 | Cryptic single-letter protocol keys | Protocol schemas |
| 12 | `.catch(() => {})` silencing | Connection.ts |
| 13 | `.then()` chain instead of async/await | GameServer.ts |
| 14 | Inline vector `{ x: 0, y: 0, z: 0 }` construction | Multiple files |

---

## Standards for New Code (Summary)

1. **No file over 800 lines.** If a class exceeds this, split responsibilities.
2. **No method over 40 lines.** Decompose into well-named private helpers.
3. **No `any` in exported types.** Use `unknown` if truly needed; prefer proper types.
4. **No monkey-patching.** Use composition, interceptors, or event hooks.
5. **No inline value equality checks.** Create and use utility functions.
6. **No data-driven boilerplate.** If 5+ methods follow the same pattern, use a mapping table.
7. **No TODO for error handling.** Handle errors before merging.
8. **No `console.log` in production.** Use `console.info` or `ErrorHandler`.
9. **Pair every event listener with cleanup.** Store references; remove in `detach()`/`dispose()`.
10. **Use type predicates or assertion functions** instead of `!` after boolean guards.
11. **Use `async/await`** instead of `.then()` chains.
12. **Make configuration arrays `readonly`.**
13. **Validate external input** before merging into internal state.
14. **Use `fatalError` only for unrecoverable invariant violations**, not for validation.
