# Hytopia Protocol Layer Architecture Analysis

## 1. Package Structure & Entry Points

### Package Configuration
**`protocol/package.json:1-26`** - Published as `@hytopia.com/server-protocol` (v1.4.56). Dependencies: `ajv@^8.17.1` for runtime JSON Schema validation. Dev dependency `quicktype@^23.0.170` suggests codegen from JSON Schema was explored but the codebase uses hand-written TypeScript types co-located with schemas.

### TypeScript Configuration
**`protocol/tsconfig.json:1-14`** - Targets ESNext with strict mode enabled (`strict`, `noImplicitReturns`, `noImplicitAny`, `noImplicitThis`, `strictNullChecks`). Include paths: `packets/**/*.ts`, `schemas/**/*.json`, `shared/**/*.ts`. Module resolution: `node` with ESNext modules.

### Entry Point Chain
**`protocol/index.ts:1-3`** - Dual export pattern:
```typescript
import * as protocol from './exports';
export * from './exports';
export default protocol;
```
Consumers can use either `import protocol from '@hytopia.com/server-protocol'` (namespace object) or `import { PacketId, createPacket } from '@hytopia.com/server-protocol'` (named destructuring).

**`protocol/exports.ts:1-6`** - Barrel file re-exporting all public API:
- `./packets/bidirectional` - Connection, Heartbeat
- `./packets/inbound` - Client-to-server packets
- `./packets/outbound` - Server-to-client packets
- `./packets/PacketCore` - Core types and utilities
- `./packets/PacketDefinitions` - Registry and validation
- `./schemas` - All schema types and validators

---

## 2. Packet System Architecture

### 2.1 PacketId Enum & Bandwidth Optimization
**`protocol/packets/PacketCore.ts:23-59`** - Packet IDs use deliberate numeric ranges to optimize msgpack wire size:

| Range | Category | Msgpack Bytes | Count |
|-------|----------|---------------|-------|
| 0-31 | Standard Inbound | 1 byte | 5 defined |
| 32-127 | Standard Outbound | 1 byte | 16 defined |
| 116-127 | Standard Bidirectional | 1 byte | 2 defined |
| 128-191 | Debug Inbound | 2 bytes | 1 defined |
| 192-255 | Debug Outbound | 2 bytes | 2 defined |

The comment at `PacketCore.ts:8-21` explicitly states the rationale: standard packets fit in 1 byte for minimal overhead on high-frequency game traffic, while debug packets accept 2 bytes since they are infrequent.

### 2.2 Core Type Definitions
**`protocol/packets/PacketCore.ts:65-87`**

```typescript
// Packet definition = compile-time contract
interface IPacketDefinition<TId extends PacketId, TSchema> {
  id: TId;
  schema: JSONSchemaType<TSchema>;
  validate: ValidateFunction<TSchema>;
}

// Wire packet = tuple [packetId, data, optionalWorldTick]
type IPacket<TId extends PacketId, TSchema> = [
  TId,         // packet id
  TSchema,     // packet data
  WorldTick?,  // world tick (optional)
];

// WorldTick = number (game server tick counter)
type WorldTick = number;
```

**Key design pattern**: Packets are represented as fixed-position tuples `[id, data, tick?]`, not objects. This minimizes serialization overhead since arrays are more compact than objects in msgpack.

**Utility types** (`PacketCore.ts:79-87`):
- `AnyPacket = IPacket<PacketId, unknown>` - type-erased packet
- `AnyPacketDefinition = IPacketDefinition<number, unknown>` - type-erased definition
- `AnySchema = unknown` - raw schema data
- `Serializable` interface with `serialize(): AnySchema` method

### 2.3 Packet Factory Function
**`protocol/packets/PacketCore.ts:89-105`** - `createPacket()`:
```typescript
function createPacket<TId extends PacketId, TSchema>(
  packetDef: IPacketDefinition<TId, TSchema>,
  data: TSchema,
  worldTick?: WorldTick,
): IPacket<TId, TSchema>
```
1. Validates `data` against the packet definition's compiled Ajv validator
2. Throws with Ajv error text if validation fails
3. Returns tuple `[id, data]` or `[id, data, worldTick]`

Validation happens at packet **creation** time, not at send time -- fail-fast pattern.

### 2.4 Packet Definition Factory
**`protocol/packets/PacketCore.ts:165-174`** - `definePacket()`:
```typescript
function definePacket<TId extends PacketId, TSchema>(
  id: TId,
  schema: JSONSchemaType<TSchema>,
): IPacketDefinition<TId, TSchema>
```
Compiles the JSON Schema into an Ajv `ValidateFunction` at module load time via `Ajv.instance.compile(schema)`. This means all schemas are compiled once and cached by the shared Ajv singleton.

### 2.5 Binary Framing Protocol
**`protocol/packets/PacketCore.ts:4-5,107-187`** - Custom length-prefixed framing for WebSocket binary transport:

- `FRAME_HEADER_SIZE = 4` bytes (uint32 big-endian length prefix)
- `MAX_FRAME_BUFFER_SIZE = 32 * 1024 * 1024` (32MB cap)

**`framePacketBuffer()`** (`PacketCore.ts:176-187`): Prepends 4-byte big-endian uint32 length header to a packet buffer.

**`createPacketBufferUnframer()`** (`PacketCore.ts:107-163`): Returns a stateful closure that:
1. Maintains a growable internal buffer (512KB initial, doubles as needed, 32MB cap)
2. Appends incoming chunks
3. Extracts complete frames by reading the 4-byte length prefix
4. Calls `onMessage` callback with zero-copy `subarray()` views
5. Uses `copyWithin()` to shift remaining data after processing (avoids allocation)
6. Discards data if buffer exceeds 32MB (logs error, resets)

This is a streaming binary framing protocol operating over WebSocket binary frames.

### 2.6 Packet Registration & Validation
**`protocol/packets/PacketDefinitions.ts:1-37`**

Auto-registration pattern at module load:
```typescript
const registeredPackets = new Map<PacketId, AnyPacketDefinition>();

const allPackets = { ...bidirectionalPackets, ...inboundPackets, ...outboundPackets };
for (const packet of Object.values(allPackets)) {
  if ('id' in packet && 'schema' in packet) {
    const definition = packet as AnyPacketDefinition;
    if (registeredPackets.has(definition.id)) {
      throw new Error(`Packet with id ${definition.id} is already registered.`);
    }
    registeredPackets.set(definition.id, definition);
  }
}
```

Duplicate ID detection at load time via `throw`. The duck-typing check (`'id' in packet && 'schema' in packet`) filters out type exports from the barrel modules.

**`isValidPacket()`** (`PacketDefinitions.ts:24-37`): Runtime validation for incoming packets:
1. Checks structural integrity (array, numeric id >= 0, data present, optional numeric tick >= 0)
2. Looks up packet definition by ID from registry
3. Runs Ajv validation on the data payload
4. Returns type guard `packet is AnyPacket`

---

## 3. Packet Definition Patterns

### 3.1 Bidirectional Packets (2 packets)

**`protocol/packets/bidirectional/Connection.ts:1-11`**:
```typescript
export type ConnectionPacket = IPacket<typeof PacketId.CONNECTION, ConnectionSchema>;
export const connectionPacketDefinition = definePacket(PacketId.CONNECTION, connectionSchema);
```

**`protocol/packets/bidirectional/Heartbeat.ts:1-11`**: Same pattern.

### 3.2 Inbound Packets (6 packets, client-to-server)

All follow identical structure (`ChatMessageSend.ts:1-11`, `DebugConfig.ts:1-11`, `Input.ts:1-11`, `StateRequest.ts:1-11`, `SyncRequest.ts:1-11`, `UIDataSend.ts:1-11`):

```typescript
import { definePacket, PacketId } from '../PacketCore';
import type { IPacket } from '../PacketCore';
import { schemaNameSchema } from '../../schemas/SchemaName';
import type { SchemaNameSchema } from '../../schemas/SchemaName';

export type XxxPacket = IPacket<typeof PacketId.XXX, SchemaNameSchema>;
export const xxxPacketDefinition = definePacket(PacketId.XXX, schemaNameSchema);
```

No inbound packet includes `WorldTick` in its type -- tick is server-side only.

### 3.3 Outbound Packets (18 packets, server-to-client)

All outbound packets include `WorldTick` in their type via intersection:

```typescript
export type AudiosPacket = IPacket<typeof PacketId.AUDIOS, AudiosSchema> & [WorldTick];
```

This pattern (`& [WorldTick]`) appends the world tick as a required third element in the tuple. Every outbound packet carries the server tick for client-side interpolation/reconciliation.

### 3.4 Universal Packet File Template

Every packet definition file follows this exact 11-12 line template:
1. Import `definePacket` and `PacketId` from `PacketCore`
2. Import type `IPacket` from `PacketCore`
3. Import concrete schema (value) from `schemas/`
4. Import concrete schema type from `schemas/`
5. (Outbound only) Import type `WorldTick` from `PacketCore`
6. Export type alias binding `IPacket<PacketId.X, Schema>`
7. Export const definition via `definePacket(PacketId.X, schema)`

No packet file contains any business logic. All are pure wiring.

### 3.5 Index Barrel Files

- `protocol/packets/bidirectional/index.ts:1-2` - Re-exports Connection, Heartbeat
- `protocol/packets/inbound/index.ts:1-6` - Re-exports all 6 inbound packets
- `protocol/packets/outbound/index.ts:1-18` - Re-exports all 18 outbound packets

All use `export * from './PacketName'` pattern.

---

## 4. Schema Validation Architecture

### 4.1 Shared Ajv Singleton
**`protocol/shared/Ajv.ts:1-8`**:
```typescript
import Ajv from "ajv";
export default class extends Ajv {
  public static readonly instance = new Ajv();
}
```
Anonymous class extending Ajv with a static singleton. The comment explains: "per ajv docs, this is for performance around compiled validate function caching & more." All `definePacket()` calls use `Ajv.instance.compile(schema)`, so all compiled validators share the same Ajv instance for optimal caching.

### 4.2 Schema Design Patterns

#### Pattern: Extreme Property Name Minification
Every schema uses 1-3 character property keys with inline comments documenting meaning:

```typescript
// From Entity.ts:16-39
export type EntitySchema = {
  i: number;                      // entity id
  bh?: VectorSchema;              // block half extents
  bt?: string;                    // block texture uri
  e?: boolean;                    // environmental
  // ...
}
```

This is a bandwidth optimization -- property names are serialized over the wire via msgpack, so shorter keys = smaller payloads. The inline comments serve as documentation.

**Abbreviation conventions observed**:
- `i` = id (universal)
- `p` = position (spatial schemas), player id (chat), play (animation), paused (particle), pointer (UI)
- `r` = rotation (entity), remove/removed (with `rm`), rate (particle), restart (animation)
- `rm` = removed/remove (universal deletion flag)
- `n` = name (universal)
- `m` = model uri (entity), message (chat), mode (camera)
- `v` = volume (audio), velocity (particle), view distance (sceneUI), vertices (debug)
- `c` = coordinate (block), color (various), colors (debug)
- `s` = skyboxUri (world), start (audio), stop (animation), state (sceneUI)
- `o` = offset (many schemas), opacity (outline/particle)
- `e` = entity attachment id (audio/light/particle/sceneUI), environmental (entity)
- `t` = type (light), texture uri (particle), template id (sceneUI), timestep (world)

#### Pattern: Singular/Plural Schema Pairs
Most domain schemas come in pairs -- a singular schema for one item and a plural schema wrapping it in an array:

| Singular | Plural | Relationship |
|----------|--------|-------------|
| `Audio.ts` | `Audios.ts` | `AudiosSchema = AudioSchema[]` |
| `Block.ts` | `Blocks.ts` | `BlocksSchema = BlockSchema[]` |
| `BlockType.ts` | `BlockTypes.ts` | `BlockTypesSchema = BlockTypeSchema[]` |
| `ChatMessage.ts` | `ChatMessages.ts` | `ChatMessagesSchema = ChatMessageSchema[]` |
| `Chunk.ts` | `Chunks.ts` | `ChunksSchema = ChunkSchema[]` |
| `Entity.ts` | `Entities.ts` | `EntitiesSchema = EntitySchema[]` |
| `Light.ts` | `Lights.ts` | `LightsSchema = LightSchema[]` |
| `ParticleEmitter.ts` | `ParticleEmitters.ts` | `ParticleEmittersSchema = ParticleEmitterSchema[]` |
| `PhysicsDebugRaycast.ts` | `PhysicsDebugRaycasts.ts` | `PhysicsDebugRaycastsSchema = PhysicsDebugRaycastSchema[]` |
| `Player.ts` | `Players.ts` | `PlayersSchema = PlayerSchema[]` |
| `SceneUI.ts` | `SceneUIs.ts` | `SceneUIsSchema = SceneUISchema[]` |
| `UIData.ts` | `UIDatas.ts` | `UIDatasSchema = UIDataSchema[]` |

The plural file always follows the same 10-line template:
```typescript
import { singularSchema } from './Singular';
import type { JSONSchemaType } from 'ajv';
import type { SingularSchema } from './Singular';

export type PluralsSchema = SingularSchema[];

export const pluralsSchema: JSONSchemaType<PluralsSchema> = {
  type: 'array',
  items: { ...singularSchema },
}
```

Note the spread `{ ...singularSchema }` pattern for embedding the singular schema into the array items -- this avoids schema `$ref` and keeps everything inline.

#### Pattern: Co-located Type + Schema
Every schema file exports BOTH a TypeScript type AND a matching JSON Schema:
```typescript
export type FooSchema = { ... };
export const fooSchema: JSONSchemaType<FooSchema> = { ... };
```
The `JSONSchemaType<T>` generic from Ajv ensures the schema structurally matches the TypeScript type at compile time. This provides bidirectional type safety: TypeScript checks the schema matches the type, and Ajv validates runtime data matches the schema.

#### Pattern: Nullable Optional Properties
Optional properties use Ajv's `nullable: true` pattern:
```typescript
// TypeScript
type AudioSchema = { i: number; a?: string; }

// JSON Schema
properties: {
  i: { type: 'number' },
  a: { type: 'string', nullable: true },
}
```
Required fields are listed in `required: [...]`. Optional fields are not in `required` and have `nullable: true`.

#### Pattern: additionalProperties Control
- Most schemas: `additionalProperties: false` (strict, no extra properties allowed)
- Exception: `UIData.ts:7-11` uses `additionalProperties: true` for arbitrary key-value data
- Exception: `Camera.ts` and `Input.ts` have no `required` array (all properties optional) -- camera and input states are delta-based

### 4.3 Primitive Schema Types

**Tuple schemas** for compact spatial data:

**`Vector.ts:1-17`**: `VectorSchema = [number, number, number]` -- 3-element fixed tuple for x/y/z
**`Quaternion.ts:1-19`**: `QuaternionSchema = [number, number, number, number]` -- 4-element fixed tuple for x/y/z/w
**`RgbColor.ts:1-18`**: `RgbColorSchema = [number, number, number]` with `minimum: 0, maximum: 255` constraints
**`VectorBoolean.ts:1-17`**: `VectorBooleanSchema = [boolean, boolean, boolean]` -- 3-element boolean tuple
**`HexColor.ts:1-7`**: `HexColorSchema = string` with regex `pattern: '^[0-9A-Fa-f]{6}$'`

All use `minItems`/`maxItems` to enforce fixed lengths, and Ajv `items` as a tuple array (per-position type definitions).

### 4.4 Schema Composition via Spread

Schemas reference other schemas via object spread, not JSON Schema `$ref`:
```typescript
// From Entity.ts:45-46
bh: { ...vectorSchema, nullable: true },
```

This flattens the referenced schema inline. Used for: `vectorSchema`, `quaternionSchema`, `rgbColorSchema`, `outlineSchema`, `modelAnimationSchema`, `modelNodeOverrideSchema`, `hexColorSchema`.

For array-of-objects composition, the items also use spread:
```typescript
// From Entity.ts:51
ma: { type: 'array', items: { ...modelAnimationSchema }, nullable: true },
```

### 4.5 Null/Empty Schemas

Three schemas use null payload for signal-only packets:
- `HeartbeatSchema = null` (`Heartbeat.ts:3-8`) - `{ type: 'null', nullable: true }`
- `SyncRequestSchema = null` (`SyncRequest.ts:3-8`) - `{ type: 'null', nullable: true }`
- `NotificationPermissionRequestSchema = null` (`NotificationPermissionRequest.ts:3-8`) - `{ type: 'null', nullable: true }`

One uses empty object:
- `StateRequestSchema = {}` (`StateRequest.ts:3-12`) - `{ type: 'object', properties: {}, additionalProperties: false }`

---

## 5. Complex Schema Analysis

### 5.1 Entity Schema (Most Complex)
**`protocol/schemas/Entity.ts:1-70`** - 23 optional properties + 1 required (`i`). Composes:
- `VectorSchema` (5 usages: bh, p, sv, position, scale)
- `QuaternionSchema` (1 usage: r)
- `RgbColorSchema` (2 usages: ec, t)
- `ModelAnimationSchema[]` (1 usage: ma)
- `ModelNodeOverrideSchema[]` (1 usage: mo)
- `OutlineSchema` (1 usage: ol)

### 5.2 ParticleEmitter Schema
**`protocol/schemas/ParticleEmitter.ts:1-94`** - 38 optional properties + 1 required (`i`). Most properties are numeric with variance counterparts (e.g., `l` lifetime + `lv` lifetime variance, `ss` size start + `ssv` size start variance).

### 5.3 Input Schema
**`protocol/schemas/Input.ts:1-95`** - 36 optional boolean key-press flags + 6 optional numeric/vector fields. No required properties. Uses string literal keys for number keys (`'0'` through `'9'`).

### 5.4 Camera Schema
**`protocol/schemas/Camera.ts:1-47`** - 17 optional properties, no required. All camera state is delta-encoded.

---

## 6. Type Safety Flow

### Compile-time safety chain:
1. `type FooSchema = { i: number; ... }` -- TypeScript type definition
2. `const fooSchema: JSONSchemaType<FooSchema>` -- Ajv generic ensures schema matches type
3. `definePacket(PacketId.FOO, fooSchema)` -- returns `IPacketDefinition<PacketId.FOO, FooSchema>`
4. `type FooPacket = IPacket<typeof PacketId.FOO, FooSchema>` -- wire format type
5. `createPacket(fooPacketDefinition, data)` -- type-checks data against FooSchema

### Runtime safety chain:
1. `Ajv.instance.compile(schema)` at module load -- pre-compiles validator
2. `createPacket()` calls `packetDef.validate(data)` -- validates outgoing data
3. `isValidPacket()` calls `packetDef.validate(packet[1])` -- validates incoming data

The dual TypeScript + Ajv approach ensures both compile-time type correctness and runtime data integrity for untrusted client input.

---

## 7. Naming Conventions

### File Naming
- **PascalCase** for all TypeScript files: `PacketCore.ts`, `PacketDefinitions.ts`, `Connection.ts`, `ChatMessageSend.ts`
- **Singular** for individual schemas: `Audio.ts`, `Block.ts`, `Entity.ts`
- **Plural** for collection schemas: `Audios.ts`, `Blocks.ts`, `Entities.ts`
- Packet files named after their packet concept: `ChatMessageSend.ts` (inbound action), `ChatMessages.ts` (outbound state)

### Export Naming
- Types: `PascalCase` with `Schema` suffix for schemas, `Packet` suffix for packets: `AudioSchema`, `AudiosPacket`
- Schema constants: `camelCase` with `Schema` suffix: `audioSchema`, `audiosSchema`
- Packet definitions: `camelCase` with `PacketDefinition` suffix: `audiosPacketDefinition`, `connectionPacketDefinition`
- Enum values: `SCREAMING_SNAKE_CASE`: `SYNC_REQUEST`, `CHAT_MESSAGE_SEND`

### Property Naming in Schemas
- 1-3 character abbreviated keys for wire format: `i`, `p`, `rm`, `bh`, `bt`
- Inline `//` comments document each key's meaning on the same line as the type definition
- Alphabetical ordering is NOT enforced -- properties are grouped by semantic meaning

### Import Conventions
- Value imports: `import { fooSchema } from './Foo'`
- Type-only imports: `import type { FooSchema } from './Foo'`
- Ajv type imports: `import type { JSONSchemaType } from 'ajv'`
- Consistent separation of value and type imports (type-only import syntax used throughout)

---

## 8. Directory Structure Summary

```
protocol/
  index.ts              -- Dual re-export entry point
  exports.ts            -- Barrel file for all public API
  package.json          -- NPM package config
  tsconfig.json         -- TypeScript strict config
  shared/
    Ajv.ts              -- Singleton Ajv instance
  packets/
    PacketCore.ts       -- Core types, factories, framing (187 lines, largest file)
    PacketDefinitions.ts -- Auto-registration, isValidPacket (37 lines)
    bidirectional/
      index.ts          -- Barrel (2 exports)
      Connection.ts     -- CONNECTION packet (11 lines)
      Heartbeat.ts      -- HEARTBEAT packet (11 lines)
    inbound/
      index.ts          -- Barrel (6 exports)
      ChatMessageSend.ts
      DebugConfig.ts
      Input.ts
      StateRequest.ts
      SyncRequest.ts
      UIDataSend.ts
    outbound/
      index.ts          -- Barrel (18 exports)
      Audios.ts
      BlockTypes.ts
      Blocks.ts
      Camera.ts
      ChatMessages.ts
      Chunks.ts
      Entities.ts
      Lights.ts
      NotificationPermissionRequest.ts
      ParticleEmitters.ts
      PhysicsDebugRaycasts.ts
      PhysicsDebugRender.ts
      Players.ts
      SceneUIs.ts
      SyncResponse.ts
      UI.ts
      UIDatas.ts
      World.ts
  schemas/
    index.ts            -- Barrel (44 exports)
    -- Primitives --
    Vector.ts           -- [number, number, number]
    VectorBoolean.ts    -- [boolean, boolean, boolean]
    Quaternion.ts       -- [number, number, number, number]
    RgbColor.ts         -- [number, number, number] with 0-255 range
    HexColor.ts         -- string with hex regex
    -- Domain Schemas (singular) --
    Audio.ts, Block.ts, BlockType.ts, Camera.ts, ChatMessage.ts,
    Chunk.ts, Connection.ts, DebugConfig.ts, Entity.ts, Heartbeat.ts,
    Input.ts, Light.ts, ModelAnimation.ts, ModelNodeOverride.ts,
    NotificationPermissionRequest.ts, Outline.ts, ParticleEmitter.ts,
    PhysicsDebugRaycast.ts, PhysicsDebugRender.ts, Player.ts,
    SceneUI.ts, StateRequest.ts, SyncRequest.ts, SyncResponse.ts,
    UI.ts, UIData.ts, World.ts
    -- Collection Schemas (plural) --
    Audios.ts, Blocks.ts, BlockTypes.ts, ChatMessages.ts, Chunks.ts,
    Entities.ts, Lights.ts, ParticleEmitters.ts, PhysicsDebugRaycasts.ts,
    Players.ts, SceneUIs.ts, UIDatas.ts
```

---

## 9. Unique Protocol Layer Patterns

### 9.1 Msgpack-Aware ID Sizing
The `PacketId` enum is explicitly designed around msgpack's variable-length integer encoding. IDs 0-127 fit in 1 byte, 128-255 in 2 bytes. High-frequency game packets use the 1-byte range; debug packets use the 2-byte range.

### 9.2 Tuple-Based Wire Format
Packets are tuples `[id, data, tick?]`, not objects. This saves 3 property name strings per packet over the wire in msgpack encoding.

### 9.3 Inline Schema Composition (No $ref)
All schema composition uses JavaScript spread (`{ ...vectorSchema, nullable: true }`) rather than JSON Schema `$ref`. This keeps schemas self-contained after module evaluation and avoids Ajv's `$ref` resolution overhead.

### 9.4 Dual Type Safety
TypeScript `type` + Ajv `JSONSchemaType<T>` ensures the schema is structurally correct at compile time. The `ValidateFunction<T>` then validates data at runtime. This two-layer approach is particularly important because the protocol boundary crosses trust boundaries (client-to-server).

### 9.5 Load-Time Compilation
All Ajv validators are compiled at module import time via `definePacket()`. There is zero runtime compilation cost during gameplay.

### 9.6 Zero-Copy Framing
The `createPacketBufferUnframer` returns `subarray()` views instead of copies, with a documented constraint that the callback must process immediately before the buffer is modified.

### 9.7 Delta-Encoded Optional Fields
Schemas like `Camera`, `Entity`, and `Input` have all-optional properties, enabling delta encoding: only changed fields need to be sent. The `rm?: boolean` field on many schemas signals entity/resource removal.

### 9.8 Fail-Fast Registration
`PacketDefinitions.ts:16-18` throws at module load if two packets register with the same ID, preventing subtle runtime bugs.

---

## 10. Import Style Consistency

A minor inconsistency exists in how `JSONSchemaType` is imported:
- Most files: `import type { JSONSchemaType } from 'ajv'` (type-only import)
- `Connection.ts:1`: `import { JSONSchemaType } from 'ajv'` (value import)
- `ModelAnimation.ts:1`: `import { JSONSchemaType } from 'ajv'` (value import)

Since `JSONSchemaType` is only used as a type, these should all be type-only imports. The inconsistency has no runtime effect due to TypeScript's type erasure but breaks the otherwise uniform convention.

Similarly, `Camera.ts:3-4` imports its schema from the barrel `../../schemas` instead of the specific file `../../schemas/Camera`, unlike all other outbound packets which import from the specific schema file.

---

## 11. Schema Validation Constraints Summary

| Constraint Type | Example | Files |
|----------------|---------|-------|
| `minimum`/`maximum` | `RgbColor: 0-255`, `Audio.v: 0-1`, `Light.pe: 0-1` | RgbColor.ts, Audio.ts, Light.ts |
| `pattern` (regex) | `HexColor: ^[0-9A-Fa-f]{6}$` | HexColor.ts |
| `minItems`/`maxItems` | `Vector: 3/3`, `Quaternion: 4/4`, `Chunk.b: 4096/4096` | Vector.ts, Quaternion.ts, Chunk.ts |
| `additionalProperties: false` | All schemas except UIData | Nearly all files |
| `additionalProperties: true` | Arbitrary user data | UIData.ts |
| `nullable: true` | All optional properties | Pervasive |
| `type: 'null'` | Signal-only packets | Heartbeat.ts, SyncRequest.ts, NotificationPermissionRequest.ts |

---

## 12. Data Flow Summary

```
Server                          Wire (msgpack + framing)              Client
  |                                                                     |
  |-- createPacket(def, data) -----> [id, data, tick] -----> framePacketBuffer() -->|
  |                                                                     |
  |<-- isValidPacket(packet) <----- [id, data] <--------- unframer() ---|
  |                                                                     |
  |   validate(data) at both ends                                       |
```

Outbound: Server creates typed packet -> validates -> serializes to tuple -> frames with 4-byte header -> sends over WebSocket.

Inbound: Client sends binary -> unframer extracts complete messages -> deserialize -> `isValidPacket()` validates structure + schema -> process.
