# Hytopia Coding Standards & AI PR Review Guidelines

Compiled from a 6-agent analysis of ~49k lines of TypeScript across `server/src/`, `client/src/`, and `protocol/`.

---

## Quick Reference: Hard Rules

These are non-negotiable. Any PR violating these should be rejected.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | No file over 800 lines | Prevents God Classes (NetworkSynchronizer: 1561, client Entity: 2900) |
| 2 | No method over 40 lines | `tickWithPlayerInput` at 225 lines is a cautionary tale |
| 3 | No `any` in exported types | Use `unknown` or proper types; `any` breaks the type system |
| 4 | No monkey-patching | Fragile, unchainable, no cleanup path |
| 5 | No `console.log` in production code | Use `ErrorHandler` or `console.info` |
| 6 | No TODO for error handling | Handle errors before merging |
| 7 | Pair every event listener with cleanup | Store references; remove in `detach()`/`dispose()` |
| 8 | No inline value equality checks | Create and use utility functions |
| 9 | Use `async/await` over `.then()` chains | Clearer error handling, better stack traces |
| 10 | Configuration arrays must be `readonly` | Prevents external mutation of internal state |
| 11 | 3+ identical patterns → mapping table or helper | Prevents boilerplate sprawl |
| 12 | No magic numbers | Extract to named constants or config |
| 13 | Data-driven over hardcoded | Game values belong in config, not source code |
| 14 | Defaults are sacred — change with extreme care | A default change silently affects every existing game |
| 15 | Backwards compatibility required | Existing games must not break on SDK upgrade |
| 16 | Prefer config/data files over code constants | Convention-over-configuration; separate data from logic |

---

## 0. Contribution & Review Process

These rules apply to all contributions — human or AI.

### 0.1 PR Requirements

Every PR must include:
- **Problem/benefit statement**: What problem does this solve or what value does it add?
- **Testing done**: What manual and automated testing was performed? On which platforms (desktop, mobile, iOS, Android)?
- **AI tools used**: Which AI models/harnesses were used for development and review?
- **Backwards compatibility assessment**: Does this change have any chance of breaking existing games? If someone upgrades to this SDK version, do they need to change code or assets on their end?
- **Opt-in vs automatic**: If the change is 100% an upgrade in all situations, it should apply automatically with no code changes. If it has tradeoffs (e.g., performance cost for visual improvement), it should be opt-in.

### 0.2 Review Layers

PRs must pass through multiple review layers before merge:

1. **Static type checks** — `npm run typecheck` must pass locally and in CI (GitHub Actions)
2. **Linting** — `npm run lint` must pass
3. **Unit tests** — pragmatic, high signal-to-noise tests that catch regressions
4. **Performance tests** — run locally at minimum; CI integration where viable
5. **AI code review** — at least 1 additional AI review with a **fresh context** (even if same model). Preferably 2 different tools (e.g., Claude Code + Codex). Codex can be hooked to GitHub for automatic review.
6. **Human code review** — a human with code knowledge reviewing for: wrong architecture, code smells, bad practices, suspicious hardcoding. Not checking syntax — checking design.
7. **Manual testing** — the PR submitter must have manually tested. Standard guides/tools for testing modified SDK code in a game must be provided. Test on multiple platforms.
8. **Game regression testing** — where possible, run PRs against existing games (e.g., Hatch A Zoo, VoxFire) to verify no breakage. PR creators should provide evidence of testing against published games.

### 0.3 Backwards Compatibility

This is critical. A change that "works" but breaks existing games is worse than no change.

```
Questions every PR must answer:
1. Does this change any default value?
   → If yes, what existing behavior changes silently?
2. Does this change any public API signature?
   → If yes, what existing code breaks on upgrade?
3. Does this change any wire protocol?
   → If yes, what client/server version combinations break?
4. Is this opt-in or automatic?
   → Automatic changes must be universally beneficial with zero downsides
   → Changes with tradeoffs must be opt-in
```

**Real examples of backwards compatibility failures:**
- Changing default particle alpha → broke smoke grenade visuals in existing games
- Changing player controller defaults → existing games behaved differently on upgrade
- Changing character model conventions → existing games needed asset updates

**Rule**: Default values are part of the API contract. Changing a default is a breaking change, even if the parameter is "optional."

### 0.4 Best Solution / Robustness Check

A PR might solve a real problem but:
- Is it the **best** approach, or just the first approach that worked?
- Does it account for **different game scenarios**? (e.g., a feature that works for 10 entities but kills performance with 1000)
- Should it be **opt-in** with per-entity/per-world granularity?
- Does it **scale** to large games?

Reviewers should ask: "Would this work in Hatch A Zoo with hundreds of entities?"

### 0.5 Quality Gate Stack

| Layer | Tool/Method | When |
|-------|------------|------|
| Type safety | `npm run typecheck` | Every commit, CI |
| Lint | `npm run lint` | Every commit, CI |
| Unit tests | `npm run test` | Every commit, CI |
| Perf tests | `npm run test:perf` (local) | Before PR, ideally CI |
| AI review | Fresh-context AI review (1-2 tools) | Before PR |
| Human review | Architecture/design review | Before merge |
| Manual test | Desktop + mobile platforms | Before PR |
| Game regression | Run against existing games | Before merge (where possible) |

---

## 0b. Data-Driven Design Principles

### No Magic Numbers

Every numeric literal in game logic must be a named constant or config value.

```typescript
// DO: Named constant
const RECONNECT_WINDOW_MS = 30 * 1000;
const MAX_ACTIVE_AUDIO_NODES = 64;
private static readonly WALK_FORCE_THRESHOLD = 0.1;

// DON'T: Magic numbers in logic
if (distance < 16) { ... }           // what is 16?
setTimeout(callback, 5000);           // why 5000?
if (count > 64) { ... }              // where does 64 come from?
```

### Data-Driven Over Hardcoded

Tunable values (tick rates, thresholds, timeouts, capacities) should be configurable rather than buried in source code.

```typescript
// DO: Configurable via options
constructor(options: WorldOptions) {
  this._tickRate = options.tickRate ?? 60;
  this._gravity = options.gravity ?? { x: 0, y: -32, z: 0 };
}

// DON'T: Bury tunable values in logic
this._tickRate = 60;               // not configurable
this._gravity = { x: 0, y: -32, z: 0 }; // not overridable
```

### Convention Over Configuration

Establish conventions that eliminate boilerplate configuration:
- File naming conventions that auto-register content
- Default values that cover 90% of use cases
- Predictable patterns that don't require explicit wiring

### Separate UI, Logic, and Data

Three concerns, three layers. Never mix them:
- **Data**: Config files, schemas, generated catalogs
- **Logic**: Runtime systems, state management, game rules
- **UI**: Presentation, HUD, modals, scene UI

### Defaults Are Sacred

Changing a default value is a **breaking change** in disguise. It silently alters behavior for every existing consumer.

```typescript
// DANGEROUS: Changing this default
export interface ParticleEmitterOptions {
  opacity?: number;  // was 1.0, someone changes to 0.8
  // → Every game's particles suddenly become semi-transparent
}

// SAFE: Add new option with backwards-compatible default
export interface ParticleEmitterOptions {
  opacity?: number;       // stays 1.0
  fadeOnDeath?: boolean;  // NEW, defaults to false (opt-in)
}
```

Before changing any default:
1. List every place the default is consumed
2. Assess impact on existing games
3. If any game would behave differently → it's a breaking change → requires migration path or opt-in

---

## 1. Naming Conventions

### 1.1 Classes

**PascalCase** with role-specific suffixes. The suffix communicates architectural role.

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

**camelCase** with verb prefix. The verb communicates the operation type.

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

### 1.3 Fields & Methods: Private Visibility

**All private fields and methods use `_` prefix.** This is universal across both server and client.

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
// DO
export enum PlayerEvent {
  CHAT_MESSAGE_SEND = 'PLAYER.CHAT_MESSAGE_SEND',
  JOINED_WORLD      = 'PLAYER.JOINED_WORLD',
  LEFT_WORLD         = 'PLAYER.LEFT_WORLD',
}

// DON'T: PascalCase members
export enum PlayerEvent {
  ChatMessageSend = 'PLAYER.CHAT_MESSAGE_SEND',  // wrong
}
```

### 1.6 Event String Format

`'NAMESPACE.EVENT_NAME'` using dot separator. Namespace matches the class name in UPPER_SNAKE_CASE.

```typescript
'GAMESERVER.START'
'PLAYER.JOINED_WORLD'
'ENTITY.SPAWN'
'WORLD_LOOP.TICK_START'
'CONNECTION.OPENED'
```

### 1.7 Event Payload Interfaces

Each event-emitting class exports a paired `{ClassName}EventPayloads` interface with computed property keys:

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

Always use `import type` for type-only imports. This is enforced codebase-wide.

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

Simple property access getters go on a single line:

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
// DO
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

Use type predicates or assertion functions instead of non-null assertions after guards.

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

Prefer early returns to reduce nesting:

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

### 5.5 Try/Catch

Use sparingly, mainly around I/O, event emission, and transport operations:

```typescript
try {
  this._emitter.emit(eventType, payload);
} catch (error) {
  console.error(`EventRouter.emit(): Error emitting event "${eventType}":`, error);
}
```

### 5.6 No Empty Catch Blocks

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

Two approved variants:

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
  public doSomething() {
    // ...
    this.emitWithWorld(this._world!, XxxEvent.SOMETHING_HAPPENED, { xxx: this, detail: '...' });
  }
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

`World` is the prime example — composes 10+ sub-systems rather than inheriting from them:

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

These patterns are established in the codebase. New code in hot paths must follow them.

### 8.1 Pre-allocated Working Variables

Module-level reusable objects to avoid GC pressure:

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

`matrixAutoUpdate = false` everywhere. Update matrices explicitly:

```typescript
object.matrixAutoUpdate = false;
object.matrixWorldAutoUpdate = false;
// Update manually only when transforms change
object.updateMatrix();
object.updateMatrixWorld();
```

### 8.3 Packed Numeric Keys for Map Lookups

Use numeric/packed keys in hot-path maps, not string concatenation:

```typescript
// DO
const key = (x << 20) | (y << 10) | z;  // packed numeric key

// DON'T
const key = `${x},${y},${z}`;  // string allocation every lookup
```

### 8.4 Update Thresholds

Only emit updates when changes exceed thresholds:

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

These are documented weaknesses in the current codebase. New code should not make them worse. Improvements are welcome.

### 10.1 Dependency Inversion (Score: 4/10)

The codebase relies heavily on concrete singletons (`GameServer.instance`, `PlayerManager.instance`, etc.) instead of interfaces and injection. This limits testability.

**For new code**: Prefer constructor injection where practical. If you must use a singleton, at minimum define an interface for the dependency.

### 10.2 Law of Demeter (Score: 5/10)

Deep property chains are common:
```typescript
// This pattern exists but should not be extended
this._world.entityManager.getPlayerEntitiesByPlayer(this)[0];
this._game.settingsManager.qualityPerfTradeoff.viewDistance.enabled;
```

**For new code**: Add convenience methods on the owning class rather than reaching through multiple levels.

### 10.3 God Classes

| Class | Lines | Status |
|-------|-------|--------|
| Client `Entity.ts` | ~2900 | Should extract AnimationManager, MaterialManager, CullingManager |
| `NetworkSynchronizer` | ~1561 | Should extract per-domain sync handlers |
| `GLTFManager` | ~1812 | Should split loading, caching, instancing |
| `RigidBody` / `Collider` | ~1750 each | Acceptable as physics wrappers |

**For new code**: Do not add more responsibilities to these files. Extract into new focused classes.

### 10.4 DRY Violations

- 60+ identical event handler methods in `NetworkSynchronizer` (use data-driven mapping)
- 70+ identical setter+emit patterns across Entity, PlayerCamera, ParticleEmitter
- Inline RGB color equality checks duplicated

**For new code**: If you see 3+ methods following the same pattern, use a mapping table or generic helper.

---

## 11. AI PR Review Checklist

Use this checklist when reviewing AI-generated pull requests.

### Naming & Style
- [ ] Classes use PascalCase + approved role suffix
- [ ] Methods use camelCase + verb prefix
- [ ] Private fields/methods use `_` prefix
- [ ] Constants use SCREAMING_SNAKE_CASE
- [ ] Enum members use UPPER_SNAKE_CASE
- [ ] Event strings follow `'NAMESPACE.EVENT_NAME'` format
- [ ] Files use PascalCase.ts matching primary export
- [ ] Generic params use `T` prefix

### Structure
- [ ] No file exceeds 800 lines
- [ ] No method exceeds 40 lines
- [ ] Imports follow: external → internal → type-only order
- [ ] `import type` used for type-only imports
- [ ] Class uses `export default class`
- [ ] Class body follows the 9-section structure (static → fields → constructor → getters → methods → private)
- [ ] One-liner getters for simple property access
- [ ] Named `setX()` methods, no property setters

### Type Safety
- [ ] No `any` in exported types or interfaces
- [ ] No `as any` except with documented justification
- [ ] Public methods have explicit return types
- [ ] Uses `| undefined` not `| null`
- [ ] No non-null assertions (`!`) after boolean guards — uses type predicates or assertion functions
- [ ] `as const satisfies` for constant arrays

### Error Handling
- [ ] Uses `ErrorHandler.warning/error/fatalError`, not raw `throw`
- [ ] Error messages follow `ClassName.methodName(): Description` format
- [ ] `fatalError` only for unrecoverable invariant violations
- [ ] No empty catch blocks
- [ ] No `console.log` (use `ErrorHandler` or `console.info`)

### Architecture
- [ ] Event listeners paired with cleanup in `detach()`/`dispose()`
- [ ] No monkey-patching of methods on other objects
- [ ] Options object pattern for configuration
- [ ] Composition over inheritance
- [ ] Controller pattern for entity behavior

### Performance (if touching hot paths)
- [ ] Pre-allocated working variables for hot loops
- [ ] `matrixAutoUpdate = false` for Three.js objects
- [ ] No string key concatenation in hot-path maps
- [ ] Update thresholds for position/rotation changes
- [ ] Environmental entity flag for static objects

### Protocol (if touching network layer)
- [ ] Schema uses 1-3 char property keys with inline comments
- [ ] Co-located TypeScript type + JSON Schema with `JSONSchemaType<T>`
- [ ] `additionalProperties: false` on schemas
- [ ] Packet validation at creation time (fail-fast)
- [ ] Tuple wire format `[id, data, tick?]`

### Data-Driven Design
- [ ] No magic numbers — all numeric literals are named constants or config values
- [ ] Tunable values (thresholds, rates, capacities) are configurable via options, not hardcoded
- [ ] UI, logic, and data concerns are separated
- [ ] No new defaults changed without backwards compatibility assessment
- [ ] New features with tradeoffs are opt-in, not automatic

### Backwards Compatibility
- [ ] No default values changed silently
- [ ] No public API signatures broken
- [ ] Existing games work without code changes on upgrade
- [ ] If breaking change is necessary, migration path documented
- [ ] Change scales to large games (100+ entities, multiple worlds)

### PR Process
- [ ] PR description includes problem statement, testing done, AI tools used
- [ ] At least 1 fresh-context AI review completed
- [ ] Manual testing done on relevant platforms
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] Unit tests pass; new tests added for new behavior
- [ ] Existing game regression considered

### General Quality
- [ ] No TODOs for error handling
- [ ] No stale comments referencing values that change
- [ ] Configuration arrays are `readonly`
- [ ] External input validated before merging into internal state
- [ ] `async/await` used instead of `.then()` chains
- [ ] No data-driven boilerplate (3+ identical patterns → use mapping table)
- [ ] Doesn't add responsibilities to known God Classes

---

## 12. ESLint Configuration Reference

The server ESLint config (`server/eslint.config.js`) enforces:

```javascript
// Key rules
'indent': ['error', 2, { SwitchCase: 1 }],
'quotes': ['error', 'single', { avoidEscape: true }],
'semi': ['error', 'always'],
'comma-dangle': ['error', 'always-multiline'],
'object-curly-spacing': ['error', 'always'],
'array-bracket-spacing': ['error', 'always'],
'arrow-parens': ['error', 'as-needed'],
'newline-before-return': 'error',
'linebreak-style': ['error', 'unix'],
'@typescript-eslint/no-explicit-any': 'off',  // any is allowed (legacy)
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
'@typescript-eslint/no-floating-promises': 'error',
'@typescript-eslint/await-thenable': 'error',
'@typescript-eslint/prefer-optional-chain': 'error',
```

**Note**: While `no-explicit-any` is off in ESLint, the coding standard prohibits `any` in new exported types. The ESLint rule is kept off for legacy compatibility only.

---

## Appendix A: Codebase Architecture Overview

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
