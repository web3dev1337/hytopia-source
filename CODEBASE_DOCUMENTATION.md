# HYTOPIA Engine — Codebase Documentation

> **Keep this file current.** If you add, delete, or move files/systems, update this doc before creating a PR. Keep it token-efficient.

## Quick Navigation

```
ENTRY:    server/src/index.ts - SDK public API barrel export
          server/src/GameServer.ts - Server singleton + startServer()
          server/src/playground.ts - Local dev entry (hot-reloaded)
          client/src/main.ts - Client entry → Game.instance.start()
          client/src/Game.ts - Client singleton, owns all managers
CORE:     server/src/ - Server source
          client/src/ - Client source
PROTOCOL: protocol/ - Packet schemas + definitions (@hytopia.com/server-protocol)
SDK:      sdk/ - Git submodule → hytopiagg/sdk (build output lands here)
EXAMPLES: sdk-examples/ - Reference games built with the SDK
ASSETS:   assets/release/ - Default game assets (audio, blocks, maps, models, particles, skyboxes, ui)
PERF:     packages/perf-tools/ - Benchmark CLI + trace analysis (`hytopia-bench`), headless client metrics, synthetic + real-game presets (`zoo-game-full` single-client benchmark, `zoo-game-observe` 5-client joinable Zoo run), helper scripts for linking/running external games (including linked SDK runtime deps)
CONFIG:   package.json - Monorepo root (npm workspaces)
          server/package.json - Server deps + build scripts
          server/tsconfig.json - Strict TS, path alias @/* → ./src/*
          server/eslint.config.js - ESLint + tsdoc
          client/vite.config.js - Vite dev server + basis transcoder copy
          protocol/package.json - Protocol package
```

## Server (`server/src/`)

### Core

```
GameServer.ts - Singleton entry point. Owns registries + managers
├─ startServer() bootstraps: RAPIER → textures → models → init callback → WebServer.start()
└─ Singletons: blockTextureRegistry, modelRegistry, playerManager, socket, webServer, worldManager

index.ts - SDK barrel export (all public API types + classes)
playground.ts - Dev sandbox, hot-reloaded via nodemon. Loads boilerplate map, spawns players
```

### Networking

```
networking/WebServer.ts - HTTP/2 + Express v5, serves assets, WebSocket upgrades, health-check
networking/Socket.ts - Dual transport: ws.WebSocketServer + @fails-components/webtransport
networking/Connection.ts - Per-client abstraction, batches packets per tick, msgpackr + gzip
networking/PlatformGateway.ts - Auth via HYTOPIA platform session tokens
networking/NetworkSynchronizer.ts - Queues world deltas, flushes to players at 30 Hz
networking/Serializer.ts - Packet serialization helpers
networking/ssl/certs.ts - SSL certificate handling
```

### Players

```
players/Player.ts - Player state, input, events
players/PlayerCamera.ts - Camera mode + orientation per player
players/PlayerManager.ts - Singleton managing all connected players
players/PlayerUI.ts - Per-player HTML/CSS overlay UI
```

### Worlds

```
worlds/World.ts - Contains ChunkLattice, EntityManager, Simulation, NetworkSynchronizer, etc.
worlds/WorldLoop.ts - Fixed 60 Hz game loop: entity logic → physics → events → network sync
worlds/WorldManager.ts - Multi-world support, default world creation
```

### Blocks / Chunks

```
worlds/blocks/Block.ts - Single block placement + rotation
worlds/blocks/BlockType.ts - Block type definition + events
worlds/blocks/BlockTypeRegistry.ts - Registry of all block types
worlds/blocks/Chunk.ts - 16x16x16 voxel chunk
worlds/blocks/ChunkLattice.ts - Voxel world storage (set/get blocks)
textures/BlockTextureRegistry.ts - Block texture atlas management
```

### Entities

```
worlds/entities/Entity.ts - Base entity with rigid body, model, events
worlds/entities/PlayerEntity.ts - Player-bound entity base
worlds/entities/DefaultPlayerEntity.ts - Default player entity with cosmetics
worlds/entities/EntityManager.ts - Entity lifecycle per world
worlds/entities/EntityModelAnimation.ts - GLTF animation control
worlds/entities/EntityModelNodeOverride.ts - Model node overrides
worlds/entities/controllers/BaseEntityController.ts - Abstract controller base
worlds/entities/controllers/DefaultPlayerEntityController.ts - Default player movement
worlds/entities/controllers/SimpleEntityController.ts - Face/move API
worlds/entities/controllers/PathfindingEntityController.ts - A* pathfinding
```

### Physics

```
worlds/physics/Simulation.ts - Rapier3D wrapper, 60 Hz, raycasts, collision events
worlds/physics/RigidBody.ts - Rigid body types (dynamic, fixed, kinematic)
worlds/physics/Collider.ts - Collider shapes (ball, capsule, cylinder, trimesh, voxels, etc.)
worlds/physics/ColliderMap.ts - Collision callback routing
worlds/physics/CollisionGroupsBuilder.ts - Collision group bitmask builder
```

### Audio / Particles / UI

```
worlds/audios/Audio.ts - Server-side audio definition
worlds/audios/AudioManager.ts - Audio lifecycle per world
worlds/particles/ParticleEmitter.ts - Particle emitter definition
worlds/particles/ParticleEmitterManager.ts - Particle lifecycle per world
worlds/ui/SceneUI.ts - In-world UI element
worlds/ui/SceneUIManager.ts - SceneUI lifecycle per world
worlds/chat/ChatManager.ts - Chat messages + slash commands
```

### Shared / Utilities

```
shared/classes/Vector2.ts, Vector3.ts - Math vectors
shared/classes/Quaternion.ts - Quaternion math
shared/classes/Matrix2.ts, Matrix3.ts, Matrix4.ts - Matrix math
shared/classes/Ticker.ts - Interval ticker
shared/classes/IterationMap.ts - Map with ordered iteration
shared/classes/Ajv.ts - AJV schema validator instance
shared/helpers/msgpackr.ts - msgpackr serialization config
shared/types/Outline.ts - Outline type
shared/types/RgbColor.ts - RGB color type
shared/types/math/QuaternionLike.ts - Quaternion interface
shared/types/math/SpdMatrix3.ts - SPD matrix type
shared/types/math/Vector2Boolean.ts - Per-axis boolean for Vector2
shared/types/math/Vector2Like.ts - Vector2 interface
shared/types/math/Vector3Boolean.ts - Per-axis boolean for Vector3
shared/types/math/Vector3Like.ts - Vector3 interface
```

### Other

```
errors/ErrorHandler.ts - Fatal error handling + crash protection
events/EventRouter.ts - Typed event emitter (eventemitter3)
events/Events.ts - Event payload type definitions
bots/BotManager.ts, bots/BotPlayer.ts - Server-side bot players for perf/stress tests
metrics/Monitor.ts - @Monitor decorators + helper wrappers
metrics/CpuProfiler.ts - V8 CPU profile + heap snapshot capture (debug tooling)
metrics/PerformanceMonitor.ts - Tick profiler + operation percentiles + spikes
metrics/NetworkMetrics.ts - Byte/packet/serialization counters
metrics/Telemetry.ts - Span-based performance profiling
models/ModelRegistry.ts - GLTF model preloading + bounding box extraction
persistence/PersistenceManager.ts - Player/global KV storage via @hytopia.com/save-states
perf/PerfHarness.ts - Env-gated /__perf endpoints for perf-tools
perf/PerfBlockChurner.ts - Tick-driven block churn stressor (perf-tools)
perf/PerfWorldGenerator.ts - Synthetic block-world generator for perf-tools scenarios
perf/perf-harness.ts - Benchmark server entry (build:perf-harness → src/perf-harness.mjs)
server/src/assets/AssetsLibrary.ts - Asset path resolution
```

### Tests

```
test/_setup.ts - Test setup (currently placeholder)
```

## Client (`client/src/`)

### Core

```
Game.ts - Singleton, owns all managers. start() → renderer + network + texture atlas
main.ts - Entry: measures refresh rate, calls Game.instance.start()
core/Renderer.ts - Three.js WebGLRenderer + EffectComposer (SMAA, bloom, outline)
core/Camera.ts - Three.js camera wrapper
core/DebugPanel.ts - Debug overlay
core/DebugRenderer.ts - Physics debug visualization
core/PerformanceMetricsManager.ts - FPS + refresh rate measurement
```

### Network

```
network/NetworkManager.ts - WebTransport (HTTP/3) with WebSocket fallback
network/Deserializer.ts - msgpack packet deserialization + event dispatch
network/Assets.ts - Asset URL resolution
network/Servers.ts - Server connection config
```

### Blocks / Chunks

```
blocks/BlockType.ts, BlockTypeManager.ts, BlockTypeRegistry.ts - Client-side block types
blocks/BlockConstants.ts - Block dimension constants
blocks/BlockMaterialManager.ts - MeshBasicMaterial per block face
blocks/BlockTextureAtlasManager.ts - Texture atlas generation
blocks/utils.ts - Block utilities
chunks/Chunk.ts - Client chunk state
chunks/ChunkManager.ts - Chunk lifecycle (load/unload by distance)
chunks/ChunkMeshManager.ts - Greedy meshing + AO for voxel geometry
chunks/ChunkRegistry.ts - Chunk lookup
chunks/ChunkConstants.ts - Chunk size constants
chunks/ChunkStats.ts - Chunk performance stats
chunks/LightLevelManager.ts, LightLevelVolume.ts - Block light levels
chunks/SkyDistanceVolume.ts, SkyDistanceVolumeManager.ts - Sky distance fog
```

### Entities

```
entities/Entity.ts - Client entity with GLTF model + animations
entities/EntityManager.ts - Entity lifecycle
entities/EntityConstants.ts - Entity config constants
entities/EntityStats.ts - Entity performance stats
entities/StaticEntity.ts, StaticEntityManager.ts - Non-animated entities
```

### Rendering

```
gltf/GLTFManager.ts - GLTF model loading + caching
gltf/GLTFStats.ts - GLTF performance stats
gltf/EmissiveMeshBasicMaterial.ts - Custom emissive material
three/CSS2DRenderer.ts - In-world HTML overlay renderer
three/postprocessing/SelectiveOutlinePass.ts - Selective entity outlines
three/postprocessing/WhiteCoreBloomPass.ts - White-core bloom effect
three/utils.ts - Three.js utilities
```

### Input / Mobile

```
input/InputManager.ts - Keyboard/mouse/gamepad input
mobile/MobileManager.ts - Touch/joystick controls
mobile/utils.ts - Mobile detection utilities
```

### UI

```
ui/UIManager.ts - HTML/CSS overlay UI system
ui/Modal.ts - Modal dialogs
ui/SceneUI.ts - In-world UI elements (CSS2D)
ui/SceneUIStats.ts - SceneUI stats
ui/globals/hytopia.ts - Global hytopia UI library for dev-provided UIs
ui/templates/Nametag.ts - Player nametag template
```

### Other Client Systems

```
arrows/Arrow.ts, ArrowManager.ts, ArrowConstants.ts, ArrowStats.ts - Tutorial arrows
audio/Audio.ts, AudioManager.ts, AudioStats.ts - Spatial audio playback
bridge/BridgeManager.ts - postMessage bridge to hytopia.com iframe
particles/ParticleEmitter.ts, ParticleEmitterCore.ts, ParticlesManager.ts, ParticleEmitterConstants.ts - Particle rendering
players/Player.ts, PlayerManager.ts - Client player state
settings/SettingsManager.ts - Quality presets, view distance, FPS cap
textures/CustomTextureManager.ts - Custom texture handling
services/hytopia/heartbeat.ts - Matchmaking heartbeat
services/hytopia/profanityFilter.ts - Chat profanity filter
services/hytopia/translations.ts - i18n translations
workers/ChunkWorker.ts - Web Worker for chunk mesh generation
workers/ChunkWorkerClient.ts - Main-thread client for chunk worker
workers/ChunkWorkerConstants.ts - Worker constants
workers/BlockTextureAtlasManager.ts - Worker-side texture atlas
```

### Client Config

```
vite.config.js - Vite dev server config + basis transcoder plugin
types/fetch.d.ts - Fetch type augmentation
```

## Protocol (`protocol/`)

### Core

```
index.ts - Package entry
exports.ts - Re-exports
packets/PacketCore.ts - Base packet class
packets/PacketDefinitions.ts - Packet type registry
shared/Ajv.ts - Shared AJV instance
```

### Packets — Inbound (Client → Server)

```
packets/inbound/index.ts - Inbound barrel export
packets/inbound/Input.ts - Player input packet
packets/inbound/ChatMessageSend.ts - Chat message send
packets/inbound/SyncRequest.ts - State sync request
packets/inbound/StateRequest.ts - Full state request
packets/inbound/UIDataSend.ts - UI data from client
packets/inbound/DebugConfig.ts - Debug configuration
```

### Packets — Outbound (Server → Client)

```
packets/outbound/index.ts - Outbound barrel export
packets/outbound/Entities.ts - Entity state updates
packets/outbound/Chunks.ts - Chunk data
packets/outbound/Blocks.ts - Block changes
packets/outbound/BlockTypes.ts - Block type definitions
packets/outbound/Camera.ts - Camera state
packets/outbound/Players.ts - Player state
packets/outbound/Audios.ts - Audio events
packets/outbound/ParticleEmitters.ts - Particle emitter state
packets/outbound/SceneUIs.ts - Scene UI updates
packets/outbound/UIDatas.ts - UI data to client
packets/outbound/ChatMessages.ts - Chat messages
packets/outbound/SyncResponse.ts - Sync response
packets/outbound/World.ts - World state
packets/outbound/Lights.ts - Light state
packets/outbound/UI.ts - UI updates
packets/outbound/PhysicsDebugRender.ts - Physics debug visualization
packets/outbound/PhysicsDebugRaycasts.ts - Physics debug raycasts
packets/outbound/NotificationPermissionRequest.ts - Notification permission
```

### Packets — Bidirectional

```
packets/bidirectional/index.ts - Bidirectional barrel export
packets/bidirectional/Heartbeat.ts - Keep-alive heartbeat
packets/bidirectional/Connection.ts - Connection lifecycle
```

### Schemas (AJV validation)

```
schemas/index.ts - Schema barrel export
schemas/Entity.ts - Entity schema
schemas/Entities.ts - Entities collection schema
schemas/Block.ts - Block schema
schemas/Blocks.ts - Blocks collection schema
schemas/BlockType.ts - Block type schema
schemas/BlockTypes.ts - Block types collection schema
schemas/Chunk.ts - Chunk schema
schemas/Chunks.ts - Chunks collection schema
schemas/Player.ts - Player schema
schemas/Players.ts - Players collection schema
schemas/Audio.ts - Audio schema
schemas/Audios.ts - Audios collection schema
schemas/Camera.ts - Camera schema
schemas/ChatMessage.ts - Chat message schema
schemas/ChatMessages.ts - Chat messages collection schema
schemas/Connection.ts - Connection schema
schemas/DebugConfig.ts - Debug config schema
schemas/Heartbeat.ts - Heartbeat schema
schemas/HexColor.ts - Hex color validation
schemas/Input.ts - Input schema
schemas/Light.ts - Light schema
schemas/Lights.ts - Lights collection schema
schemas/ModelAnimation.ts - Model animation schema
schemas/ModelNodeOverride.ts - Model node override schema
schemas/NotificationPermissionRequest.ts - Notification permission schema
schemas/Outline.ts - Outline schema
schemas/ParticleEmitter.ts - Particle emitter schema
schemas/ParticleEmitters.ts - Particle emitters collection schema
schemas/PhysicsDebugRaycast.ts - Physics debug raycast schema
schemas/PhysicsDebugRaycasts.ts - Physics debug raycasts collection schema
schemas/PhysicsDebugRender.ts - Physics debug render schema
schemas/Quaternion.ts - Quaternion schema
schemas/RgbColor.ts - RGB color schema
schemas/SceneUI.ts - Scene UI schema
schemas/SceneUIs.ts - Scene UIs collection schema
schemas/StateRequest.ts - State request schema
schemas/SyncRequest.ts - Sync request schema
schemas/SyncResponse.ts - Sync response schema
schemas/UI.ts - UI schema
schemas/UIData.ts - UI data schema
schemas/UIDatas.ts - UI datas collection schema
schemas/Vector.ts - Vector schema
schemas/VectorBoolean.ts - Vector boolean schema
schemas/World.ts - World schema
```

## Assets (`assets/`)

```
release/audio/music/ - Background music tracks (mp3)
release/audio/sfx/ - Sound effects organized by category (ambient, damage, dig, entity)
release/blocks/ - Block textures
release/certs/ - SSL certificates
release/icons/ - UI icons
release/maps/ - World map JSON files (boilerplate, boilerplate-small)
release/models/ - GLTF models (players, entities)
release/particles/ - Particle textures
release/skyboxes/ - Skybox textures
release/sounds/ - Additional sound files
release/ui/ - UI assets
player_texture_generator.py - AWS Lambda for compositing player textures (skin + hair + clothing + eyes)
.github/workflows/ - CI: deploy texture generator + asset release publishing
```

## SDK Examples (`sdk-examples/`)

Reference games exercising different engine features. Each is self-contained with its own `package.json` resolving `hytopia` to the local `sdk/` directory.

```
ai-agents/ - AI agent integration
ark-game/ - Survival game
big-world/ - Large world test
block-entity/ - Block-based entities
child-entity/ - Parent/child entity relationships
custom-ui/ - Custom HTML UI
emissive-entity/ - Emissive materials
entity-animations/ - GLTF animation control
entity-controller/ - Custom entity controllers
entity-spawn/ - Entity spawning patterns
frontiers-rpg-game/ - RPG game
hole-in-wall-game/ - Minigame
huntcraft/ - Hunting game
hygrounds/ - Battle royale
interact/ - Entity interaction
mobile-controls/ - Mobile input
particles/ - Particle effects
pathfinding/ - A* pathfinding
payload-game/ - Payload mode
player-persistence/ - Save/load player data
scheduled-notifications/ - Notification scheduling
tutorial-arrows/ - Tutorial arrow system
wall-dodge-game/ - Dodge minigame
world-switching/ - Multi-world transitions
zombies-fps/ - Zombie FPS
```

## Key Patterns

- **Singleton managers** — Most systems use `ClassName.instance` (server) or are owned by the `Game` singleton (client)
- **EventRouter** — Typed event emitter (eventemitter3) used throughout server; client uses similar pattern
- **Dual transport** — WebTransport (QUIC) preferred, WebSocket fallback. Reliable stream + unreliable datagrams
- **msgpackr serialization** — All packets serialized with msgpackr, large payloads gzip-compressed
- **60 Hz physics / 30 Hz network** — Server physics ticks at 60 Hz, network sync flushes every 2 ticks
- **Web Worker meshing** — Client offloads face-culling meshing + AO to a dedicated Web Worker (no greedy quad merging)
