# Hytopia Codebase Style Conventions

Comprehensive analysis extracted from 25+ files across `server/src/`, `client/src/`, and `protocol/`.

---

## 1. Naming Conventions

### 1.1 Class Names: PascalCase with Role Suffixes

Classes use PascalCase. Domain objects have no suffix; coordination/infrastructure classes use suffixes like `Manager`, `Registry`, `Builder`, `Handler`, `Loop`.

```typescript
// DO: PascalCase, role-specific suffixes
class GameServer { }              // server/src/GameServer.ts:104
class PlayerManager { }           // server/src/players/PlayerManager.ts:69
class EntityManager { }           // server/src/worlds/entities/EntityManager.ts:26
class BlockTypeRegistry { }       // server/src/worlds/blocks/BlockTypeRegistry.ts
class CollisionGroupsBuilder { }  // server/src/worlds/physics/CollisionGroupsBuilder.ts
class ErrorHandler { }            // server/src/errors/ErrorHandler.ts:30
class WorldLoop { }               // server/src/worlds/WorldLoop.ts:71
class NetworkSynchronizer { }     // server/src/networking/NetworkSynchronizer.ts
class EventRouter { }             // server/src/events/EventRouter.ts:20

// DON'T: avoid generic suffixes like "Service", "Helper", "Util"
// No: class PlayerService { }
// No: class EntityHelper { }
```

### 1.2 Method Names: camelCase with Verb Prefixes

Methods use camelCase. Standard verb prefixes: `get`, `set`, `is`, `has`, `create`, `load`, `emit`, `on`, `off`, `register`, `unregister`, `serialize`, `tick`.

```typescript
// DO: verb-first camelCase
public getConnectedPlayers(): Player[]           // server/src/players/PlayerManager.ts:128
public getConnectedPlayersByWorld(world): Player[] // server/src/players/PlayerManager.ts:140
public getDefaultWorld(): World                  // server/src/worlds/WorldManager.ts:134
public setAmbientLightColor(color): void         // server/src/worlds/World.ts:585
public setPersistedData(data): void              // server/src/players/Player.ts:451
public isValidPacket(packet): boolean            // protocol/packets/PacketDefinitions.ts:24
public hasListeners(eventType): boolean          // server/src/events/EventRouter.ts:138
public createWorld(options): World               // server/src/worlds/WorldManager.ts:93
public loadMap(map): void                        // server/src/worlds/World.ts:509
public registerEntity(entity): number            // server/src/worlds/entities/EntityManager.ts:61

// DON'T
// No: public playerGet()
// No: public ambientLightColorSet()
```

### 1.3 Private Properties: Underscore Prefix

All private fields use `_` prefix. This is universal across both server and client.

```typescript
// DO: underscore prefix for private fields
private static _instance: GameServer;           // server/src/GameServer.ts:106
private _blockTextureRegistry = ...;            // server/src/GameServer.ts:109
private _world: World | undefined;              // server/src/players/Player.ts:176
private _connectionPlayers: Map<Connection, Player> = new Map(); // server/src/players/PlayerManager.ts:91
private _entities: Map<number, Entity> = new Map(); // server/src/worlds/entities/EntityManager.ts:31
private _ws: WebSocket | undefined;             // client/src/network/NetworkManager.ts:81
private _game: Game;                            // client/src/entities/EntityManager.ts:45

// DON'T: no underscore for public; no double underscore
// No: private blockTextureRegistry = ...;
// No: private __instance;
```

### 1.4 Private Methods: Underscore Prefix

All private methods also use `_` prefix.

```typescript
// DO
private _leaveWorld() { }                       // server/src/players/Player.ts:469
private _onChatMessageSendPacket = () => { };   // server/src/players/Player.ts:483
private _onConnectionOpened() { }               // server/src/players/PlayerManager.ts:159
private _onClose = (): void => { };             // server/src/networking/Connection.ts:456
private _cleanupConnections(): void { }         // server/src/networking/Connection.ts:470
private _logMessage(options): void { }          // server/src/errors/ErrorHandler.ts:125
private _tick = (tickDeltaMs): void => { }      // server/src/worlds/WorldLoop.ts:149
private _setupEventListeners() { }              // client/src/entities/EntityManager.ts:59 (implied)

// DON'T
// No: private leaveWorld() { }
// No: private handleConnectionOpened() { }
```

### 1.5 Constants: UPPER_SNAKE_CASE

Module-level constants use `SCREAMING_SNAKE_CASE`.

```typescript
// DO
const RECONNECT_WINDOW_MS = 30 * 1000;                      // server/src/networking/Connection.ts:15
const FRAME_HEADER_SIZE = 4;                                 // protocol/packets/PacketCore.ts:4
const MAX_FRAME_BUFFER_SIZE = 32 * 1024 * 1024;             // protocol/packets/PacketCore.ts:5
const DEFAULT_ANIMATION_BLEND_TIME_S = 0.1;                  // client/src/entities/Entity.ts:43
const TRANSFORM_INTERPOLATION_TIME_S = 0.04;                 // client/src/entities/Entity.ts:46
const MAX_UPDATE_SKIP_FRAMES = 4;                            // client/src/entities/Entity.ts:52
const NEAR_DISTANCE_SQUARED = 16 * 16;                       // client/src/entities/Entity.ts:53
export const ENTITY_POSITION_UPDATE_THRESHOLD_SQ = 0.04 * 0.04; // server/src/worlds/entities/Entity.ts:35
export const DEFAULT_ENTITY_RIGID_BODY_OPTIONS = { ... };    // server/src/worlds/entities/Entity.ts:29
const HEARTBEAT_INTERVAL_MS = 5000;                          // client/src/network/NetworkManager.ts:31
const DEBUG_QUERY_STRINGS = 'debug';                         // client/src/Game.ts:27
```

**Exception**: `debug` constant at client/src/Game.ts:27 uses camelCase-ish lowercase -- this is an inconsistency.

### 1.6 Enums: PascalCase Names, UPPER_SNAKE_CASE Members

Enum names are PascalCase. Most enum members use `UPPER_SNAKE_CASE`. Protocol wire enums use `UPPER_SNAKE_CASE` for numeric IDs.

```typescript
// DO: PascalCase enum name, UPPER_SNAKE_CASE members
export enum GameServerEvent {
  START = 'GAMESERVER.START',
  STOP  = 'GAMESERVER.STOP',
}                                               // server/src/GameServer.ts:20

export enum PlayerEvent {
  CHAT_MESSAGE_SEND = 'PLAYER.CHAT_MESSAGE_SEND',
  JOINED_WORLD      = 'PLAYER.JOINED_WORLD',
}                                               // server/src/players/Player.ts:52

export enum WorldLoopEvent {
  START      = 'WORLD_LOOP.START',
  TICK_START = 'WORLD_LOOP.TICK_START',
}                                               // server/src/worlds/WorldLoop.ts:17

export enum PacketId {
  SYNC_REQUEST = 0,
  INPUT = 1,
  ENTITIES = 38,
}                                               // protocol/packets/PacketCore.ts:23

export enum ColliderShape {
  NONE = 'none',
  BALL = 'ball',
  BLOCK = 'block',
}                                               // server/src/worlds/physics/Collider.ts:31
```

**Exception**: `CoefficientCombineRule` uses PascalCase members (e.g., `Average = 0`) at Collider.ts:19-24. This is inconsistent with the rest of the codebase.

### 1.7 Enum Event String Format: `NAMESPACE.EVENT_NAME`

Event enum string values consistently follow `UPPER_CASE_NAMESPACE.UPPER_CASE_EVENT_NAME` pattern, using `.` as separator:

```typescript
// Pattern: 'NAMESPACE.EVENT_NAME'
'GAMESERVER.START'                              // GameServer.ts
'PLAYER.CHAT_MESSAGE_SEND'                      // Player.ts
'PLAYER_MANAGER.PLAYER_CONNECTED'               // PlayerManager.ts
'WORLD.START'                                   // World.ts
'WORLD_LOOP.TICK_START'                         // WorldLoop.ts
'ENTITY.SPAWN'                                  // Entity.ts
'CONNECTION.OPENED'                             // Connection.ts
'PLAYER_CAMERA.SET_MODE'                        // PlayerCamera.ts
'BLOCK_TYPE.INTERACT'                           // BlockType.ts
```

### 1.8 Event Payload Interfaces: `{ClassName}EventPayloads`

Each class with events exports a paired event payloads interface using computed property keys:

```typescript
// DO: interface naming and structure
export interface GameServerEventPayloads {
  [GameServerEvent.START]: { startedAtMs: number }
  [GameServerEvent.STOP]:  { stoppedAtMs: number }
}                                               // server/src/GameServer.ts:31

export interface PlayerEventPayloads {
  [PlayerEvent.JOINED_WORLD]: { player: Player, world: World }
}                                               // server/src/players/Player.ts:68

export interface WorldLoopEventPayloads {
  [WorldLoopEvent.TICK_START]: { worldLoop: WorldLoop, tickDeltaMs: number }
}                                               // server/src/worlds/WorldLoop.ts:31
```

### 1.9 File Naming: PascalCase.ts

Files are named after their primary exported class/type, using PascalCase.

```
GameServer.ts, Player.ts, PlayerManager.ts, World.ts, WorldLoop.ts,
EventRouter.ts, Events.ts, Connection.ts, ErrorHandler.ts,
EntityManager.ts, Entity.ts, Collider.ts, Vector3.ts,
PacketCore.ts, PacketDefinitions.ts
```

Barrel files use lowercase `index.ts` (e.g., `protocol/index.ts`, `server/src/index.ts`).

### 1.10 Interfaces and Types

- **Interfaces**: Used for object shapes, options, event payloads, schemas. Named as nouns with optional suffixes: `Options`, `Payloads`, `Schema`, `Like`.
- **Types**: Used for union types, aliases, computed types.

```typescript
// Interface: shape/contract
export interface WorldOptions { ... }                   // server/src/worlds/World.ts:69
export interface BaseEntityOptions { ... }              // server/src/worlds/entities/Entity.ts:49
export interface WorldMap { ... }                       // server/src/worlds/World.ts:33
export interface IPacketDefinition<TId, TSchema> { ... } // protocol/packets/PacketCore.ts:65
interface RgbColor { r: number; g: number; b: number; } // server/src/shared/types/RgbColor.ts:8
interface Vector3Like { x: number; y: number; z: number; } // server/src/shared/types/math/Vector3Like.ts:7

// Type: alias/union
export type EntityOptions = BlockEntityOptions | ModelEntityOptions; // server/src/worlds/entities/Entity.ts:151
export type PlayerInput = InputSchema;                  // server/src/players/Player.ts:42
export type AnyPacket = IPacket<PacketId, unknown>;     // protocol/packets/PacketCore.ts:79
export type WorldTick = number;                         // protocol/packets/PacketCore.ts:71
```

**Pattern**: "Like" suffix for lightweight shape interfaces used as parameter types (e.g., `Vector3Like`, `QuaternionLike`).

---

## 2. Import/Export Patterns

### 2.1 Import Ordering

Imports follow this consistent order (no explicit delimiter, but grouped logically):

1. External packages (`@dimforge/rapier3d-simd-compat`, `eventemitter3`, `ws`, `zlib`)
2. Internal modules via path alias `@/` (server) or relative `./`/`../` (client/protocol)
3. Type-only imports last (using `import type`)

```typescript
// DO: external -> internal -> type-only
import RAPIER from '@dimforge/rapier3d-simd-compat';                // external
import BlockTextureRegistry from '@/textures/BlockTextureRegistry'; // internal
import EventRouter from '@/events/EventRouter';                     // internal
import type World from '@/worlds/World';                            // type-only
import type { RaycastHit } from '@/worlds/physics/Simulation';      // type-only
                                                                    // server/src/GameServer.ts:1-10
```

### 2.2 Default Exports for Classes

Every class is exported as `export default class ClassName`. This is universal across server, client, and protocol.

```typescript
// DO: default export for classes
export default class GameServer { }      // server/src/GameServer.ts:104
export default class Player { }         // server/src/players/Player.ts:108
export default class EventRouter { }    // server/src/events/EventRouter.ts:20
export default class World { }          // server/src/worlds/World.ts:217
export default class NetworkManager { } // client/src/network/NetworkManager.ts:80
export default class Game { }           // client/src/Game.ts:29

// DON'T: named export for primary class
// No: export class GameServer { }
```

### 2.3 Named Exports for Enums, Constants, Types, Functions

Enums, constants, standalone types, and functions use named exports alongside the default class.

```typescript
// DO: named exports alongside default export
export enum GameServerEvent { ... }          // alongside export default class GameServer
export interface GameServerEventPayloads { } // alongside export default class GameServer
export const SUPPORTED_INPUTS = [...];       // alongside export default class Player
export function startServer(init) { }        // alongside export default class GameServer
                                             // server/src/GameServer.ts
```

### 2.4 Barrel File (index.ts) Re-export Pattern

The server `index.ts` re-exports with explicit grouping by concept, using comments as section headers. Both default exports and named exports are re-exported.

```typescript
// DO: grouped re-exports with comments
// AudioManager
export { default as AudioManager } from '@/worlds/audios/AudioManager';

// Player
export { default as Player, PlayerEvent, SUPPORTED_INPUTS } from '@/players/Player';
export type { PlayerEventPayloads, PlayerInput } from '@/players/Player';
                                                     // server/src/index.ts
```

### 2.5 Protocol index.ts: Namespace Re-export

Protocol uses a dual pattern: re-export all from `exports.ts` plus a default namespace export.

```typescript
import * as protocol from './exports';
export * from './exports';
export default protocol;                             // protocol/index.ts
```

### 2.6 `import type` Usage

Type-only imports consistently use `import type` syntax. This is enforced across the codebase.

```typescript
// DO: use import type for type-only imports
import type Connection from '@/networking/Connection';       // server/src/players/Player.ts:10
import type Vector3Like from '@/shared/types/math/Vector3Like'; // throughout
import type { EntityOptions } from '@/worlds/entities/Entity'; // throughout
import type { JSONSchemaType } from 'ajv';                   // protocol/schemas/Entity.ts:7
```

---

## 3. Type Annotation Patterns

### 3.1 Explicit Return Types on Public Methods

Public methods have explicit return type annotations. Private methods sometimes omit them.

```typescript
// DO: explicit return types on public
public getConnectedPlayers(): Player[] { ... }          // PlayerManager.ts:128
public get playerCount(): number { ... }                // PlayerManager.ts:117
public emit(eventType: string, payload: any): boolean { // EventRouter.ts:46
public static serializePackets(packets): Buffer | void { // Connection.ts:155
public async scheduleNotification(type, scheduledFor): Promise<string | void> { // Player.ts:342

// Private methods often omit return type when obvious
private _leaveWorld() { ... }                           // Player.ts:469
private _onConnectionDisconnected(connection: Connection) { ... } // PlayerManager.ts:173
```

### 3.2 Generic Type Parameters: TPrefix

Generic type parameters use `T` prefix convention.

```typescript
// DO: T-prefixed generic params
public emit<TEventType extends keyof EventPayloads>(...) // EventRouter.ts:44
public on<TEventType extends keyof EventPayloads>(...) // EventRouter.ts:225
export function createPacket<TId extends PacketId, TSchema>(...) // PacketCore.ts:89
export interface IPacketDefinition<TId extends PacketId, TSchema> // PacketCore.ts:65
type EventListener<TPayload> = (payload: TPayload) => void; // client/src/events/EventRouter.ts:1
```

### 3.3 Nullable Patterns

The codebase consistently uses `| undefined` (not `| null`) for optional values. Optional properties use `?:` syntax. Explicit `undefined` used for runtime checks.

```typescript
// DO: | undefined and ?:
private _world: World | undefined;                      // Player.ts:176
public readonly profilePictureUrl: string | undefined;  // Player.ts:131
public get fogColor(): RgbColor | undefined { ... }     // World.ts:407
public get tag(): string | undefined { ... }            // World.ts:490
worldSelectionHandler?: (player: Player) => Promise<World | undefined>; // PlayerManager.ts:88

// DON'T: avoid | null (used only where protocols/3rd-party require it)
```

### 3.4 `as const` and `satisfies`

Used together for compile-time validation of constant arrays:

```typescript
export const SUPPORTED_INPUTS = [
  'w', 'a', 's', 'd', ...
] as const satisfies readonly (keyof InputSchema)[];    // Player.ts:24-34
```

### 3.5 Method Overload Pattern for Type-Safe Events

The EventRouter uses a consistent triple-overload pattern: typed overload, string fallback, and implementation:

```typescript
public emit<TEventType extends keyof EventPayloads>(eventType: TEventType, payload: EventPayloads[TEventType]): boolean;
public emit(eventType: string, payload: any): boolean;
public emit(eventType: string, payload: any): boolean { ... }
                                                        // EventRouter.ts:44-57
```

---

## 4. Code Organization Within Files

### 4.1 File Structure Order (Server Classes)

```
1. Imports (external -> internal -> type-only)
2. Module-level constants (SCREAMING_SNAKE_CASE)
3. Event enum (export enum XxxEvent { ... })
4. Event payloads interface (export interface XxxEventPayloads { ... })
5. Options/Config interfaces (export interface XxxOptions { ... })
6. export default class Xxx {
   a. Static private fields
   b. Public readonly fields
   c. Private fields (with @internal JSDoc)
   d. Constructor (often private for singletons)
   e. Static getter (instance) for singletons
   f. Public getters (one-liner format for simple getters)
   g. Public methods (alphabetical or logical grouping)
   h. Internal public methods (marked @internal)
   i. Private methods (underscore-prefixed)
}
```

**Evidence**: This exact pattern is followed in `GameServer.ts`, `Player.ts`, `World.ts`, `WorldLoop.ts`, `Connection.ts`, `PlayerManager.ts`, `WorldManager.ts`.

### 4.2 One-Liner Getters

Simple property getters are written on a single line:

```typescript
// DO: single-line getters
public get id(): number { return this._id; }            // World.ts:337
public get input(): PlayerInput { return this._input; } // Player.ts:205
public get isDuplicate(): boolean { return this._isDuplicate; } // Connection.ts:122
public get world(): World { return this._world; }       // WorldLoop.ts:131
public get entityCount(): number { return this._entities.size; } // EntityManager.ts:49
public get arrowManager(): ArrowManager { return this._arrowManager; } // Game.ts:97

// DON'T: multi-line for trivial getters
// No:
// public get id(): number {
//   return this._id;
// }
```

### 4.3 Private Backing Fields with Public Getters (No Setters)

The dominant pattern is: private `_field` + public getter, no public setter. State mutation is done through named `setX()` methods or internal methods.

```typescript
// DO: named setter methods
private _ambientLightColor: RgbColor;
public get ambientLightColor(): RgbColor { return this._ambientLightColor; }
public setAmbientLightColor(color: RgbColor) { ... } // World.ts:222,344,585

private _interactEnabled: boolean = true;
public get isInteractEnabled(): boolean { return this._interactEnabled; }
public setInteractEnabled(enabled: boolean) { ... }   // Player.ts:164,215,419

// DON'T: public setters
// No: public set ambientLightColor(color: RgbColor) { ... }
```

### 4.4 `@internal` JSDoc Annotation

Internal implementation details are marked with `/** @internal */`. This is the sole JSDoc tag used for visibility control.

```typescript
/** @internal */
private static _instance: GameServer;                    // GameServer.ts:106

/** @internal */
private _blockTextureRegistry = ...;                    // GameServer.ts:109

/** @internal */
public constructor(connection, session) { ... }         // Player.ts:182

/** @internal */
public registerEntity(entity): number { ... }           // EntityManager.ts:61
```

---

## 5. Comment/Documentation Patterns

### 5.1 TSDoc Format

The server package uses comprehensive TSDoc with a consistent structured format:

```typescript
/**
 * Brief description of what it is.
 *
 * When to use: [use case].
 * Do NOT use for: [anti-use case].
 *
 * @remarks
 * Additional details, initialization order, caveats.
 * Pattern: [recommended pattern].
 * Anti-pattern: [what to avoid].
 *
 * <h2>Events</h2>
 * [event documentation, if applicable]
 *
 * @example
 * ```typescript
 * // code example
 * ```
 *
 * @param paramName - Description.
 * @returns Description.
 *
 * **Requires:** [preconditions]
 * **Side effects:** [mutations, emissions, I/O]
 *
 * @see `RelatedClass`
 *
 * **Category:** CategoryName
 * @public
 */
```

**Evidence**: Consistent across `GameServer.ts:39-65`, `EventRouter.ts:7-19`, `World.ts:187-216`, `WorldLoop.ts:48-70`, `Connection.ts:49-63`, `Player.ts:91-107`.

### 5.2 Category Tags

Every public TSDoc block ends with `**Category:** CategoryName`. Categories seen: `Core`, `Events`, `Players`, `Entities`, `Physics`, `Networking`, `Blocks`, `Persistence`, `Utilities`, `Types`, `Math`.

```typescript
 * **Category:** Core
 * @public
```

### 5.3 Inline Comments

Inline comments use `//` style. They explain *why*, not *what*. Often placed above a line or at end of line.

```typescript
// If an input packet has a sequence number, meaning it was sent
// over an unreliable, unordered UDP connection...             // Player.ts:518-520

// Lazy init if none exist
this._defaultWorld ??= this.createWorld({ ... });              // WorldManager.ts:135

// prevent movement/actions if keys were pressed at time of disconnect
player.resetInputs();                                          // PlayerManager.ts:177

// TODO: Seperate and expand on global server vs worlds/room chat?
const message = packet[1].m;                                   // Player.ts:488
```

### 5.4 Client-Side: Minimal TSDoc

The client-side code has almost no TSDoc. Methods are rarely documented. This is a clear asymmetry with the server.

```typescript
// Client: no TSDoc, just code
export default class Game {                                    // Game.ts:29
  public static get instance(): Game { ... }                   // Game.ts:89 - no doc
  public async start(): Promise<void> { ... }                  // Game.ts:123 - no doc
}

export default class EntityManager {                           // client/src/entities/EntityManager.ts:44
  public constructor(game: Game) { ... }                       // no doc
  public getEntity(id: number) { ... }                         // no doc
}
```

---

## 6. Error Handling Patterns

### 6.1 ErrorHandler Static Methods

Errors are handled through the static `ErrorHandler` class with three severity levels:

```typescript
// DO: use ErrorHandler, not raw throw
ErrorHandler.warning('message');     // Logs warning, continues execution
ErrorHandler.error('message');       // Logs error, continues execution (returns void)
ErrorHandler.fatalError('message');  // Logs error, throws Error (returns never)

// server/src/errors/ErrorHandler.ts
```

### 6.2 Error Message Format: `ClassName.methodName(): Description`

Error messages follow a consistent format: `ClassName.methodName(): Human-readable description.`

```typescript
// DO: class.method(): message format
ErrorHandler.error(`Connection._deserialize(): Invalid packet format. Packet: ${JSON.stringify(packet)}`);
// Connection.ts:506

ErrorHandler.error(`Connection.send(): Packet send failed. Error: ${error as Error}`);
// Connection.ts:429

ErrorHandler.warning(`PlayerManager._onConnectionClosed(): Connection ${connection.id} not in the PlayerManager._connectionPlayers map.`);
// PlayerManager.ts:211

ErrorHandler.fatalError(`EntityManager.registerEntity(): Entity ${entity.name} is already assigned the id ${entity.id}!`);
// EntityManager.ts:63

ErrorHandler.fatalError(`Failed to initialize the game engine, exiting. Error: ${error}`);
// GameServer.ts:87
```

### 6.3 Try/Catch Usage

Try/catch is used sparingly, mainly around I/O and event emission:

```typescript
// EventRouter: catch individual listener errors
try {
  this._emitter.emit(eventType, payload);
} catch (error) {
  console.error(`EventRouter.emit(): Error emitting event "${eventType}":`, error);
}
                                                            // EventRouter.ts:49-54

// Connection: catch transport errors
try {
  this._ws?.close();
  this._wt?.close();
} catch (error) {
  ErrorHandler.error(`Connection.disconnect(): ... Error: ${error as Error}`);
}
                                                            // Connection.ts:328-333
```

### 6.4 Error Return as void

Non-fatal `ErrorHandler.error()` and `ErrorHandler.warning()` return `void`, allowing early returns:

```typescript
return ErrorHandler.error(`EventRouter.final(): Listener ... already exists.`);
// EventRouter.ts:121

return ErrorHandler.warning('Player.scheduleNotification(): Player must be in a world...');
// Player.ts:344
```

---

## 7. Formatting Patterns

### 7.1 ESLint-Enforced Rules (from `server/eslint.config.js`)

| Rule | Setting |
|------|---------|
| Indent | 2 spaces, `SwitchCase: 1` |
| Quotes | Single quotes, `avoidEscape: true` |
| Semicolons | Always |
| Trailing commas | Always in multiline |
| Object curly spacing | `{ spaces }` |
| Array bracket spacing | `[ spaces ]` (note: config has conflicting rules, see inconsistency below) |
| Arrow parens | `as-needed` (omit when single param) |
| Newline before return | Required |
| Linebreak style | Unix (LF) |
| `no-explicit-any` | OFF (any is allowed) |
| `no-unused-vars` | Error, except `_` prefixed args |
| `no-floating-promises` | Error |
| `await-thenable` | Error |
| `prefer-optional-chain` | Error |
| TSDoc syntax | Warn |

**Note**: The ESLint config has a conflicting duplicate rule -- `array-bracket-spacing` is set to `'never'` on line 31 and then overridden to `'always'` on line 31 (second occurrence). The actual code uses `['always']` style (spaces inside brackets):

```typescript
super([ x, y, z ]);                                     // Vector3.ts:26
return [ ...this._emitter.listeners(eventType), ... ];  // EventRouter.ts:154-157
```

### 7.2 Blank Line Patterns

- Blank line before `return` (enforced by ESLint `newline-before-return`)
- Blank line between methods
- No blank line after opening brace of class/method
- Blank line between logical sections within methods

```typescript
public static get instance(): GameServer {
  if (!this._instance) {
    this._instance = new GameServer();
  }

  return this._instance;           // blank line before return
}                                   // GameServer.ts:140-146
```

### 7.3 Ternary vs If/Else

- Ternaries for simple assignments and nullish coalescing
- If/else for multi-line logic or side effects

```typescript
// DO: ternary for simple value selection
this._ambientLightColor = options.ambientLightColor ?? { r: 255, g: 255, b: 255 };
this._fogFar = options.fogFar ?? 550;                   // World.ts:303-309

// DO: if/else for complex logic
if (init.length > 0) {
  initResult = init(GameServer.instance.worldManager.getDefaultWorld());
} else {
  initResult = (init as () => void | Promise<void>)();
}                                                        // GameServer.ts:74-79
```

### 7.4 Early Return Pattern

Extensively used to reduce nesting:

```typescript
public joinWorld(world: World) {
  if (this._world === world) {
    return;                                              // early return
  }
  // ... rest of logic
}                                                        // Player.ts:295-321

public start(): void {
  if (this._loop.isStarted) return;                     // inline early return
  // ...
}                                                        // World.ts:767
```

### 7.5 Arrow Functions for Callbacks/Event Handlers

Private event handler methods consistently use arrow function assignment (preserving `this` context):

```typescript
// DO: arrow function assignment for event handlers
private _onChatMessageSendPacket = (packet: protocol.ChatMessageSendPacket) => { ... };
private _onInputPacket = (packet: protocol.InputPacket) => { ... };
private _onClose = (): void => { ... };
private _tick = (tickDeltaMs: number): void => { ... };
private _onTickError = (error: Error) => { ... };
                                                        // Player.ts:483-577, Connection.ts:434-468, WorldLoop.ts:149-205
```

### 7.6 Enum Value Alignment

Enum values and event payload property values are right-aligned with whitespace padding for readability:

```typescript
export enum PlayerEvent {
  CHAT_MESSAGE_SEND               = 'PLAYER.CHAT_MESSAGE_SEND',
  INTERACT                        = 'PLAYER.INTERACT',
  JOINED_WORLD                    = 'PLAYER.JOINED_WORLD',
  LEFT_WORLD                      = 'PLAYER.LEFT_WORLD',
  RECONNECTED_WORLD               = 'PLAYER.RECONNECTED_WORLD',
}                                                        // Player.ts:52-60

export interface PlayerEventPayloads {
  [PlayerEvent.CHAT_MESSAGE_SEND]:               { player: Player, message: string }
  [PlayerEvent.JOINED_WORLD]:                    { player: Player, world: World }
}                                                        // Player.ts:68-89
```

### 7.7 Semicolons in Event Payload Interfaces

Event payload interface members do NOT have trailing semicolons -- they are bare (no separator). Each line has a JSDoc comment above it.

```typescript
export interface GameServerEventPayloads {
  /** Emitted when the game server starts. */
  [GameServerEvent.START]: { startedAtMs: number }      // no semicolon

  /** Emitted when the game server stops. */
  [GameServerEvent.STOP]:  { stoppedAtMs: number }      // no semicolon
}                                                        // GameServer.ts:31-37
```

---

## 8. Architectural Patterns (Style-Relevant)

### 8.1 Singleton Pattern

Two variants are used:

**Variant 1: Lazy static getter** (private constructor):
```typescript
private static _instance: GameServer;
private constructor() { }
public static get instance(): GameServer {
  if (!this._instance) { this._instance = new GameServer(); }
  return this._instance;
}                                                        // GameServer.ts:106-146, Game.ts:30-95
```

**Variant 2: Eager static readonly** (private/no constructor):
```typescript
public static readonly instance: PlayerManager = new PlayerManager();
private constructor() { ... }                            // PlayerManager.ts:75-76

public static readonly instance: WorldManager = new WorldManager();
                                                         // WorldManager.ts:63

public static readonly instance: PersistenceManager = new PersistenceManager();
                                                         // PersistenceManager.ts:28
```

**Variant 3: Static readonly instance** (no private constructor):
```typescript
public static readonly globalInstance: EventRouter = new EventRouter();
                                                         // EventRouter.ts:26
```

### 8.2 Options Object Pattern

Configuration is passed via a single `options` object parameter to constructors:

```typescript
constructor(options: WorldOptions) { ... }               // World.ts:299
public createWorld(options: Omit<WorldOptions, 'id'>)    // WorldManager.ts:93
```

### 8.3 Protocol Schema Short Keys

Protocol schemas use single-letter or two-letter keys for wire efficiency:

```typescript
export type EntitySchema = {
  i: number;    // entity id
  bh?: VectorSchema;  // block half extents
  bt?: string;  // block texture uri
  e?: boolean;  // environmental
  m?: string;   // model uri
  p?: VectorSchema;   // position
  r?: QuaternionSchema; // rotation
  rm?: boolean; // removed
}                                                        // protocol/schemas/Entity.ts:15-39
```

---

## 9. Client vs Server Style Differences

| Aspect | Server | Client |
|--------|--------|--------|
| Path aliases | `@/` prefix | Relative `./`/`../` |
| TSDoc | Comprehensive, structured | Minimal or absent |
| EventRouter | Full-featured (EventEmitter wrapper, final listeners, world scope) | Lightweight (Map<Set>) |
| Singleton access | `.instance` getter or `readonly instance` | `.instance` getter |
| Event enum naming | `{Class}Event` | `{Class}EventType` |
| Event payload convention | Interface with computed keys | Namespace with individual interfaces |
| Constructor visibility | `public` or `private` + `@internal` | `public` |

Client-specific pattern -- namespaced event payloads:

```typescript
// Client uses namespace + interfaces (differs from server)
export namespace NetworkManagerEventPayload {
  export interface IAudiosPacket { ... }
  export interface IBlocksPacket { ... }
}                                                        // client/src/network/NetworkManager.ts:59-78

// Server uses single interface with computed keys (preferred pattern)
export interface PlayerEventPayloads {
  [PlayerEvent.JOINED_WORLD]: { ... }
}
```

---

## 10. Known Inconsistencies

1. **ESLint `array-bracket-spacing`**: Duplicate rule (lines 31 vs 31) -- first says `'never'`, second says `'always'`. Code uses `'always'`.

2. **`CoefficientCombineRule` enum members**: Uses PascalCase (`Average`, `Min`, `Multiply`, `Max`) while all other enums use UPPER_SNAKE_CASE. (Collider.ts:19-24)

3. **Client event naming**: Uses `EventType` suffix (`NetworkManagerEventType`, `RendererEventType`, `WorkerEventType`, `ClientSettingsEventType`) while server uses `Event` suffix (`PlayerEvent`, `WorldEvent`, `EntityEvent`).

4. **Client event payloads**: Uses `namespace` + `I`-prefixed interfaces (`NetworkManagerEventPayload.IAudiosPacket`) while server uses single interface with computed keys.

5. **Client TSDoc**: Almost entirely absent compared to server's exhaustive documentation.

6. **`DEBUG_QUERY_STRINGS`**: Uses lowercase value `'debug'` -- minor inconsistency in constant naming. (Game.ts:27)

7. **Interface default export for simple types**: `RgbColor` and `Vector3Like` use `interface ... export default` pattern rather than `export default interface`.

---

## 11. Summary of Critical Rules

1. Classes: `PascalCase` + role suffix (`Manager`, `Registry`, `Builder`, `Handler`, `Loop`)
2. Methods: `camelCase` with verb prefix (`get`, `set`, `is`, `has`, `create`, `load`, `emit`, `on`)
3. Private fields/methods: `_underscore` prefix, always
4. Constants: `SCREAMING_SNAKE_CASE`
5. Enums: `PascalCase` name, `UPPER_SNAKE_CASE` members
6. Event strings: `'NAMESPACE.EVENT_NAME'` format
7. Default exports for classes, named exports for everything else
8. `import type` for type-only imports
9. One-liner getters for simple property access
10. Named `setX()` methods instead of property setters
11. `@internal` JSDoc for implementation details
12. `ErrorHandler.method()` for error handling, not raw `throw`
13. Error messages: `ClassName.methodName(): Description`
14. Arrow functions for event handlers and callbacks
15. 2-space indentation, single quotes, always semicolons, trailing commas
16. Blank line before `return` statements
17. Early returns to reduce nesting
18. Options object pattern for configuration
