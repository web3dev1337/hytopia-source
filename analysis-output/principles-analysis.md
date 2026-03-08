# Hytopia Game Engine: Software Engineering Principles Analysis

## Overall Scorecard

| Principle | Score (1-10) | Verdict |
|-----------|:---:|---------|
| Single Responsibility (SRP) | 6 | Mixed -- managers are focused, but some classes (Entity, NetworkSynchronizer) are overloaded |
| Open/Closed (OCP) | 7 | Good event/controller extension points; some areas require source modification |
| Liskov Substitution (LSP) | 8 | Clean inheritance hierarchies with proper specialization |
| Interface Segregation (ISP) | 7 | Options interfaces are well-scoped; some fat config objects exist |
| Dependency Inversion (DIP) | 4 | Heavy use of concrete singletons; no DI container; limited abstractions |
| DRY | 6 | Some duplication in serialization, event patterns, and manager boilerplate |
| KISS | 8 | Pragmatic game engine design; complexity is justified where it exists |
| YAGNI | 8 | Minimal unused abstractions; code is feature-driven |
| Law of Demeter | 5 | Frequent deep property chains through managers and world accessors |
| Composition vs Inheritance | 8 | Strong preference for composition; inheritance used appropriately |
| Separation of Concerns | 7 | Clear server/client/protocol boundaries; some bleed in NetworkSynchronizer |
| Cohesion | 7 | Modules are generally focused; World is a facade with appropriate delegation |
| Coupling | 5 | Tight coupling through singletons and direct references; event system helps |

**Overall Score: 6.6 / 10**

---

## 1. Single Responsibility Principle (SRP)

**Score: 6/10**

### Good Adherence

**WorldLoop** (`server/src/worlds/WorldLoop.ts:71`) -- Focused exclusively on tick scheduling and lifecycle events. Delegates physics to Simulation, entity ticking to EntityManager, and networking to NetworkSynchronizer. Clean single responsibility.

**EntityManager** (`server/src/worlds/entities/EntityManager.ts:26`) -- Manages entity registration, querying, and lifecycle. Does not mix in physics, rendering, or serialization concerns. Each query method (getEntitiesByTag, getPlayerEntitiesByPlayer, etc.) is well-scoped.

**BaseEntityController** (`server/src/worlds/entities/controllers/BaseEntityController.ts:76`) -- Abstract base with clear lifecycle hooks (attach, spawn, tick, despawn, detach). Each method has a single purpose. Extension is the expected usage pattern.

**Serializer** (`server/src/networking/Serializer.ts:38`) -- Pure static class focused solely on converting domain objects to protocol schemas. No side effects, no state. Each method handles exactly one domain type.

**PlayerCamera** (`server/src/players/PlayerCamera.ts`) -- Focused on camera configuration and orientation state for a single player.

### Violations

**Entity** (`server/src/worlds/entities/Entity.ts`) -- ~1,200+ lines. This class handles:
- Physics body management (rigid body creation, collider management, impulse application)
- Model and animation state management
- Parent-child entity relationships
- Serialization coordination
- Event emission for collisions, spawning, despawning
- Visual property management (opacity, tint, emissive color)

This is the most significant SRP violation in the codebase. Entity serves as both a domain model and a physics proxy, making it the primary "God Class" candidate.

**NetworkSynchronizer** (`server/src/networking/NetworkSynchronizer.ts:67`) -- Subscribes to ~14 different event types across the entire domain model. It knows about audios, blocks, block types, chunks, entities, animations, particles, players, cameras, UIs, scene UIs, physics debug rendering, and world state. This is a cross-cutting concern by nature, but the sheer scope means any change to any domain object's events requires touching this file.

**DefaultPlayerEntityController** (`server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:133`) -- ~790 lines mixing movement physics, animation management, platform detection, swimming mechanics, audio management, and collision handling. The `tickWithPlayerInput` method at line 565 is a ~225-line method handling movement calculation, animation state machines, physics impulse computation, and rotation updates all in one function.

**Client Game** (`client/src/Game.ts:29`) -- Instantiates and holds references to 22 different managers. While it acts as a composition root (which is its purpose), it creates all dependencies directly with `new` rather than through a factory or DI pattern.

### Recommendations

1. Extract physics-related behavior from `Entity` into a separate `EntityPhysicsProxy` or delegate to `RigidBody`/`Collider` wrappers.
2. Break `DefaultPlayerEntityController.tickWithPlayerInput` into smaller methods: `_calculateMovementVelocity()`, `_applyAnimations()`, `_applyRotation()`, `_resolvePhysicsImpulse()`.
3. Consider splitting `NetworkSynchronizer` into per-domain synchronizers (EntityNetSync, AudioNetSync, etc.) composed by a coordinator.

---

## 2. Open/Closed Principle (OCP)

**Score: 7/10**

### Good Adherence

**EventRouter system** (`server/src/events/EventRouter.ts:20`) -- Excellent extension point. Every significant class extends `EventRouter`, allowing external behavior to be added via event listeners without modifying source:
```
World extends EventRouter
Entity extends EventRouter (via emitWithWorld)
BaseEntityController extends EventRouter
Simulation extends EventRouter
BlockType extends EventRouter
```

**Controller hierarchy** (`server/src/worlds/entities/controllers/`) -- `BaseEntityController` defines lifecycle hooks (`attach`, `spawn`, `tick`, `tickWithPlayerInput`, `despawn`, `detach`) that subclasses override. New movement/AI behaviors can be added without touching existing code:
- `DefaultPlayerEntityController` -- player movement
- `SimpleEntityController` -- basic entity movement
- `PathfindingEntityController` -- AI navigation

**WorldManager.worldSelectionHandler** (`server/src/players/PlayerManager.ts:88`) -- Hook-based extension for world routing:
```typescript
public worldSelectionHandler?: (player: Player) => Promise<World | undefined>;
```
This allows custom lobby/routing logic without modifying PlayerManager.

**Entity callbacks** (`server/src/worlds/entities/Entity.ts`) -- `onTick`, `onInteract`, `onBlockCollision`, `onEntityCollision` callbacks allow behavior injection without subclassing.

### Violations

**Serializer** (`server/src/networking/Serializer.ts:38`) -- Adding a new serializable type requires adding a new static method and modifying the switch/dispatch in NetworkSynchronizer. No plugin or registration mechanism.

**NetworkManager._onMessage** (`client/src/network/NetworkManager.ts:376`) -- Giant switch statement on PacketId (lines 419-536). Adding a new packet type requires modifying this method. A registry-based packet handler dispatch would be more extensible.

**Simulation._onCollisionEvent** (`server/src/worlds/physics/Simulation.ts:548`) -- Uses `instanceof` chains to dispatch collision events. Adding a new collision participant type requires modifying this method.

### Recommendations

1. Replace the `_onMessage` switch statement with a packet handler registry: `packetHandlers.register(PacketId.ENTITIES, handler)`.
2. Consider a `Serializable` registration pattern where types self-register their serializers.

---

## 3. Liskov Substitution Principle (LSP)

**Score: 8/10**

### Good Adherence

**PlayerEntity extends Entity** (`server/src/worlds/entities/PlayerEntity.ts:62`) -- PlayerEntity properly extends Entity, adding player-specific behavior (nametag, input processing) without breaking Entity's contract. Calls `super.spawn()` and `super.tick()` correctly. Overrides thresholds for more sensitive position/rotation updates, which is behavioral refinement, not contract violation.

**DefaultPlayerEntityController extends BaseEntityController** (`server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:133`) -- Properly calls `super.attach(entity)`, `super.tickWithPlayerInput(...)`, etc. to emit base class events while adding specialized behavior.

**World extends EventRouter** (`server/src/worlds/World.ts:217`) -- Also implements `protocol.Serializable`. The EventRouter contract is preserved -- listeners registered on a World receive events exactly as they would on any EventRouter.

**Client Entity / StaticEntity** -- Both implement the same display contract but StaticEntity is optimized for environmental objects. They are stored in the same `_entities` map and support the same query interface.

### Minor Concerns

**Entity type narrowing** -- `EntityManager.getEntity<T extends Entity>(id: number): T | undefined` uses generic type assertion (`as T | undefined`) which bypasses runtime type checking. The caller must know the concrete type, which works but shifts type safety to the caller.

**BlockType as EventRouter** -- BlockType extends EventRouter to emit collision events, but it represents a *type definition* (like a class/template) rather than an *instance*. Multiple blocks of the same type share one BlockType object, so listeners receive events for all blocks of that type. This is documented but could surprise consumers expecting per-instance events.

### Recommendations

1. Consider narrowing `getEntity` with runtime validation or a type-discriminated union.
2. Document the shared-BlockType event model prominently in the API.

---

## 4. Interface Segregation Principle (ISP)

**Score: 7/10**

### Good Adherence

**Options interfaces are well-decomposed:**
- `BaseEntityOptions` -- common entity config
- `BlockEntityOptions` -- block-specific (extends BaseEntityOptions)
- `ModelEntityOptions` -- model-specific (extends BaseEntityOptions)
- `EntityOptions = BlockEntityOptions | ModelEntityOptions` -- discriminated union

This pattern ensures consumers only provide what's relevant to their entity type.

**WorldOptions** (`server/src/worlds/World.ts:69`) -- All optional except `id`, `name`, `skyboxUri`. Consumers configure only what they need.

**FilterOptions / RaycastOptions** (`server/src/worlds/physics/Simulation.ts:81-151`) -- Physics query filters are composed from small optional fields. Clean ISP.

**DefaultPlayerEntityControllerOptions** (`server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:23`) -- All 30+ fields are optional, defaulting to sensible values. Consumers override only what they need.

### Violations

**Player class** (`server/src/players/Player.ts:108`) -- Exposes both public gameplay API (joinWorld, disconnect, scheduleNotification) and internal networking methods (reconnected, loadInitialPersistedData, serialize). The `@internal` annotation hides them from docs but they're still part of the class surface. A cleaner separation would be a public `Player` interface and an internal `PlayerInternal` class.

**WorldMap interface** (`server/src/worlds/World.ts:33`) -- The `entities` field uses `Omit<EntityOptions, 'rigidBodyOptions'> & { rigidBodyOptions?: ... & { type?: any } }` with an `any` cast, acknowledged in comments. This weakens type safety at the boundary.

### Recommendations

1. Split Player into a public-facing interface and an internal implementation class.
2. Define a proper `WorldMapEntityOptions` type instead of using `any` cast for rigidBodyOptions.type.

---

## 5. Dependency Inversion Principle (DIP)

**Score: 4/10**

This is the weakest area of the codebase.

### Violations

**Pervasive singleton pattern** -- Nearly every manager/registry is a concrete singleton accessed via `.instance`:
```
GameServer.instance (server/src/GameServer.ts:140)
WorldManager.instance (server/src/worlds/WorldManager.ts:63)
PlayerManager.instance (server/src/players/PlayerManager.ts:75)
PersistenceManager.instance (server/src/persistence/PersistenceManager.ts:28)
ModelRegistry.instance (server/src/models/ModelRegistry.ts)
BlockTextureRegistry.instance (server/src/textures/BlockTextureRegistry.ts)
Socket.instance (server/src/networking/Socket.ts)
WebServer.instance (server/src/networking/WebServer.ts)
PlatformGateway.instance (server/src/networking/PlatformGateway.ts)
```

This means:
- Modules depend on concrete implementations, not abstractions
- No dependency injection; all dependencies are resolved via global state
- Unit testing individual classes in isolation is difficult
- Swapping implementations (e.g., mock persistence) requires modifying the singleton

**Client-side Game class** (`client/src/Game.ts:59-87`) -- Directly instantiates all 22 managers with `new`. No factory, no DI container, no abstractions:
```typescript
this._networkManager = new NetworkManager(this);
this._entityManager = new EntityManager(this);
this._audioManager = new AudioManager(this);
// ... 19 more
```

**Direct RAPIER dependency** (`server/src/worlds/physics/Simulation.ts`) -- The physics simulation directly imports and uses `@dimforge/rapier3d-simd-compat`. There's no physics abstraction layer. Public API types like `RaycastOptions` expose `RAPIER.QueryFilterFlags` and `RAPIER.RigidBody` directly, as acknowledged by the TODO at line 138: `// TODO: Clean this up to hide RAPIER types from the public API.`

### Partial Adherence

**Constructor injection via composition** -- Some classes receive dependencies via constructor:
```typescript
// World receives its managers via constructor, but creates them itself
this._audioManager = new AudioManager(this);
this._simulation = new Simulation(this, options.tickRate, options.gravity);
```

While World creates its own dependencies, it at least passes `this` (the world) into them, creating a bidirectional reference rather than using globals.

**EventRouter as indirect coupling** -- The event system provides *some* DIP by decoupling producers from consumers. Subsystems communicate through events rather than direct method calls, especially for cross-cutting concerns like NetworkSynchronizer.

### Recommendations

1. Define interfaces for critical services: `IPlayerManager`, `IPersistenceManager`, `ISimulation`.
2. Pass dependencies via constructor injection rather than using `.instance` globals.
3. Wrap RAPIER types behind engine-owned interfaces for the public API.
4. Consider a simple service locator or DI container for the server's root-level services.

---

## 6. DRY (Don't Repeat Yourself)

**Score: 6/10**

### Good Adherence

**Shared types** (`server/src/shared/types/`) -- Vector3Like, QuaternionLike, RgbColor are defined once and imported everywhere. No re-definition of math types.

**Protocol schemas** (`protocol/schemas/`) -- Single source of truth for network data shapes shared between server serialization and client deserialization.

**Serializer utility methods** -- `serializeVector`, `serializeQuaternion`, `serializeRgbColor` are reused across all entity/world/particle serialization methods.

### Violations

**Animation state management duplication** (`server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:597-630`) -- The animation play/stop pattern is repeated 6 times with minor variations:
```typescript
// Pattern repeated for walk, run, idle, swim, swimIdle
entity.stopAllModelAnimations(animation => animations.includes(animation.name) || ...);
for (const animation of animations) {
  entity.getModelAnimation(animation)?.setLoopMode(EntityModelAnimationLoopMode.LOOP);
  entity.getModelAnimation(animation)?.play();
}
```
This could be extracted into a `_playAnimationSet(entity, animations)` helper.

**Event declaration boilerplate** -- Every class follows the same pattern of enum + interface + implementation:
```typescript
// Repeated in ~15+ files
export enum XEvent { ... }
export interface XEventPayloads { ... }
export default class X extends EventRouter { ... }
```
While this provides consistency (a good thing), the declaration overhead per class is significant and could benefit from a code generator or type helper.

**Manager query patterns** -- `EntityManager`, `PlayerManager`, and `WorldManager` all implement similar filter-by-property patterns:
```typescript
// EntityManager:160
public getEntitiesByTag(tag: string): Entity[] {
  const entities: Entity[] = [];
  this._entities.forEach(entity => { if (entity.tag === tag) entities.push(entity); });
  return entities;
}

// WorldManager:151
public getWorldsByTag(tag: string): World[] {
  const worlds: World[] = [];
  this._worlds.forEach(world => { if (world.tag === tag) worlds.push(world); });
  return worlds;
}
```

**Client/Server EventRouter implementations** -- Two completely separate EventRouter implementations:
- Server: `server/src/events/EventRouter.ts` -- Full-featured with `emitWithWorld`, `emitWithGlobal`, `final`, typed overloads
- Client: `client/src/events/EventRouter.ts` -- Minimal (44 lines), no typed events, no scoped emission

These serve different needs but share the same conceptual interface. The protocol layer could define a shared base.

**Serialization/Deserialization symmetry** -- The server's `Serializer` and client's `Deserializer` manually mirror each other field-by-field. Adding a new field to an entity requires updating both files plus the protocol schema.

### Recommendations

1. Extract the animation play/stop pattern into a reusable helper method.
2. Create a generic `filterByProperty` utility for manager query methods.
3. Consider generating serializer/deserializer code from protocol schemas to avoid manual mirroring.

---

## 7. KISS (Keep It Simple, Stupid)

**Score: 8/10**

### Good Adherence

**Flat class hierarchy** -- The inheritance tree is shallow. Entity -> PlayerEntity is the deepest game-logic chain (2 levels). Controllers use a single abstract base. No deep inheritance hierarchies.

**Simple data flow** -- The server tick loop (`WorldLoop._tick`, line 149) is straightforward:
1. Tick entities
2. Step physics
3. Check/emit updates
4. Synchronize network

Each step is a single method call. No complex state machines or middleware chains.

**Options pattern** -- All configuration uses plain TypeScript interfaces with optional fields and sensible defaults. No builder pattern, no fluent API, no configuration DSL. Simple and effective.

**Protocol schemas** -- Use compact single-letter keys (`i`, `p`, `r`, `m`) for bandwidth efficiency. Simple arrays for vectors (`[x, y, z]`) and quaternions (`[x, y, z, w]`). No nested wrapping.

### Minor Complexity

**DefaultPlayerEntityController.tickWithPlayerInput** -- While the individual pieces are simple, the 225-line method combines many concerns. The complexity is inherent to the problem (player movement is genuinely complex) but the method would benefit from decomposition for readability.

**NetworkSynchronizer sync queues** -- The dual `broadcast` + `perPlayer` queue pattern with IterationMap nesting adds conceptual complexity, but it's solving a real performance problem (avoiding per-player packet construction for shared state).

### Recommendations

1. The codebase is admirably pragmatic. Resist adding abstraction layers unless they solve a concrete problem.

---

## 8. YAGNI (You Aren't Gonna Need It)

**Score: 8/10**

### Good Adherence

**No unused abstractions** -- The codebase has no abstract factories, no strategy registries, no unused hooks. Every abstraction (`BaseEntityController`, `EventRouter`, `CollisionGroupsBuilder`) is actively used.

**Features match requirements** -- The entity system supports exactly what's needed: model entities, block entities, player entities, environmental entities. No speculative entity types or unused entity categories.

**Protocol is compact** -- Packet definitions include only what's actively transmitted. No "reserved" fields or placeholder packet types.

### Minor Concerns

**Events declared but rarely used** -- Some event types exist in enums but may have few or no external listeners (e.g., `SimulationEvent.STEP_START`, `SimulationEvent.STEP_END`). These are primarily for telemetry/debugging, which is a valid use case.

**Tag system** -- Both `Entity.tag` and `World.tag` provide generic string-based filtering. This is a simple, useful feature, but `getEntitiesByTagSubstring` (`EntityManager:180`) might be YAGNI -- substring matching on tags suggests the tag system may need structured metadata instead.

### Recommendations

1. Monitor usage of `getEntitiesByTagSubstring`. If used primarily as a "starts with" check, consider structured tags or a separate category system.

---

## 9. Law of Demeter

**Score: 5/10**

### Violations

**Deep property chains through World** -- The World class is a facade exposing many sub-managers, which leads to long chains:
```typescript
// WorldLoop._tick (server/src/worlds/WorldLoop.ts:164-186)
this._world.entityManager.tickEntities(tickDeltaMs);
this._world.simulation.step(tickDeltaMs);
this._world.entityManager.checkAndEmitUpdates();
this._world.networkSynchronizer.shouldSynchronize();
this._world.networkSynchronizer.synchronize();
this._world.chunkLattice.chunkCount;
```

**Player.interact chain** (`server/src/players/Player.ts:542-561`):
```typescript
const playerEntity = this.world.entityManager.getPlayerEntitiesByPlayer(this)[0];
const raycastHit = this.world.simulation.raycast(interactOrigin, interactDirection, this._maxInteractDistance, {
  filterExcludeRigidBody: playerEntity?.rawRigidBody,
});
// ... then:
raycastHit.hitEntity.interact(this, raycastHit);
raycastHit.hitBlock.blockType.interact(this, raycastHit);
```

**Client EntityManager multi-pass** (`client/src/entities/EntityManager.ts:160-233`):
```typescript
this._game.settingsManager.qualityPerfTradeoff.viewDistance.enabled
this._game.camera.activeCamera.position
this._game.performanceMetricsManager.frameCount
this._game.renderer.viewDistance
```

### Partial Adherence

The **event system** mitigates some Demeter violations by allowing indirect communication. For example, `NetworkSynchronizer` subscribes to events rather than directly calling `entity.getPosition()` each tick.

### Recommendations

1. Consider adding convenience methods on World that delegate to sub-managers: `world.tickEntities(delta)` instead of `world.entityManager.tickEntities(delta)`.
2. For the client Game class, consider extracting commonly-needed values into the animation callback payload rather than reaching into nested managers.

---

## 10. Composition vs Inheritance

**Score: 8/10**

### Good Adherence -- Composition Preferred

**Entity-Controller composition** -- Entities delegate behavior to controllers via composition rather than inheritance:
```typescript
// Entity has a controller field, not "MovableEntity extends Entity"
entity.setController(new DefaultPlayerEntityController({ ... }));
```
This allows swapping controllers at runtime and sharing controllers across entities.

**World composes its subsystems** (`server/src/worlds/World.ts:299-325`):
```typescript
this._audioManager = new AudioManager(this);
this._blockTypeRegistry = new BlockTypeRegistry(this);
this._chatManager = new ChatManager(this);
this._chunkLattice = new ChunkLattice(this);
this._entityManager = new EntityManager(this);
this._simulation = new Simulation(this, ...);
```
World is a composition root for world-scoped systems, not an inheritance hierarchy.

**Client StaticEntityManager as a peer** -- Rather than making StaticEntity a subclass that overrides Entity behavior, the client uses a separate `StaticEntityManager` that manages static entities through a different code path optimized for immutable objects.

### Appropriate Inheritance

**PlayerEntity extends Entity** -- Genuine "is-a" relationship. A player entity *is* an entity with additional player-specific behavior. Clean two-level hierarchy.

**DefaultPlayerEntityController extends BaseEntityController** -- Genuine specialization. The base provides lifecycle hooks and event emission; the subclass adds player movement logic.

**World, Simulation, WorldLoop all extend EventRouter** -- Mixin-like pattern where EventRouter provides event capability to any class that needs it.

### Recommendations

1. The current balance is well-chosen. The engine avoids the common game engine trap of deep inheritance hierarchies.

---

## 11. Separation of Concerns

**Score: 7/10**

### Good Adherence

**Three-layer architecture (server/client/protocol):**
- `protocol/` -- Shared data schemas and packet definitions. No business logic.
- `server/src/` -- Game logic, physics, networking, persistence. No rendering.
- `client/src/` -- Rendering, input, deserialization, visual effects. No game logic.

This is a textbook separation for a client-server game engine.

**Server domain boundaries:**
```
worlds/          -- World state, blocks, entities, physics
players/         -- Player lifecycle, input, camera, UI
networking/      -- Serialization, connections, web server
persistence/     -- Data storage abstraction
events/          -- Event routing infrastructure
```

**Client domain boundaries:**
```
core/            -- Renderer, Camera, DebugRenderer
entities/        -- Entity display, animation
chunks/          -- Block mesh, terrain rendering
network/         -- Connection, deserialization
input/           -- Keyboard, mouse, touch
ui/              -- HUD, modals, scene UI
```

### Violations

**NetworkSynchronizer crosses all boundaries** (`server/src/networking/NetworkSynchronizer.ts`) -- Imports from audios, blocks, chat, chunks, entities, animations, particles, players, cameras, UIs, scene UIs, physics, and worlds. This is inherent to its role but means it's a change bottleneck.

**Player._onInputPacket** (`server/src/players/Player.ts:515-531`) -- Mixes network packet handling with domain logic (camera orientation, interact trigger). The packet handler should deserialize and delegate, not perform game logic.

**Entity spans physics and domain** -- The server's `Entity` class directly creates and manages RAPIER rigid bodies and colliders, mixing domain model concerns with physics engine integration.

### Recommendations

1. Extract input packet processing from Player into a dedicated InputHandler class.
2. Introduce a PhysicsBody wrapper that hides RAPIER behind an engine-owned interface.

---

## 12. Cohesion Analysis

**Score: 7/10**

### High Cohesion

**Serializer** (`server/src/networking/Serializer.ts`) -- All methods convert domain objects to protocol schemas. Every method relates to the single purpose of network serialization. Very cohesive.

**ChunkLattice** -- Manages block placement in a 3D grid. All methods relate to block CRUD operations within the chunk coordinate system.

**PlayerCamera** -- All fields and methods relate to camera configuration for a single player.

**WorldLoop** -- Start/stop/tick lifecycle management for a world. Highly focused.

**CollisionGroupsBuilder** -- Builder pattern for constructing collision group bitmasks. Single, focused purpose.

### Mixed Cohesion

**World** (`server/src/worlds/World.ts`) -- Acts as a facade exposing ~10 sub-managers plus lighting/fog/skybox configuration. The lighting methods (setAmbientLightColor, setDirectionalLightIntensity, etc.) could be extracted into a `WorldEnvironment` class, but the current design is defensible as a convenience API.

**Entity** -- Low cohesion due to mixing physics management, visual properties, animation state, parent-child relationships, and event emission. See SRP analysis.

### Low Cohesion

**Client Game** (`client/src/Game.ts`) -- 22 manager fields with no behavioral methods beyond `start()`. It's a pure composition root / service locator, which is its intended role, but it has low cohesion by definition.

---

## 13. Coupling Analysis

**Score: 5/10**

### Tight Coupling

**Singleton coupling** -- The most significant coupling issue. Any class that calls `GameServer.instance`, `PlayerManager.instance`, `WorldManager.instance`, etc. is tightly coupled to both the concrete class and the singleton lifecycle:

Dependency graph for a typical server-side request:
```
PlayerManager.instance
  -> EventRouter.globalInstance
  -> WorldManager.instance
  -> PersistenceManager.instance
  -> PlatformGateway.instance
```

Changing any of these classes requires considering all consumers.

**Entity <-> World circular reference** -- Entity holds a reference to World, and World's EntityManager holds references to entities. This bidirectional coupling is common in game engines but makes it impossible to reason about either in isolation.

**Client Game <-> All Managers** -- Every client manager receives the Game instance and stores it. All managers can access any other manager through `this._game.someManager`. This creates an N-to-N coupling graph where every manager can depend on every other manager.

### Loose Coupling

**Event-driven communication** -- The EventRouter pattern provides loose coupling for cross-cutting concerns. The NetworkSynchronizer listens to events rather than being called directly by entities/blocks/players. This means domain objects don't know about networking.

**Protocol as a boundary** -- The protocol layer cleanly separates server serialization from client deserialization. Neither side depends on the other's implementation.

**Controller pattern** -- Entity behavior is decoupled from entity state via the controller composition pattern. Controllers can be developed and tested independently.

### Dependency Graph Complexity

The server has ~15 singleton/static instances that form a fully-connected dependency graph at the top level. The world-scoped classes (EntityManager, AudioManager, ChunkLattice, etc.) are better -- they're scoped to a World instance and reference each other through the World facade.

### Recommendations

1. Replace singleton access with constructor injection for testability.
2. Consider making the client Game class pass specific dependencies to managers rather than `this` (the entire Game).
3. Define explicit interfaces at module boundaries (e.g., `IWorld` that EntityManager depends on rather than the concrete `World`).

---

## Summary of Top Recommendations

### Critical (Score < 5)

1. **DIP (4/10)**: Introduce interfaces for key services and use constructor injection instead of singleton access. This is the single most impactful architectural improvement for testability and flexibility.

2. **Coupling (5/10)**: The singleton pattern creates a fully-connected dependency graph. Moving to explicit dependency injection would naturally reduce coupling.

### Important (Score 5-6)

3. **Law of Demeter (5/10)**: Add facade methods to reduce deep property chains. `world.tickEntities(delta)` instead of `world.entityManager.tickEntities(delta)`.

4. **SRP (6/10)**: Decompose `Entity` and `DefaultPlayerEntityController` into focused sub-components. Entity's physics management should be delegated.

5. **DRY (6/10)**: Extract repeated animation state management patterns and consider generating serialization code from protocol schemas.

### Maintain (Score 7+)

6. The **event-driven architecture**, **controller composition pattern**, **options interfaces**, and **three-layer separation** are strong. These patterns should be preserved and extended.

7. The codebase's **pragmatic approach** (KISS 8/10, YAGNI 8/10) is a significant strength. Resist adding abstraction for its own sake -- only add what solves concrete problems.

---

## Architecture Pattern Summary

| Pattern | Usage | Assessment |
|---------|-------|------------|
| Singleton | GameServer, all managers | Overused; testability concern |
| Composition | Entity + Controller | Excellent; right approach |
| Observer/Event | EventRouter throughout | Well-implemented; primary extension mechanism |
| Facade | World, GameServer | Appropriate for game engine API surface |
| Strategy | EntityController hierarchy | Clean pattern, well-executed |
| Delta Synchronization | NetworkSynchronizer | Sophisticated and performant |
| Builder | CollisionGroupsBuilder | Appropriate for bitmask construction |
| Registry | BlockTypeRegistry, ModelRegistry | Simple and effective |
