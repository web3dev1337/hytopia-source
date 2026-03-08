# Hytopia Server Architecture Analysis

## 1. Entry Point & Boot Sequence

### Entry: `server/src/index.ts`
The barrel export file re-exports every public class, enum, type, and constant from the server SDK. Uses path aliases (`@/...`) throughout. Every class uses `export default` with named re-exports in the barrel.

### Boot: `server/src/GameServer.ts:66`
`startServer(init)` is the user-facing entry point. Boot sequence:
1. `RAPIER.init()` - Physics engine initialization (async)
2. `GameServer.instance.blockTextureRegistry.preloadAtlas()` - Texture preload
3. `GameServer.instance.modelRegistry.preloadModels()` - Model preload
4. User `init(world?)` callback - If callback declares a parameter (`init.length > 0`), a default world is lazily created via `WorldManager.getDefaultWorld()`
5. `GameServer.instance.start()` - Emits `GameServerEvent.START`, starts `WebServer`, enables crash protection

**Pattern**: Promise chain (not async/await) with `.catch()` calling `ErrorHandler.fatalError()`.

---

## 2. Design Patterns

### 2.1 Singleton Pattern
The **dominant pattern** throughout the codebase. Two variants are used:

**Variant A - Lazy Singleton (private constructor + getter)**
- `GameServer` (`GameServer.ts:104-146`): `private constructor()`, `static get instance()` with lazy init

**Variant B - Eager Singleton (public static readonly)**
- `EventRouter.globalInstance` (`EventRouter.ts:26`)
- `PlatformGateway.instance` (`PlatformGateway.ts:98`)
- `PersistenceManager.instance` (`PersistenceManager.ts:28`)
- `PlayerManager.instance` (`PlayerManager.ts:75`)
- `WorldManager.instance` (`WorldManager.ts:63`)
- `Socket.instance` (`Socket.ts:48`)
- `WebServer.instance` (`WebServer.ts:118`)
- `BlockTextureRegistry.instance` (referenced in `GameServer.ts:109`)
- `ModelRegistry.instance` (referenced in `GameServer.ts:112`)
- `AssetsLibrary.instance` (`AssetsLibrary.ts:37`)

**Observation**: Variant B (`public static readonly instance = new ClassName()`) is overwhelmingly preferred. The `GameServer` is the only lazy singleton, presumably because it wraps the other singletons and must control instantiation order.

### 2.2 Manager Pattern
Heavy use of "Manager" classes that own collections of domain objects:

| Manager | Manages | Location |
|---------|---------|----------|
| `PlayerManager` | All connected `Player` instances | `players/PlayerManager.ts` |
| `WorldManager` | All `World` instances | `worlds/WorldManager.ts` |
| `EntityManager` | All `Entity` instances in a world | `worlds/entities/EntityManager.ts` |
| `AudioManager` | Audio instances in a world | `worlds/audios/AudioManager.ts` |
| `ChatManager` | Chat messages/commands in a world | `worlds/chat/ChatManager.ts` |
| `ParticleEmitterManager` | Particle emitters in a world | `worlds/particles/ParticleEmitterManager.ts` |
| `SceneUIManager` | Scene UI elements in a world | `worlds/ui/SceneUIManager.ts` |

**Pattern**: Managers are either global singletons (`PlayerManager`, `WorldManager`) or per-world instances created in `World`'s constructor.

### 2.3 Registry Pattern
Used for type/definition registration:

- `BlockTypeRegistry` (`worlds/blocks/BlockTypeRegistry.ts`) - Block type definitions
- `BlockTextureRegistry` (`textures/BlockTextureRegistry.ts`) - Texture atlas management
- `ModelRegistry` (`models/ModelRegistry.ts`) - Model preloading and data extraction

### 2.4 Observer/Event Pattern
The codebase's most pervasive architectural pattern. `EventRouter` is the central event infrastructure class.

**EventRouter** (`events/EventRouter.ts`):
- Wraps `eventemitter3`
- Provides typed events via `EventPayloads` interface
- Three emission scopes: `emit()` (local), `emitWithGlobal()` (local + global singleton), `emitWithWorld()` (local + world)
- Special `final()` listeners: one-per-event terminal listener invoked after all normal listeners
- Used by `NetworkSynchronizer` to install terminal listeners on the world's event router that queue network sync deltas

**Event Type Definition Convention**:
Every event-emitting class follows this pattern:
```typescript
export enum SomeEvent {
  EVENT_NAME = 'NAMESPACE.EVENT_NAME',
}

export interface SomeEventPayloads {
  [SomeEvent.EVENT_NAME]: { /* payload type */ }
}
```

**EventPayloads Union** (`events/Events.ts`):
All event payload interfaces are merged into a single `EventPayloads` interface via interface extension. This provides compile-time type safety for all event emissions.

### 2.5 Controller Pattern (Strategy)
Entity behavior is controlled via the Strategy pattern through `BaseEntityController`:

- `BaseEntityController` (`worlds/entities/controllers/BaseEntityController.ts:76`) - Abstract base
- `DefaultPlayerEntityController` - Default player movement/physics
- `SimpleEntityController` - Basic movement API
- `PathfindingEntityController` - A* pathfinding

**Lifecycle**: `attach()` -> `spawn()` -> `tickWithPlayerInput()` -> `tick()` -> `detach()` -> `despawn()`

Controllers are EventRouters themselves, allowing external code to hook into controller events (e.g., `TICK_WITH_PLAYER_INPUT`).

### 2.6 Composition Over Inheritance
`World` is the prime example of composition (`World.ts:299-330`):
```
World composes:
  AudioManager
  BlockTypeRegistry
  ChatManager
  ChunkLattice
  EntityManager
  WorldLoop
  NetworkSynchronizer
  ParticleEmitterManager
  SceneUIManager
  Simulation
```

Each sub-system is injected the `World` reference during construction, creating a bidirectional dependency. The `World` exposes them via read-only getters.

### 2.7 Serializable Pattern
Domain objects implement `protocol.Serializable` interface:
- `Player.serialize()` -> delegates to `Serializer.serializePlayer(this)`
- `PlayerCamera.serialize()` -> delegates to `Serializer.serializePlayerCamera(this)`
- `World.serialize()` -> delegates to `Serializer.serializeWorld(this)`
- `Entity.serialize()` -> delegates to `Serializer.serializeEntity(this)`

The `Serializer` class (`networking/Serializer.ts`) is a static-only utility class that transforms domain objects into protocol schema objects. This separates serialization concerns from domain logic.

### 2.8 Fixed Timestep Game Loop
`Ticker` (`shared/classes/Ticker.ts`) implements a fixed-timestep loop:
- Accumulates elapsed time
- Processes up to `TICK_SLOW_UPDATE_CAP` (2) updates per frame when behind
- Caps accumulator at `MAX_ACCUMULATOR_TICK_MULTIPLE` (3x) the timestep to prevent spiral of death
- Uses `setTimeout` (not `setImmediate`) to allow GC breathing room

`WorldLoop` (`worlds/WorldLoop.ts:149-195`) orchestrates per-tick:
1. Tick entities (via `EntityManager.tickEntities()`)
2. Step physics (via `Simulation.step()`)
3. Check and emit entity position/rotation updates (via `EntityManager.checkAndEmitUpdates()`)
4. Network synchronize at reduced rate (via `NetworkSynchronizer.synchronize()`)

---

## 3. Event System Deep Dive

### `EventRouter` (`events/EventRouter.ts`)

**Architecture**:
- Wraps `eventemitter3` (not Node.js `EventEmitter`)
- Private `_emitter` and `_finalListeners` record
- Method overloading with typed + untyped signatures for all methods (`on`, `off`, `emit`, etc.)

**Key methods**:
- `emit(eventType, payload)` - Local emission, catches errors
- `emitWithGlobal(eventType, payload)` - Emits locally + to `EventRouter.globalInstance`
- `emitWithWorld(world, eventType, payload)` - Emits locally + to the world's EventRouter
- `final(eventType, listener)` - Single terminal listener per event type (used by `NetworkSynchronizer`)
- `on()`, `once()`, `off()`, `offAll()` - Standard listener management

**Event naming convention**: `NAMESPACE.ACTION` (e.g., `ENTITY.SPAWN`, `PLAYER.JOINED_WORLD`, `CONNECTION.OPENED`)

**Typed events** (`events/Events.ts:30-53`): The `EventPayloads` interface extends all 22 subsystem-specific event payload interfaces, providing a unified type map.

### Event Flow Example: Entity Spawn
1. `Entity.spawn()` calls `this.emitWithWorld(world, EntityEvent.SPAWN, { entity: this })`
2. This emits to the entity's own listeners AND the world's event router
3. `NetworkSynchronizer` has a `final` listener on the world for `EntityEvent.SPAWN`
4. The `final` listener queues the entity serialization for the next network sync
5. On next sync tick, the queued data is sent as a packet to all connected players

---

## 4. Networking Architecture

### Transport Layer
The server supports **dual transport**: WebSocket (ws) and WebTransport (HTTP/3).

**Socket** (`networking/Socket.ts`):
- Manages connection lifecycle (auth, binding, reconnection)
- Tracks connections by `connectionId` (UUID) and `userId`
- Handles duplicate connection detection and killing
- Extends `EventRouter`

**Connection** (`networking/Connection.ts:64`):
- Extends `EventRouter` (inherits event emission)
- Supports WebSocket (`_ws`) and WebTransport (`_wt`) simultaneously
- Reconnect window: 30 seconds (`RECONNECT_WINDOW_MS`)
- Packet caching: `_cachedPacketsSerializedBuffer` (static Map) caches serialized packets by array identity to avoid re-encoding for multiple players
- Compression: gzip for packets > 64KB (mainly chunks)
- WebTransport uses reliable (bidirectional streams) and unreliable (datagrams, < 1200 bytes) channels
- Packet framing for WebTransport reliable streams (WT doesn't frame like WS does)
- Uses msgpackr for serialization

**WebServer** (`networking/WebServer.ts:112`):
- HTTP/2 secure server (TLS required)
- Serves static assets from `assets/` directory
- ETag caching for asset responses
- Health check endpoint at `/`
- Emits `UPGRADE` events for WebSocket handshakes
- Path traversal protection (`..` check + `startsWith` validation)
- CORS headers on all responses
- Global HTTP dispatcher configured via `undici` for connection pooling

### Network Synchronization
**NetworkSynchronizer** (`networking/NetworkSynchronizer.ts`):
- Runs at 30Hz (half the default 60Hz tick rate)
- Maintains **sync queues** for each data type (entities, blocks, chunks, audio, etc.)
- Two queue types:
  - `SyncQueue<TId, TSchema>` - Keyed by ID, with broadcast and per-player maps
  - `SingletonSyncQueue<TSchema>` - Single value (camera, UI, world state)
- Subscribes to world events via `final()` listeners
- On sync tick, collects all queued deltas into packets
- Entity position/rotation updates go over **unreliable** channel (UDP datagrams)
- All other updates go over **reliable** channel
- Clears all queues after sending (with guarded `.size > 0` checks to avoid unnecessary GC)

**Serializer** (`networking/Serializer.ts`):
- Static-only class (no instances)
- Transforms domain objects -> protocol schema objects
- Short property names for wire efficiency (e.g., `i` for id, `p` for position, `r` for rotation)
- Vectors serialized as `[x, y, z]` tuples, quaternions as `[x, y, z, w]`

### Protocol
Uses `@hytopia.com/server-protocol` package for:
- Packet definitions and validation (`protocol.isValidPacket()`)
- Schema types (`protocol.EntitySchema`, `protocol.WorldSchema`, etc.)
- Packet creation (`protocol.createPacket()`)
- Packet IDs (`protocol.PacketId.INPUT`, etc.)
- Buffer framing/unframing for WebTransport

### Platform Integration
**PlatformGateway** (`networking/PlatformGateway.ts:97`):
- Singleton with private constructor
- Integrates with Hytopia platform services
- Session validation, cosmetics (via GraphQL), KV persistence, notifications
- Falls back to local filesystem persistence in development
- GraphQL client for player cosmetics (`graphql-ws`)
- REST API for notifications

---

## 5. Entity/World System

### World Lifecycle
1. `WorldManager.createWorld(options)` creates a `World` instance with auto-incrementing ID
2. `World` constructor initializes all sub-managers (composition)
3. `world.start()` starts the `WorldLoop` ticker
4. Each tick: entities tick -> physics step -> emit updates -> network sync
5. `world.stop()` stops the ticker

### World (`worlds/World.ts:217`)
- Extends `EventRouter`, implements `protocol.Serializable`
- Contains environment properties (lighting, fog, skybox)
- `loadMap(map)` processes `WorldMap` data: registers block types, creates chunks, spawns environmental entities

### Entity System
**Entity** (`worlds/entities/Entity.ts`):
- Union type options: `BlockEntityOptions | ModelEntityOptions`
- Has RigidBody (physics), Colliders, model animations, model node overrides
- `spawn(world, position)` / `despawn()`
- `isEnvironmental` flag: environmental entities skip tick/position updates
- Position/rotation change detection with thresholds (`ENTITY_POSITION_UPDATE_THRESHOLD_SQ`, `ENTITY_ROTATION_UPDATE_THRESHOLD`)

**EntityManager** (`worlds/entities/EntityManager.ts`):
- Separate `_activeEntities` (Set) for non-environmental entities (performance optimization)
- Auto-incrementing entity IDs per world
- Querying: `getAllEntities()`, `getAllPlayerEntities()`, `getPlayerEntitiesByPlayer()`, `getEntitiesByTag()`, `getEntityChildren()`

**PlayerEntity** (`worlds/entities/PlayerEntity.ts`):
- Extends `Entity` with player-specific behavior
- Links to a `Player` instance
- Player input processing in tick

**DefaultPlayerEntity** (`worlds/entities/DefaultPlayerEntity.ts`):
- Extends `PlayerEntity` with cosmetic slots and default configuration

### Block System
- `ChunkLattice` - Spatial grid of `Chunk` instances using packed bigint keys
- `Chunk` - 16x16x16 block array with rotations
- `Block` - Individual block with rotation support (24 rotation variants)
- `BlockType` - Block type definition with collider options and texture
- `BlockTypeRegistry` - Per-world registry of block types

### Physics Integration
**Simulation** (`worlds/physics/Simulation.ts`):
- Wraps RAPIER physics engine
- Default gravity: `{ x: 0, y: -32, z: 0 }` (Minecraft-like)
- Default tick rate: 60Hz
- Raycasting, intersection queries
- Collision event dispatch (entity-entity, entity-block)
- Debug rendering support
- `ColliderMap` for mapping RAPIER collider handles to game objects
- `CollisionGroupsBuilder` for configuring collision filtering

**RigidBody** (`worlds/physics/RigidBody.ts`):
- Wrapper around RAPIER rigid bodies
- Types: Dynamic, Fixed, KinematicPosition, KinematicVelocity

---

## 6. Player System

### Player Lifecycle
1. `Connection` opens -> `PlayerManager._onConnectionOpened()` creates `Player`
2. Player persistence data loaded
3. `worldSelectionHandler?.(player)` called for custom routing
4. `player.joinWorld(world)` -> emits `PlayerEvent.JOINED_WORLD`
5. On disconnect: 30s reconnect window -> `PlayerEvent.LEFT_WORLD` on close
6. On reconnect within window: `PlayerEvent.RECONNECTED_WORLD`

### Player (`players/Player.ts:108`)
- Extends `EventRouter`, implements `protocol.Serializable`
- Owns: `PlayerCamera`, `PlayerUI`, `Connection` reference
- Input: received via `InputPacket`, stored as `PlayerInput` object
- Sequence number tracking for unreliable UDP input packets
- Interact system: client sends ray origin/direction, server performs raycast
- Persistence: `getPersistedData()`, `setPersistedData()`
- Notifications: `scheduleNotification()`, `unscheduleNotification()`

### PlayerCamera (`players/PlayerCamera.ts:156`)
- Extends `EventRouter`, implements `protocol.Serializable`
- Modes: FIRST_PERSON, THIRD_PERSON, SPECTATOR
- Can attach to entity or position
- Target entity/position for continuous look-at
- View model support (first-person arms/weapons)
- Orientation (pitch/yaw) set from client input
- `facingDirection` and `facingQuaternion` computed properties

### PlayerUI (`players/PlayerUI.ts:64`)
- Extends `EventRouter`
- `load(htmlUri)` - Replace UI
- `append(htmlUri)` - Append to existing UI
- `sendData(data)` - Push data to client UI
- `lockPointer()` / `freezePointerLock()` - Pointer lock control
- Bidirectional data: server sends via `sendData`, client sends via `UI_DATA_SEND` packet

### PlayerManager (`players/PlayerManager.ts:69`)
- Global singleton
- Listens to global `ConnectionEvent` events
- `worldSelectionHandler` callback for custom world routing
- Tracks players by `Connection` reference

---

## 7. Module Organization & Dependency Graph

```
GameServer (root singleton)
  |-- BlockTextureRegistry (singleton)
  |-- ModelRegistry (singleton)
  |-- PlayerManager (singleton)
  |     |-- Player (per-connection)
  |     |     |-- PlayerCamera
  |     |     |-- PlayerUI
  |     |     |-- Connection (transport)
  |     |-- PersistenceManager (singleton)
  |
  |-- WorldManager (singleton)
  |     |-- World (per-instance)
  |           |-- AudioManager
  |           |-- BlockTypeRegistry
  |           |-- ChatManager
  |           |-- ChunkLattice -> Chunk[]
  |           |-- EntityManager -> Entity[]
  |           |-- NetworkSynchronizer
  |           |-- ParticleEmitterManager
  |           |-- SceneUIManager
  |           |-- Simulation (RAPIER)
  |           |-- WorldLoop -> Ticker
  |
  |-- Socket (singleton)
  |     |-- Connection[] (WebSocket/WebTransport)
  |
  |-- WebServer (singleton)

Cross-cutting:
  EventRouter (event bus, used by almost every class)
  ErrorHandler (static utility)
  Telemetry/Sentry (static utility)
  Serializer (static utility)
  PlatformGateway (singleton)
```

### Directory Structure
```
server/src/
  GameServer.ts          # Root singleton + startServer()
  index.ts               # Barrel exports
  playground.ts          # Local dev test server
  assets/                # AssetsLibrary
  errors/                # ErrorHandler
  events/                # EventRouter, Events (type union)
  metrics/               # Telemetry (Sentry integration)
  models/                # ModelRegistry (glTF processing)
  networking/            # Connection, Socket, WebServer, NetworkSynchronizer, Serializer, PlatformGateway
    ssl/                 # Embedded SSL certificates
  persistence/           # PersistenceManager
  players/               # Player, PlayerCamera, PlayerManager, PlayerUI
  shared/
    classes/             # Ajv, IterationMap, Matrix2/3/4, Quaternion, Ticker, Vector2/3
    helpers/             # msgpackr configuration
    types/               # Outline, RgbColor, math types (Vector2Like, Vector3Like, QuaternionLike, etc.)
  textures/              # BlockTextureRegistry
  worlds/
    World.ts             # World container
    WorldLoop.ts         # Tick loop
    WorldManager.ts      # World factory/registry
    audios/              # Audio, AudioManager
    blocks/              # Block, BlockType, BlockTypeRegistry, Chunk, ChunkLattice
    chat/                # ChatManager
    entities/            # Entity, EntityManager, PlayerEntity, DefaultPlayerEntity, EntityModelAnimation, EntityModelNodeOverride
      controllers/       # BaseEntityController, DefaultPlayerEntityController, SimpleEntityController, PathfindingEntityController
    particles/           # ParticleEmitter, ParticleEmitterManager
    physics/             # Simulation, RigidBody, Collider, ColliderMap, CollisionGroupsBuilder
    ui/                  # SceneUI, SceneUIManager
```

---

## 8. Error Handling

### ErrorHandler (`errors/ErrorHandler.ts`)
Three severity levels:
1. `warning(message)` - Logs warning, no throw
2. `error(message)` - Logs error, no throw (returns `void`, causing `undefined` returns)
3. `fatalError(message)` - Logs error, **throws** (`never` return type)

**Pattern**: `ErrorHandler.error()` returns `void`, so callers that `return ErrorHandler.error(...)` get an implicit `undefined` return. This is intentional for methods that return `void | T`.

**Production crash protection** (`ErrorHandler.enableCrashProtection()` at `ErrorHandler.ts:108`):
- `unhandledRejection` -> logs error
- `uncaughtException` -> logs error, exits after 1s delay
- `console.log` disabled in production (replaced with no-op)

**Formatting**: Color-coded console output with timestamps, stack traces, and error counts.

### Error propagation patterns:
- **Guard clauses**: Early returns with `ErrorHandler.error()` or `ErrorHandler.warning()` (e.g., `PlayerCamera._requirePlayerWorld()`)
- **Fatal assertions**: `ErrorHandler.fatalError()` for impossible states (e.g., serializing unspawned entities)
- **Try/catch in event emission**: `EventRouter.emit()` wraps listener invocation in try/catch
- **Connection errors**: Caught and logged, connection continues operating

---

## 9. Type Safety

### Typed Events
All events use mapped types via `EventPayloads` interface. Method overloading on `EventRouter` provides type inference:
```typescript
// Typed overload
public emit<TEventType extends keyof EventPayloads>(eventType: TEventType, payload: EventPayloads[TEventType]): boolean;
// Fallback for dynamic event types
public emit(eventType: string, payload: any): boolean;
```

### Type-Like Interfaces
Math types use "Like" suffix interfaces (`Vector3Like`, `QuaternionLike`, `SpdMatrix3`) as structural contracts, allowing plain objects to be used interchangeably with class instances.

### Enum Usage
All event types and state enums use TypeScript `enum`:
- `GameServerEvent`, `ConnectionEvent`, `PlayerEvent`, `EntityEvent`, `WorldEvent`, etc.
- `PlayerCameraMode`, `RigidBodyType`, `ColliderShape`, `EntityModelAnimationBlendMode`, etc.

### Generics
- `IterationMap<K, V>` - Generic key-value container
- `EventRouter.emit<TEventType extends keyof EventPayloads>()` - Event type constraints
- `EntityManager.getEntity<T extends Entity>(id)` - Generic entity type narrowing
- `SyncQueue<TId, TSchema>` and `SingletonSyncQueue<TSchema>` - Network sync queue types
- `Connection.onPacket<T extends AnyPacket>()` - Typed packet handlers

---

## 10. Async Patterns

### Promise-based initialization
`startServer()` uses a `.then()` chain (not async/await) for the boot sequence. This is likely historical.

### Async/await usage
- `PlatformGateway` methods: `getPlayerCosmetics()`, `getPlayerSession()`, `getGlobalData()`, etc.
- `PersistenceManager` methods: `getPlayerData()`, `setGlobalData()`
- `PlayerManager._onConnectionOpened()`: async for loading persistence data
- `Connection.bindWt()`: async for WebTransport stream setup

### Error handling in async
- `void this._someAsyncMethod()` pattern used to fire-and-forget without unhandled rejection
- `.catch()` on promises that might fail silently
- `Promise.resolve(initResult)` to normalize sync/async init callbacks

### No async in hot paths
The tick loop (`WorldLoop._tick`) is entirely synchronous. All async operations (persistence, platform calls) happen outside the tick cycle.

---

## 11. Performance Optimizations

### IterationMap (`shared/classes/IterationMap.ts`)
Custom data structure maintaining both a Map (O(1) lookup) and Array (fast iteration). Uses lazy synchronization (`_isDirty` flag) to avoid rebuilding the array on every mutation.

### Network Sync Optimizations
- **Packet caching** (`Connection._cachedPacketsSerializedBuffer`): Serialized packets are cached by array identity so the same packet isn't re-encoded per player
- **Conditional queue clearing**: Only clears queues if `size > 0` to avoid unnecessary GC
- **Unreliable channel for position/rotation**: Entity spatial updates sent via UDP datagrams
- **Sync rate reduction**: Network sync at 30Hz while physics runs at 60Hz
- **Compression threshold**: gzip only for packets > 64KB

### Entity Update Thresholds
Position and rotation changes below thresholds are not emitted:
- Position: `0.04^2` squared distance (1/25 of a block)
- Rotation: `cos(0.052/2)` (~3 degrees)

### Environmental Entity Optimization
`isEnvironmental` entities are excluded from the active tick set entirely, reducing per-tick overhead for static world objects.

---

## 12. Key Architectural Decisions

1. **EventRouter as base class**: Nearly every domain class extends `EventRouter`, providing ubiquitous event emission. `Connection`, `Socket`, `WebServer`, `Player`, `PlayerCamera`, `PlayerUI`, `World`, `WorldLoop`, `ChunkLattice`, `BaseEntityController`, `Simulation` all extend it.

2. **World-scoped events**: Events can be emitted to a specific world's event router, allowing per-world event isolation. The `NetworkSynchronizer` uses `final()` listeners on the world to intercept state changes.

3. **Singleton-heavy architecture**: All global services are singletons. This simplifies access patterns but creates tight coupling.

4. **Protocol separation**: Wire format is handled by `@hytopia.com/server-protocol` package. The server uses `Serializer` as a translation layer between domain objects and protocol schemas.

5. **Dual transport**: Both WebSocket and WebTransport are supported simultaneously per connection, with transparent fallback and reconnection across transports.

6. **Fixed timestep with network decimation**: Physics at 60Hz, network at 30Hz, with unreliable UDP for high-frequency spatial updates.

7. **Composition for World**: Instead of inheritance, World composes 10+ sub-systems, each receiving the World reference. This keeps each system focused but creates circular references.

8. **Abstract controller pattern**: Entity behavior is decoupled via the Strategy pattern through `BaseEntityController`, enabling custom controllers without modifying entity code.

---

## 13. Summary of Patterns by Category

| Category | Patterns |
|----------|----------|
| Creational | Singleton (eager + lazy), Factory (WorldManager.createWorld) |
| Structural | Composition (World), Facade (GameServer), Adapter (Connection wraps WS/WT) |
| Behavioral | Observer (EventRouter), Strategy (BaseEntityController), Command (Packet handlers) |
| Architectural | Manager pattern, Registry pattern, Barrel exports, Fixed-timestep game loop |
| Data | IterationMap (hybrid Map+Array), SyncQueue (broadcast + per-player), Protocol schemas (short keys for wire efficiency) |
| Networking | Dual transport, Packet caching, Reliable/unreliable channel split, Reconnect window, Session auth |
| Error Handling | Tiered severity (warning/error/fatal), Guard clauses, Production crash protection |
| Performance | Environmental entity optimization, Update thresholds, Lazy sync arrays, Conditional queue clearing |
