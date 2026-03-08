# Hytopia Coding Standards

Extracted from ~49k lines of TypeScript across `server/src/`, `client/src/`, and `protocol/`.

For contribution process, PR requirements, and review workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Hard Rules

Non-negotiable. Any PR violating these should be rejected.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | No file over 800 lines | Prevents God Classes |
| 2 | No method over 40 lines | Decompose into focused helpers |
| 3 | No `any` in exported types | Use `unknown` or proper types |
| 4 | No magic numbers | Extract to named constants or options |
| 5 | No monkey-patching | Fragile, unchainable, no cleanup path |
| 6 | No `console.log` in production code | Use `ErrorHandler` or `console.info` |
| 7 | No TODO for error handling | Handle errors before merging |
| 8 | Pair every event listener with cleanup | Store references; remove in `detach()`/`dispose()` |
| 9 | No inline value equality checks | Create and use utility functions |
| 10 | 3+ identical patterns → mapping table or helper | Prevents boilerplate sprawl |
| 11 | Configuration arrays must be `readonly` | Prevents external mutation |
| 12 | Use `async/await` over `.then()` chains | Clearer error handling, better stack traces |
| 13 | Tunable values must be configurable via options | Not buried in source code |

---

## 1. Naming Conventions

### 1.1 Classes

**PascalCase** with role-specific suffixes.

```typescript
// DO: Role suffix from this approved list
class PlayerManager { }       // Owns a collection of domain objects
class BlockTypeRegistry { }   // Stores type/definition registrations
class CollisionGroupsBuilder { } // Constructs complex objects step-by-step
class ErrorHandler { }        // Processes specific concerns
class WorldLoop { }           // Manages a lifecycle/loop
class EventRouter { }         // Routes/dispatches events
class NetworkSynchronizer { } // Coordinates sync operations

// DON'T: Generic suffixes
class PlayerService { }   // "Service" is meaningless
class EntityHelper { }    // "Helper" is meaningless
class MathUtil { }        // "Util" is meaningless
```

### 1.2 Methods

**camelCase** with verb prefix.

| Verb | Usage | Example |
|------|-------|---------|
| `get` | Retrieve value/query | `getConnectedPlayers()` |
| `set` | Mutate + emit event | `setAmbientLightColor(color)` |
| `is` / `has` | Boolean check | `isValidPacket()`, `hasListeners()` |
| `create` | Factory/instantiation | `createWorld(options)` |
| `load` | Async resource loading | `loadMap(map)` |
| `register` / `unregister` | Add/remove from registry | `registerEntity(entity)` |
| `emit` / `on` / `off` | Event system | `emit(eventType, payload)` |
| `serialize` | Convert to wire format | `serialize()` |
| `tick` | Per-frame update | `tickWithPlayerInput(input)` |

```typescript
// DO
public getConnectedPlayers(): Player[] { }
public setAmbientLightColor(color: RgbColor): void { }
public isSpawned(): boolean { }

// DON'T
public playerGet(): Player[] { }        // wrong verb position
public ambientLightColorSet(): void { }  // wrong verb position
public spawned(): boolean { }            // missing verb prefix
```

### 1.3 Private Fields & Methods

**All private fields and methods use `_` prefix.**

```typescript
// DO
private _world: World | undefined;
private _entities: Map<number, Entity> = new Map();
private _leaveWorld() { }
private _onConnectionOpened() { }

// DON'T
private world: World | undefined;
private leaveWorld() { }
```

### 1.4 Constants

**SCREAMING_SNAKE_CASE** for module-level constants.

```typescript
const RECONNECT_WINDOW_MS = 30 * 1000;
const FRAME_HEADER_SIZE = 4;
const DEFAULT_ANIMATION_BLEND_TIME_S = 0.1;
export const ENTITY_POSITION_UPDATE_THRESHOLD_SQ = 0.04 * 0.04;
```

### 1.5 Enums

**PascalCase** name, **UPPER_SNAKE_CASE** members.

```typescript
export enum PlayerEvent {
  CHAT_MESSAGE_SEND = 'PLAYER.CHAT_MESSAGE_SEND',
  JOINED_WORLD      = 'PLAYER.JOINED_WORLD',
  LEFT_WORLD         = 'PLAYER.LEFT_WORLD',
}
```

### 1.6 Event String Format

`'NAMESPACE.EVENT_NAME'` using dot separator:

```typescript
'GAMESERVER.START'
'PLAYER.JOINED_WORLD'
'ENTITY.SPAWN'
'WORLD_LOOP.TICK_START'
'CONNECTION.OPENED'
```

### 1.7 Event Payload Interfaces

Each event-emitting class exports a paired `{ClassName}EventPayloads` interface:

```typescript
export interface PlayerEventPayloads {
  [PlayerEvent.CHAT_MESSAGE_SEND]: { player: Player, message: string }
  [PlayerEvent.JOINED_WORLD]:      { player: Player, world: World }
}
```

### 1.8 Files

**PascalCase.ts** matching the primary exported class/type. Barrel files use lowercase `index.ts`.

### 1.9 Interfaces & Types

- **Interfaces**: Object shapes, options, payloads, schemas. Suffixes: `Options`, `Payloads`, `Schema`, `Like`.
- **Types**: Union types, aliases, computed types.
- **`Like` suffix**: Lightweight structural interfaces for parameters (e.g., `Vector3Like`, `QuaternionLike`).

### 1.10 Generic Type Parameters

Use `T` prefix: `TEventType`, `TPayload`, `TId`, `TSchema`.

---

## 2. Import & Export Patterns

### 2.1 Import Order

1. External packages (`@dimforge/rapier3d-simd-compat`, `eventemitter3`, `ws`)
2. Internal modules via `@/` (server) or relative `./`/`../` (client/protocol)
3. Type-only imports last (`import type`)

```typescript
import RAPIER from '@dimforge/rapier3d-simd-compat';
import BlockTextureRegistry from '@/textures/BlockTextureRegistry';
import EventRouter from '@/events/EventRouter';
import type World from '@/worlds/World';
import type { RaycastHit } from '@/worlds/physics/Simulation';
```

### 2.2 Export Rules

- **`export default class`** for the primary class in each file
- **Named exports** for enums, constants, types, functions alongside the default

```typescript
export enum GameServerEvent { ... }
export interface GameServerEventPayloads { ... }
export default class GameServer { ... }
```

### 2.3 Type-Only Imports

Always use `import type` for type-only imports.

```typescript
// DO
import type Connection from '@/networking/Connection';
import type { JSONSchemaType } from 'ajv';

// DON'T
import { JSONSchemaType } from 'ajv';  // value import for a type
```

---

## 3. Code Organization

### 3.1 File Structure

```
1. Imports (external → internal → type-only)
2. Module-level constants (SCREAMING_SNAKE_CASE)
3. Event enum (export enum XxxEvent { ... })
4. Event payloads interface (export interface XxxEventPayloads { ... })
5. Options/Config interfaces (export interface XxxOptions { ... })
6. export default class Xxx {
   a. Static private fields
   b. Public readonly fields
   c. Private fields (with @internal JSDoc)
   d. Constructor
   e. Static getter (instance) for singletons
   f. Public getters (one-liner format)
   g. Public methods
   h. Internal public methods (marked @internal)
   i. Private methods (underscore-prefixed)
}
```

### 3.2 One-Liner Getters

```typescript
// DO
public get id(): number { return this._id; }
public get world(): World { return this._world; }
public get entityCount(): number { return this._entities.size; }

// DON'T: Multi-line for trivial getters
public get id(): number {
  return this._id;
}
```

### 3.3 Private Backing + Public Getter + Named Setter

No public property setters. State mutation through named `setX()` methods:

```typescript
// DO
private _ambientLightColor: RgbColor;
public get ambientLightColor(): RgbColor { return this._ambientLightColor; }
public setAmbientLightColor(color: RgbColor) {
  if (this._ambientLightColor === color) return;
  this._ambientLightColor = color;
  // emit event...
}

// DON'T: Public setter
public set ambientLightColor(color: RgbColor) { ... }
```

### 3.4 `@internal` JSDoc

Use `/** @internal */` for implementation details that are public for technical reasons but not part of the API:

```typescript
/** @internal */
public constructor(connection: Connection, session: PlayerSession) { ... }

/** @internal */
public registerEntity(entity: Entity): number { ... }
```

---

## 4. Type Safety

### 4.1 Nullable Patterns

Use `| undefined` (not `| null`). Optional properties use `?:` syntax.

```typescript
// DO
private _world: World | undefined;
public readonly profilePictureUrl: string | undefined;
worldSelectionHandler?: (player: Player) => Promise<World | undefined>;

// DON'T
private _world: World | null;
```

### 4.2 Explicit Return Types

Public methods must have explicit return type annotations. Private methods may omit them when obvious.

```typescript
public getConnectedPlayers(): Player[] { ... }
public get playerCount(): number { ... }
public async scheduleNotification(type: string): Promise<string | void> { ... }
```

### 4.3 `as const` and `satisfies`

Use together for compile-time validation of constant arrays:

```typescript
export const SUPPORTED_INPUTS = [
  'w', 'a', 's', 'd', 'sp', 'sh', ...
] as const satisfies readonly (keyof InputSchema)[];
```

### 4.4 Type Predicates Over `!` Assertions

```typescript
// DO: assertion function
private _requireWorld(): World {
  if (!this._world) throw new Error('Entity not spawned');
  return this._world;
}
// Usage: const world = this._requireWorld();

// DON'T: repeated ! assertions
if (this.isSpawned) {
  this._world!.entityManager...  // fragile
  this.emitWithWorld(this._world!, ...);  // fragile
}
```

### 4.5 No `any` in Public API

```typescript
// DO
public emit(eventType: string, payload: unknown): boolean;

// DON'T
public emit(eventType: string, payload: any): boolean;
```

---

## 5. Error Handling

### 5.1 ErrorHandler Usage

Use the static `ErrorHandler` class, not raw `throw`:

| Method | When to Use | Behavior |
|--------|-------------|----------|
| `ErrorHandler.warning(msg)` | Unexpected but non-breaking state | Log warning, continue |
| `ErrorHandler.error(msg)` | Error that can be recovered from | Log error, return void |
| `ErrorHandler.fatalError(msg)` | Truly unrecoverable invariant violation | Log error, throw |

### 5.2 Error Message Format

`ClassName.methodName(): Human-readable description.`

```typescript
// DO
ErrorHandler.error(`Connection._deserialize(): Invalid packet format. Packet: ${JSON.stringify(packet)}`);
ErrorHandler.warning(`PlayerManager._onConnectionClosed(): Connection ${connection.id} not in map.`);
ErrorHandler.fatalError(`EntityManager.registerEntity(): Entity ${entity.name} already has id ${entity.id}!`);

// DON'T
ErrorHandler.error('Invalid packet');  // no context
throw new Error('bad data');  // raw throw
```

### 5.3 `fatalError` Restrictions

Use `fatalError` only for impossible invariant violations. Not for:
- Input validation (use `error` or `warning`)
- Missing data (use `error` and skip)
- Configuration problems (use `error` with fallback)

### 5.4 Early Return Pattern

```typescript
// DO
public joinWorld(world: World) {
  if (this._world === world) return;
  if (!world.isStarted) return ErrorHandler.warning('World not started');
  // ... rest of logic
}

// DON'T
public joinWorld(world: World) {
  if (this._world !== world) {
    if (world.isStarted) {
      // ... deeply nested logic
    }
  }
}
```

### 5.5 No Empty Catch Blocks

```typescript
// DON'T
} catch { /* NOOP */ }

// DO: at minimum log
} catch (error) {
  ErrorHandler.warning(`Connection.bindWt(): WebTransport binding failed: ${error}`);
}
```

---

## 6. Architecture Patterns

### 6.1 Singleton Pattern

Two approved variants. Note: the codebase is singleton-heavy (DIP score: 4/10). New code should prefer constructor injection where practical. If you must use a singleton, define an interface for the dependency.

**Lazy (when initialization order matters):**
```typescript
private static _instance: GameServer;
private constructor() { }
public static get instance(): GameServer {
  if (!this._instance) this._instance = new GameServer();
  return this._instance;
}
```

**Eager (for most managers):**
```typescript
public static readonly instance: PlayerManager = new PlayerManager();
private constructor() { ... }
```

### 6.2 EventRouter Pattern

Every significant class extends `EventRouter` and follows the event declaration template:

```typescript
export enum XxxEvent {
  SOMETHING_HAPPENED = 'XXX.SOMETHING_HAPPENED',
}

export interface XxxEventPayloads {
  [XxxEvent.SOMETHING_HAPPENED]: { xxx: Xxx, detail: string }
}

export default class Xxx extends EventRouter<XxxEventPayloads> {
  // ...
}
```

**Event emission scopes:**
- `emit()` — local only
- `emitWithGlobal()` — local + global singleton (for cross-world events)
- `emitWithWorld()` — local + world EventRouter (for NetworkSynchronizer to observe)

### 6.3 Controller/Strategy Pattern

Entity behavior is delegated via composition, not inheritance:

```typescript
// DO: Compose behavior
entity.setController(new DefaultPlayerEntityController({ ... }));

// DON'T: Inherit behavior
class SwimmingEntity extends Entity { ... }
```

Controllers extend `BaseEntityController` and implement lifecycle hooks:
`attach()` → `spawn()` → `tick()` / `tickWithPlayerInput()` → `despawn()` → `detach()`

### 6.4 Options Object Pattern

Configuration via single options parameter with optional fields and defaults:

```typescript
export interface WorldOptions {
  id?: number;
  name: string;
  skyboxUri?: string;
  tickRate?: number;      // defaults to 60
  gravity?: Vector3Like;  // defaults to { x: 0, y: -32, z: 0 }
}

constructor(options: WorldOptions) {
  this._tickRate = options.tickRate ?? 60;
  this._gravity = options.gravity ?? { x: 0, y: -32, z: 0 };
}
```

### 6.5 Composition Over Inheritance

```typescript
// DO: Composition
this._audioManager = new AudioManager(this);
this._entityManager = new EntityManager(this);
this._simulation = new Simulation(this, options.tickRate, options.gravity);

// DON'T: Deep inheritance
class World extends AudioCapable extends EntityCapable extends PhysicsCapable { }
```

### 6.6 Protocol Schema Pattern

Co-located TypeScript type + JSON Schema with extreme key minification:

```typescript
export type EntitySchema = {
  i: number;           // entity id
  p?: VectorSchema;    // position
  r?: QuaternionSchema; // rotation
  rm?: boolean;        // removed
}

export const entitySchema: JSONSchemaType<EntitySchema> = {
  type: 'object',
  properties: {
    i: { type: 'number' },
    p: { ...vectorSchema, nullable: true },
    r: { ...quaternionSchema, nullable: true },
    rm: { type: 'boolean', nullable: true },
  },
  required: ['i'],
  additionalProperties: false,
}
```

---

## 7. Formatting Rules

### ESLint-Enforced

| Rule | Setting |
|------|---------|
| Indent | 2 spaces, `SwitchCase: 1` |
| Quotes | Single quotes, `avoidEscape: true` |
| Semicolons | Always |
| Trailing commas | Always in multiline |
| Object curly spacing | `{ spaces }` |
| Array bracket spacing | `[ spaces ]` |
| Arrow parens | As-needed (omit for single param) |
| Blank line before return | Required |
| Linebreak style | Unix (LF) |
| Unused vars | Error, except `_` prefixed |
| Floating promises | Error |
| Await thenable | Error |

### Manual Conventions

- Arrow functions for event handlers and callbacks (preserves `this`):
  ```typescript
  private _onClose = (): void => { ... };
  private _tick = (tickDeltaMs: number): void => { ... };
  ```

- Ternaries for simple value selection; if/else for complex logic with side effects.

- Enum value alignment with whitespace padding:
  ```typescript
  export enum PlayerEvent {
    CHAT_MESSAGE_SEND               = 'PLAYER.CHAT_MESSAGE_SEND',
    JOINED_WORLD                    = 'PLAYER.JOINED_WORLD',
  }
  ```

---

## 8. Performance Patterns

New code in hot paths must follow these established patterns.

### 8.1 Pre-allocated Working Variables

```typescript
// DO: module-level working variables
const _workingVec3 = new Vector3();
const _workingQuat = new Quaternion();

class Entity {
  tick() {
    _workingVec3.set(this._x, this._y, this._z);  // reuse, no allocation
  }
}

// DON'T: allocate in hot paths
class Entity {
  tick() {
    const pos = new Vector3(this._x, this._y, this._z);  // GC pressure
  }
}
```

### 8.2 Manual Matrix Management

```typescript
object.matrixAutoUpdate = false;
object.matrixWorldAutoUpdate = false;
// Update manually only when transforms change
object.updateMatrix();
object.updateMatrixWorld();
```

### 8.3 Packed Numeric Keys for Map Lookups

```typescript
// DO
const key = (x << 20) | (y << 10) | z;  // packed numeric key

// DON'T
const key = `${x},${y},${z}`;  // string allocation every lookup
```

### 8.4 Update Thresholds

```typescript
const POSITION_THRESHOLD_SQ = 0.04 * 0.04;
const ROTATION_THRESHOLD = Math.cos(0.052 / 2);

if (positionDeltaSq > POSITION_THRESHOLD_SQ) {
  this.emit(EntityEvent.SET_POSITION, { ... });
}
```

### 8.5 Environmental Entity Optimization

Static world objects (`isEnvironmental = true`) skip per-tick updates entirely. Use this flag for non-interactive decoration.

---

## 9. Client vs Server Differences

New code must follow the conventions of the layer it's in.

| Aspect | Server | Client |
|--------|--------|--------|
| Path aliases | `@/` prefix | Relative `./`/`../` |
| TSDoc | Comprehensive, structured | Minimal (improvement needed) |
| EventRouter | Full-featured (emitWithWorld, final) | Lightweight (Map\<Set\>) |
| Singleton access | `.instance` getter or `readonly instance` | `.instance` getter |
| Event enum suffix | `Event` (e.g., `PlayerEvent`) | `EventType` (e.g., `NetworkManagerEventType`) |
| Event payload style | Interface with computed keys | Namespace with `I`-prefixed interfaces |

---

## 10. Known Improvement Areas

Documented weaknesses. New code should not make them worse. Improvements are welcome.

| Area | Score | Issue | Guidance for new code |
|------|:-----:|-------|----------------------|
| Dependency Inversion | 4/10 | 15+ concrete singletons, no DI | Prefer constructor injection; define interfaces |
| Coupling | 5/10 | Fully connected singleton graph | Don't add new singleton dependencies |
| Law of Demeter | 5/10 | Deep chains through managers | Add convenience methods instead of reaching through |
| SRP | 6/10 | Entity, NetworkSynchronizer overloaded | Don't add responsibilities to God Classes |
| DRY | 6/10 | 60+ identical handlers, 70+ identical setters | Use mapping tables for 3+ identical patterns |

**God Classes — do not add to these files:**

| Class | Lines | Should extract |
|-------|-------|----------------|
| Client `Entity.ts` | ~2900 | AnimationManager, MaterialManager, CullingManager |
| `NetworkSynchronizer` | ~1561 | Per-domain sync handlers |
| `GLTFManager` | ~1812 | Loading, caching, instancing |
| `RigidBody` / `Collider` | ~1750 each | Acceptable as physics wrappers |

---

## 11. Code Review Checklist

### Naming & Style
- [ ] Classes: PascalCase + approved role suffix
- [ ] Methods: camelCase + verb prefix
- [ ] Private fields/methods: `_` prefix
- [ ] Constants: SCREAMING_SNAKE_CASE
- [ ] Enums: UPPER_SNAKE_CASE members
- [ ] Event strings: `'NAMESPACE.EVENT_NAME'`
- [ ] Files: PascalCase.ts matching primary export
- [ ] Generics: `T` prefix

### Structure
- [ ] No file exceeds 800 lines
- [ ] No method exceeds 40 lines
- [ ] Imports: external → internal → type-only
- [ ] `import type` for type-only imports
- [ ] `export default class` for primary class
- [ ] Class body follows 9-section structure
- [ ] One-liner getters, named `setX()` methods

### Type Safety
- [ ] No `any` in exported types
- [ ] No `as any` without documented justification
- [ ] Public methods have explicit return types
- [ ] `| undefined` not `| null`
- [ ] Type predicates or assertion functions, not `!` assertions
- [ ] `as const satisfies` for constant arrays

### Error Handling
- [ ] `ErrorHandler.warning/error/fatalError`, not raw `throw`
- [ ] Error messages: `ClassName.methodName(): Description`
- [ ] `fatalError` only for unrecoverable invariants
- [ ] No empty catch blocks
- [ ] No `console.log`

### Architecture
- [ ] Event listeners paired with cleanup
- [ ] No monkey-patching
- [ ] Options object pattern for configuration
- [ ] Composition over inheritance
- [ ] Doesn't add to known God Classes

### Performance (hot paths)
- [ ] Pre-allocated working variables
- [ ] `matrixAutoUpdate = false` for Three.js objects
- [ ] No string key concatenation in hot-path maps
- [ ] Update thresholds for position/rotation
- [ ] Environmental entity flag for static objects

### Protocol (network layer)
- [ ] 1-3 char property keys with inline comments
- [ ] Co-located type + JSON Schema with `JSONSchemaType<T>`
- [ ] `additionalProperties: false`
- [ ] Validation at creation time (fail-fast)
- [ ] Tuple wire format `[id, data, tick?]`

### Quality
- [ ] No magic numbers
- [ ] Tunable values configurable via options
- [ ] No TODOs for error handling
- [ ] No stale comments referencing changeable values
- [ ] Configuration arrays are `readonly`
- [ ] External input validated before internal use
- [ ] `async/await` not `.then()` chains
- [ ] No boilerplate (3+ identical patterns → mapping table)

---

## 12. ESLint Configuration Reference

```javascript
'indent': ['error', 2, { SwitchCase: 1 }],
'quotes': ['error', 'single', { avoidEscape: true }],
'semi': ['error', 'always'],
'comma-dangle': ['error', 'always-multiline'],
'object-curly-spacing': ['error', 'always'],
'array-bracket-spacing': ['error', 'always'],
'arrow-parens': ['error', 'as-needed'],
'newline-before-return': 'error',
'linebreak-style': ['error', 'unix'],
'@typescript-eslint/no-explicit-any': 'off',  // legacy; standard prohibits in new exported types
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
'@typescript-eslint/no-floating-promises': 'error',
'@typescript-eslint/await-thenable': 'error',
'@typescript-eslint/prefer-optional-chain': 'error',
```

---

## Appendix A: Architecture Overview

```
GameServer (root singleton)
├── BlockTextureRegistry (singleton)
├── ModelRegistry (singleton)
├── PlayerManager (singleton)
│   ├── Player (per-connection)
│   │   ├── PlayerCamera
│   │   ├── PlayerUI
│   │   └── Connection (transport)
│   └── PersistenceManager (singleton)
├── WorldManager (singleton)
│   └── World (per-instance, composition root)
│       ├── AudioManager
│       ├── BlockTypeRegistry
│       ├── ChatManager
│       ├── ChunkLattice → Chunk[]
│       ├── EntityManager → Entity[]
│       ├── NetworkSynchronizer
│       ├── ParticleEmitterManager
│       ├── SceneUIManager
│       ├── Simulation (RAPIER)
│       └── WorldLoop → Ticker
├── Socket (singleton) → Connection[]
└── WebServer (singleton)

Cross-cutting:
  EventRouter (event bus, used by almost every class)
  ErrorHandler (static utility)
  Serializer (static utility)
  PlatformGateway (singleton)
```

## Appendix B: Design Principles Scorecard

| Principle | Score | Key Finding |
|-----------|:-----:|-------------|
| LSP | 8/10 | Clean inheritance hierarchies |
| KISS | 8/10 | Pragmatic game engine design |
| YAGNI | 8/10 | Minimal unused abstractions |
| Composition > Inheritance | 8/10 | Strong preference for composition |
| OCP | 7/10 | Good event/controller extension points |
| ISP | 7/10 | Well-scoped option interfaces |
| Separation of Concerns | 7/10 | Clear server/client/protocol boundaries |
| Cohesion | 7/10 | Focused modules, World as facade |
| SRP | 6/10 | Entity and NetworkSynchronizer overloaded |
| DRY | 6/10 | Serialization and event pattern duplication |
| Law of Demeter | 5/10 | Deep chains through managers |
| Coupling | 5/10 | Fully connected singleton graph |
| DIP | 4/10 | No DI, 15+ singletons, RAPIER leaks to API |
| **Overall** | **6.6/10** | |
