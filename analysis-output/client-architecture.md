# Hytopia Client Architecture Analysis

## 1. Entry Point and Initialization Flow

### main.ts (client/src/main.ts)
- Side-effect imports: heartbeat service, UI globals (hytopia), profanity filter
- Async IIFE: measures refresh rate via `PerformanceMetricsManager.measureRefreshRate()`, then calls `Game.instance.start()`
- Refresh rate measurement fires-and-forgets with `void` + `.catch(console.error)` -- does not block game start

### Game.ts (client/src/Game.ts)
- **Singleton pattern** via private static `_instance` and static `get instance()` (lines 89-95)
- Central orchestrator: constructor instantiates ALL 22+ managers in explicit dependency order
- **Constructor ordering matters**: NetworkManager, SettingsManager, PerformanceMetricsManager, InputManager, Camera, Renderer, ChunkWorkerClient are initialized first (lines 61-67), then all other managers
- Some managers receive `this` (the Game instance), others do not (PerformanceMetricsManager, ChunkWorkerClient, CustomTextureManager, LightLevelManager, SkyDistanceVolumeManager)
- `start()` method (line 123): starts renderer animation loop, connects to network, initializes block texture atlas
- All managers exposed via public readonly getters

**Design pattern**: Service Locator / God Object -- Game acts as both a container and a service locator. Every manager accesses siblings through `this._game.otherManager`.

---

## 2. Rendering Architecture

### Renderer (client/src/core/Renderer.ts)
- Wraps Three.js `WebGLRenderer` with multi-scene architecture:
  - `_scene`: main 3D scene (chunks, entities)
  - `_viewModelScene`: first-person view model (rendered after depth clear for weapon/tool overlay)
  - `_overlayScene`: screen-space overlays (underwater effect quad)
  - `_uiScene`: CSS2D UI elements (nametags)
- **Post-processing pipeline** (lines 206-213):
  1. `RenderPass` (main scene)
  2. `SelectiveOutlinePass` (entity outlines)
  3. `RenderPass` (view model, no clear, depth clear)
  4. `WhiteCoreBloomPass` (custom bloom)
  5. `SMAAPass` (anti-aliasing)
  6. `OutputPass` (final output)
- Post-processing passes are conditionally enabled via `settingsManager.qualityPerfTradeoff`
- **Animation loop** (`_animate`, line 249): uses `requestAnimationFrame`, manual FPS cap via elapsed time comparison
- Frame update order: measure delta -> FPS cap check -> performance update -> settings update -> fog update -> emit Animate event -> update managers (arrows, blocks, camera, audio, skybox, gltf, ui) -> underwater effect -> view model sync -> render
- **Manual matrix management**: all scenes have `matrixAutoUpdate = false` and `matrixWorldAutoUpdate = false` (lines 526-533)
- **Custom transparent sort** (lines 599-617): sorts by groupOrder, renderOrder, then by AABB farthest-point distance to camera
- **Skybox**: custom `SkyboxMaterial` extending `ShaderMaterial` with cube environment mapping and color tinting (lines 66-103)
- Color space: explicit `SRGBColorSpace` output, ambient light colors converted from sRGB to linear
- Fog: Three.js `Fog` with smooth interpolation toward target colors and near/far values
- WebGL context loss handling: modal alert + throws Error (lines 620-624)

### Camera (client/src/core/Camera.ts)
- Dual camera system: `_gameCamera` (attached to player) and `_spectatorCamera` (free-fly)
- Three camera modes: `FIRST_PERSON`, `THIRD_PERSON`, `SPECTATOR` (enum CameraMode)
- **Manual matrix control**: both cameras have `matrixAutoUpdate = false`, `matrixWorldAutoUpdate = false`
- Third-person features: radial zoom (MIN_ZOOM=3, MAX_ZOOM=10), shoulder rotation offset, film offset, collision with blocks via raycasting
- Camera collision smoothing: different speeds for moving in (20.0) vs out (10.0) to reduce jarring jumps (lines 634-635)
- First-person features: forward offset, view model anchoring with base camera offset caching
- Model pitch/yaw with camera: model can be configured to rotate with camera orientation
- FOV, zoom, and film offset use lerp interpolation with `CAMERA_LERP_TIME = 0.2`
- **Working variables pattern**: module-level pre-allocated `Vector3`, `Euler`, `Quaternion` objects reused to avoid GC pressure (lines 16-25)

### DebugPanel (client/src/core/DebugPanel.ts)
- Uses Three.js `Stats` module and `lil-gui` for overlay
- Toggled with backtick/F3 key or 5-finger touch
- Tracks: player position, camera position, server info, WebGL stats, entity stats, chunk stats, glTF stats, scene UI stats, arrow stats, audio stats
- All stats classes follow same pattern: static properties + static `reset()` method

### DebugRenderer (client/src/core/DebugRenderer.ts)
- Renders physics debug data (raycasts, collision shapes) received from server
- Raycasts shown as arrows with blink-then-fade animation (lines 58-66)
- Physics debug wireframes via `LineSegments` with vertex colors

### PerformanceMetricsManager (client/src/core/PerformanceMetricsManager.ts)
- Uses Three.js `Clock` for delta time
- Refresh rate estimation: samples 30 frames, trims outliers (10%), snaps to common rates (30-360Hz)
- Static `measureRefreshRate()` -- result stored in static `_refreshRate`
- Tracks FPS (updated every 1s), delta time, frame count, memory usage (JS heap)

---

## 3. Chunk/Voxel System

### ChunkConstants (client/src/chunks/ChunkConstants.ts)
- `CHUNK_SIZE = 16` (16x16x16 blocks per chunk)
- `BATCH_SIZE = 2` -- 2x2x2 chunks batched for reduced draw calls
- `BATCH_WORLD_SIZE = 32` -- 32 blocks per batch dimension
- Typed IDs: `ChunkId` and `BatchId` as template literal types `${number},${number},${number}`

### Chunk (client/src/chunks/Chunk.ts)
- Represents a 16x16x16 voxel chunk
- Stores blocks as `Uint8Array` (256 possible block type IDs)
- Block rotations stored as sparse `Map<number, number>` (blockIndex to rotationIndex)
- Light sources lazily computed and cached (`_lightSources`)
- **Coordinate utilities** -- all static methods:
  - `globalCoordinateToChunkId`, `globalCoordinateToOriginCoordinate`, `globalCoordinateToLocalCoordinate`
  - Uses bitwise AND for fast modulo with power-of-2 chunk size: `x & ~(CHUNK_SIZE - 1)` (line 61)
  - `worldPositionToGlobalCoordinate`: floor-based conversion
- Batch system: chunks grouped into 2x2x2 batches for mesh batching

### ChunkRegistry (client/src/chunks/ChunkRegistry.ts)
- Registry pattern: stores chunks by ChunkId, tracks batch metadata
- Used by both main thread (ChunkManager) and web worker (ChunkWorker)

### ChunkManager (client/src/chunks/ChunkManager.ts)
- Event-driven: listens to `BlocksPacket`, `ChunksPacket`, `Animate`, `ChunkBatchBuilt`
- On blocks update: updates registry, sends `blocks_update` message to worker
- On chunks packet: registers/removes chunks, determines affected batches, sorts by proximity to player, sends batch build messages to worker
- View distance: per-frame check of batch distance to camera (2D, ignoring Y) (lines 68-88)

### ChunkMeshManager (client/src/chunks/ChunkMeshManager.ts)
- Manages Three.js meshes for chunk batches
- Three mesh types per batch: liquid, opaque solid, transparent solid
- Each mesh type stored in separate `Map<BatchId, Mesh>`
- `createOrUpdateMesh`: creates `BufferGeometry` with position, normal, uv, color, lightLevel, foamLevel attributes
- Meshes have `matrixAutoUpdate = false` (fixed position)
- View distance culling: adds/removes meshes from scene graph (not just visibility toggle) for GPU performance
- Dirty tracking for `solidMeshesInScene` array (used by camera collision raycasting)

### LightLevelManager / LightLevelVolume (client/src/chunks/LightLevelManager.ts, LightLevelVolume.ts)
- Block-based point light system
- Light level volume computed in worker, results stored per-chunk
- Entities query light level from volume for ambient occlusion

### SkyDistanceVolume / SkyDistanceVolumeManager
- Sky distance tracking for ambient lighting on entities
- Computed in worker alongside light levels

---

## 4. Worker Thread Architecture

### ChunkWorker (client/src/workers/ChunkWorker.ts)
- **Web Worker** for CPU-intensive geometry generation
- Runs in separate thread via `new Worker(new URL('./ChunkWorker.ts', import.meta.url), { type: 'module' })`
- Maintains its own copies of: `ChunkRegistry`, `BlockTypeRegistry`, `BlockTextureAtlasManager`
- **Message queue with yielding**: `MAX_CONSECUTIVE_PROCESS_COUNT = 100` to allow message events between batches
- Generates geometry for: chunk batches (liquid/opaque/transparent), block entities, light level volumes, sky distance volumes
- Geometry data: positions, normals, UVs, indices, colors, light levels, foam levels
- Ambient occlusion: per-vertex AO sampling from neighboring blocks
- Sky light: per-vertex sampling from 4 coordinates with weighted blending

### ChunkWorkerClient (client/src/workers/ChunkWorkerClient.ts)
- Main-thread proxy for ChunkWorker
- Posts typed messages to worker, receives results and emits via EventRouter
- String literal URL requirement: `'./ChunkWorker.ts'` must be literal for Vite bundling (line 17 comment)

### ChunkWorkerConstants (client/src/workers/ChunkWorkerConstants.ts)
- Defines all message types between main thread and worker:
  - To worker: `init`, `chunk_update`, `chunk_remove`, `chunk_batch_build`, `blocks_update`, `block_type`, `block_type_update`, `block_entity_build`, `block_texture_atlas_metadata`, `block_texture_atlas_updated`
  - From worker: `chunk_batch_built`, `block_entity_built`, `block_texture_atlas_updated`, `block_texture_atlas_metadata`, `light_level_volume_built`, `sky_distance_volume_built`

---

## 5. Entity System

### Entity (client/src/entities/Entity.ts)
- **Largest file** (~1700 lines) -- handles both glTF and block entities
- Two entity types: glTF model entities (3D models) and block entities (voxel-like)
- **Transform interpolation**: position, rotation, scale interpolated toward targets with configurable time
- Server tick ordering: tracks `_lastPositionUpdateServerTick` and `_lastRotationUpdateServerTick` for unreliable/unordered packet handling
- **Multi-pass update** (called by EntityManager):
  1. `update()`: interpolate position/rotation/scale
  2. `applyViewDistance()`: 2D distance check
  3. `applyFrustumCulling()`: AABB frustum test
  4. `updateAnimationAndLocalMatrix()`: animation mixer update + local matrix
  5. `updateWorldMatrices()`: world matrix propagation
  6. `updateLightLevel()` / `updateSkyLight()`: lighting updates
- **Frame skipping optimization**: far entities skip updates for up to `MAX_UPDATE_SKIP_FRAMES = 4` frames (line 52)
- **glTF model management**:
  - Automatic selection of optimized model variants: base, named-nodes, no-animations
  - `_buildGLTFModel()`: loads via `GLTFManager`, applies materials, animations, node overrides
  - Animation system: `AnimationMixer` with fade in/out blending (`DEFAULT_ANIMATION_BLEND_TIME_S = 0.1`)
  - Additive animation blending support
  - Model node overrides: per-node position/rotation/scale overrides with interpolation
  - Node visibility: camera-based hidden/shown nodes
- **Block entity model**: geometry built by ChunkWorker, texture from atlas
- Custom textures: loaded via `CustomTextureManager`
- Light level: shared uniform data (`LightLevelUniformData`) for shader-based lighting
- Entity-entity attachment: parent-child hierarchy with model-ready listeners
- `_entityRoot`: Three.js `Group` as root, `matrixAutoUpdate = false`
- Custom `userData` for entity ID and effective visibility tracking
- **Emissive support**: per-entity and per-node emissive color/intensity

### EntityManager (client/src/entities/EntityManager.ts)
- Manages all entities in a `Map<EntityId, Entity | StaticEntity>`
- Separate tracking for dynamic entities (`_dynamicEntities: Set<EntityId>`)
- **Seven-pass animation frame update** (lines 165-233):
  1. Local position/rotation update
  2. View distance culling
  3. Frustum culling
  4. Animation + local matrix
  5. World matrices
  6. Light level (conditional on light-emitting blocks)
  7. Sky light
- Entity creation: distinguishes Static Environment Entities (cheaper path) from dynamic entities
- Outline system: per-entity outline options, max `MAX_OUTLINES` concurrent outlines
- Static entities delegated to `StaticEntityManager`

### StaticEntity (client/src/entities/StaticEntity.ts)
- Extends Entity for static environmental entities
- Lower CPU cost path -- no per-frame updates except light level

### StaticEntityManager (client/src/entities/StaticEntityManager.ts)
- Manages static environmental entities with batch operations
- Delegates to GLTFManager for instanced mesh rendering

### EntityConstants (client/src/entities/EntityConstants.ts)
- `EntityId` type alias for number
- `MAX_OUTLINES` constant

### EntityStats (client/src/entities/EntityStats.ts)
- Static class with static numeric properties and `reset()` method
- Tracks: count, staticEnvironmentCount, inViewDistanceCount, frustumCulledCount, updateSkipCount, animationPlayCount, localMatrixUpdateCount, worldMatrixUpdateCount, lightLevelUpdateCount, customTextureCount

---

## 6. Manager Pattern Analysis

Every subsystem follows the **Manager Pattern** consistently:

| Manager | Constructor Receives | Singleton? | EventRouter Listener? |
|---------|---------------------|------------|----------------------|
| Game | (none - is singleton) | Yes (static) | No |
| ArrowManager | Game | No | Yes |
| AudioManager | Game | No | Yes |
| BlockMaterialManager | Game | No | Yes |
| BlockTextureAtlasManager | Game | No | Yes |
| BlockTypeManager | Game | No | Yes |
| BridgeManager | Game | No | Yes |
| ChunkManager | Game | No | Yes |
| ChunkMeshManager | Game | No | No |
| CustomTextureManager | (none) | No | No |
| DebugRenderer | Game | No | Yes |
| EntityManager | Game | No | Yes |
| GLTFManager | Game | No | No |
| InputManager | Game | No | Yes |
| LightLevelManager | (none) | No | No |
| MobileManager | Game | No | No |
| NetworkManager | Game | No | No |
| ParticlesManager | Game | No | Yes |
| PerformanceMetricsManager | (none) | No | No |
| PlayerManager | Game | No | Yes |
| Renderer | Game | No | Yes |
| SettingsManager | Game | No | No |
| SkyDistanceVolumeManager | (none) | No | No |
| UIManager | Game | No | Yes |

**Observations**:
- No dependency injection framework -- all dependencies resolved through Game reference
- Most managers store `_game: Game` as first private field
- Pattern is consistent but creates tight coupling through Game
- Some managers are standalone (no Game reference): PerformanceMetricsManager, CustomTextureManager, LightLevelManager, SkyDistanceVolumeManager, ChunkWorkerClient

---

## 7. Event System

### EventRouter (client/src/events/EventRouter.ts)
- **Singleton** via `public static readonly instance = new EventRouter()` (line 3)
- Simple pub-sub: `on()`, `off()`, `offAll()`, `emit()`
- Uses `Map<string, Set<EventListener>>` for storage
- Error handling: catches and logs errors in listeners (lines 36-38)
- No event priority, no async support, no event cancellation
- Type parameter `TPayload` for generic typing but no runtime enforcement

**Event naming convention**: `NAMESPACE.EVENT_NAME` (e.g., `NETWORK_MANAGER.ENTITIES_PACKET`, `RENDERER.ANIMATE`, `CAMERA.GAME_CAMERA_ORIENTATION_CHANGE`)

**Event type definitions**: Each emitter defines its own enum + namespace:
```typescript
export enum NetworkManagerEventType {
  AudiosPacket = 'NETWORK_MANAGER.AUDIOS_PACKET',
  // ...
}
export namespace NetworkManagerEventPayload {
  export interface IAudiosPacket { deserializedAudios: DeserializedAudios; serverTick: number; }
  // ...
}
```

---

## 8. UI System

### UIManager (client/src/ui/UIManager.ts)
- Manages server-provided HTML UI loaded into `#ui-container` div
- Scene UIs: 3D-positioned UI elements (nametags, health bars)
- **Monkey-patches `EventTarget.prototype.addEventListener`** (lines 20-31) to track elements with click listeners for interact detection
- Reliable click fallback for Safari/WebKit bugs (lines 87-125)
- HTML templates loaded via fetch, scripts re-executed via DOM replacement
- CDN URL template replacement: `{{CDN_ASSETS_URL}}`
- Pending SceneUI queue for templates not yet registered

### SceneUI (client/src/ui/SceneUI.ts)
- 3D-positioned UI using `CSS2DObject` (custom Three.js CSS2D renderer)
- Can attach to entities or fixed world positions
- Template-based rendering via `hytopia.getSceneUITemplateRenderer()`
- View distance culling for performance

### Modal (client/src/ui/Modal.ts)
- `modalAlert()` and `modalPrompt()` -- custom modal implementations
- Used for server connection, error messages

### Nametag (client/src/ui/templates/Nametag.ts)
- Built-in SceneUI template for player/entity nametags

### hytopia global (client/src/ui/globals/hytopia.ts)
- Global `hytopia` object exposed on window
- Provides API for game developers: `onData()`, `offAllData()`, `emitData()`, `sendData()`
- SceneUI template registration: `registerSceneUITemplate()`, `hasSceneUITemplateRenderer()`

---

## 9. Input System

### InputManager (client/src/input/InputManager.ts)
- **Keyboard mapping**: `CODE_TO_KEY_MAP` maps physical key codes to logical keys (layout-independent via `event.code`)
- **Supported inputs**: 20 letter keys, 10 digit keys, space, shift, tab, mouse left, mouse right
- State tracking: `InputState` (boolean per key) + `ContinuousInputState` (camera pitch/yaw, joystick direction)
- **Network batching**: continuous inputs (camera, joystick) batched at 60Hz desktop / 30Hz mobile via `setInterval` (lines 291-302)
- Discrete inputs (key press/release) sent immediately
- Pointer lock: handles unadjusted movement, Linux fallback, Safari quirks
- **Interact system** (lines 343-385): detects tap vs hold vs drag, sends ray origin+direction to server
- Tap detection: max 200ms duration, max 30px movement

---

## 10. Audio System

### AudioManager (client/src/audio/AudioManager.ts)
- Manages `Audio` instances in `Map<number, Audio>`
- Max 64 active audio nodes (`MAX_ACTIVE_NODES = 64`) to prevent browser limits
- LRU cleanup: oldest non-playing nodes disposed first
- Orphaned audio cleanup: every 5 seconds, disposes nodes for despawned entities
- Spatial audio via Three.js `AudioListener` attached to active camera

### Audio (client/src/audio/Audio.ts)
- Wraps Three.js `PositionalAudio` / `Audio`
- Entity attachment: positional audio follows entity position
- Properties: volume, playback rate, detune, distortion, cutoff distance, reference distance
- Start tick synchronization for server-coordinated playback

### AudioStats (client/src/audio/AudioStats.ts)
- Static properties: count, matrixUpdateCount, matrixUpdateSkipCount

---

## 11. Network Layer

### NetworkManager (client/src/network/NetworkManager.ts)
- **Dual transport**: WebTransport (HTTP/3) with WebSocket fallback
- WebTransport: bidirectional reliable stream + unreliable datagrams
- WebSocket: reliable-only binary frames
- **Packet serialization**: msgpackr with FLOAT32_OPTIONS.ALWAYS
- **Compression**: gzip detection via magic number bytes (0x1f, 0x8b), decompressed with fflate
- **Batched packets**: supports both legacy single-packet and batched array format
- Reliable vs unreliable routing: camera movements and joystick sent unreliable, all other inputs reliable
- Reliable packet queue: max 32 pending, drops oldest on overflow
- Heartbeat: 5-second interval
- Sync: 2-second interval for RTT measurement
- RTT: exponential moving average with smoothing factor 0.5
- Server version comparison for feature detection (`isServerAtLeastVersion`)
- Reconnection: iframe-based page reload for full context reset

### Deserializer (client/src/network/Deserializer.ts)
- Static class mapping protocol short keys to readable property names
- Protocol uses single-letter keys (`i`, `p`, `r`, `m`, etc.) for bandwidth efficiency
- Colors: RGB arrays [0-255] -> Three.js Color [0-1]
- Vectors: protocol arrays -> `Vector3Like` objects
- Quaternions: protocol arrays -> `QuaternionLike` objects
- `'in' operator` pattern for distinguishing "not sent" (undefined) from "explicitly null"

### Assets (client/src/network/Assets.ts)
- Static loaders: AudioLoader, TextureLoader, CubeTextureLoader, KTX2Loader, GLTFLoader
- Three.js Cache enabled globally
- CDN URL construction from server hostname
- **Optimized glTF resolution** (`getEffectiveGLTFlUri`): tries `.optimized/` variants with fallbacks
- URL existence check with error caching

### Servers (client/src/network/Servers.ts)
- Server discovery: URL parameter `join=hostname` or modal prompt
- Health check with 8-second timeout using AbortController
- Version compatibility: minimum version check + client compat redirect table
- Local dev support: auto-tries `local.hytopiahosting.com:8080` and `localhost:8080`

---

## 12. glTF/3D Asset Pipeline

### GLTFManager (client/src/gltf/GLTFManager.ts)
- **Instanced mesh rendering**: merges identical meshes across entities into `InstancedMesh`
- Threshold: `USE_INSTANCED_MESH_THRESHOLD = 8` clones before instancing
- Transparent mesh threshold: `USE_INSTANCED_MESH_THRESHOLD_TRANSPARENT = 4`
- Hysteresis: different thresholds for creating (4x) vs deleting (8x) instanced meshes
- **Custom material**: `InstancedMeshBasicMaterial` extending `EmissiveMeshBasicMaterial`
  - Per-instance: opacity, map index (texture array), light level, sky light, emissive color
  - Custom shader injection via string replacement of GLSL code
- **Instanced textures**: `InstancedTexture` (DataArrayTexture) for per-instance texture variation
- Material conversion: `MeshStandardMaterial` -> `EmissiveMeshBasicMaterial` for GPU performance
- Directional face shading: `FACE_SHADE_TOP`, `FACE_SHADE_SIDE`, `FACE_SHADE_BOTTOM` based on world normal Y

### EmissiveMeshBasicMaterial (client/src/gltf/EmissiveMeshBasicMaterial.ts)
- Extends `MeshBasicMaterial` with custom emissive support
- Shader processing hook system for GLSL injection

---

## 13. Block System

### BlockConstants (client/src/blocks/BlockConstants.ts)
- Block type ID as `BlockId` (number, max 255 from Uint8Array)
- Face definitions: top, bottom, left, right, front, back
- Face shading: top=1.0, side=0.85, bottom=0.7
- Block rotation matrices: 24 rotations (cube symmetry group)
- Light level constants: MAX_LIGHT_LEVEL, SKY_LIGHT_MAX_DISTANCE, SKY_LIGHT_BRIGHTNESS_LUT
- Water surface Y offset
- Buffer geometry data types

### BlockType (client/src/blocks/BlockType.ts)
- Data class: id, name, isLiquid, textureUri, lightLevel, trimesh data
- Trimesh: custom collision geometry for non-cube blocks

### BlockTypeManager / BlockTypeRegistry
- Manager: handles network events for block type updates, delegates to registry
- Registry: stores block types by ID, provides lookup

### BlockMaterialManager (client/src/blocks/BlockMaterialManager.ts)
- Creates and manages materials for chunk mesh rendering
- Four material variants: opaque, transparent, opaque non-lit, transparent non-lit
- Liquid material: custom `ShaderMaterial` with wave animation, foam, ambient occlusion
- Solid materials: `MeshBasicMaterial` with custom shader hooks for lighting

### BlockTextureAtlasManager (client/src/blocks/BlockTextureAtlasManager.ts)
- Texture atlas for all block textures
- Packed into single texture for minimal draw calls
- Metadata stored in JSON, loaded by worker and main thread

---

## 14. Particles System

### ParticlesManager (client/src/particles/ParticlesManager.ts)
- Manages particle emitters from server
- Supports attachment to entities/nodes

### ParticleEmitter / ParticleEmitterCore
- GPU-based particle system
- Properties: color, opacity, size interpolation over lifetime
- Orientation modes: billboard, billboardY, fixed, velocity-aligned
- Variance support for randomized particle properties

---

## 15. Players System

### PlayerManager (client/src/players/PlayerManager.ts)
- Tracks connected players by ID
- Handles player join/leave events from server

### Player (client/src/players/Player.ts)
- Data class: id, username, profilePictureUrl

---

## 16. Settings System

### SettingsManager (client/src/settings/SettingsManager.ts)
- **Quality presets**: ULTRA, HIGH, MEDIUM, LOW, LOWEST -- each defines resolution multiplier, view distance, fog, post-processing, environmental animations, FPS cap
- Dynamic quality adjustment based on FPS (auto-downgrade)
- Client settings: mouse sensitivity, touch sensitivity, zoom sensitivity, distant block view mode
- Emits `ClientSettingsEventType.Update` on changes

---

## 17. Mobile Support

### MobileManager (client/src/mobile/MobileManager.ts)
- Static `isMobile` detection using `is-mobile` library + touch/pointer checks
- Virtual joystick via `nipplejs` library
- Move zone: left 40% of screen
- Camera zone: right 60% of screen
- Pinch-to-zoom support for camera
- Force-based walk/run detection: `WALK_FORCE_THRESHOLD = 0.1`, `RUN_FORCE_THRESHOLD = 0.75`

---

## 18. Three.js Extensions

### CSS2DRenderer (client/src/three/CSS2DRenderer.ts)
- Custom CSS2D rendering for HTML elements positioned in 3D space
- Used for nametags and scene UIs

### SelectiveOutlinePass (client/src/three/postprocessing/SelectiveOutlinePass.ts)
- Custom outline post-processing pass
- Supports per-entity outline color, thickness, opacity, occlusion

### WhiteCoreBloomPass (client/src/three/postprocessing/WhiteCoreBloomPass.ts)
- Custom bloom pass with dynamic threshold based on ambient light intensity

### utils.ts (client/src/three/utils.ts)
- `lerp()`, `slerp()`, `lerpColor()`: epsilon-based convergence detection (EPSILON = 0.000001)
- `updateAABB()`: cached AABB computation for transparent sort
- `getTransparentSortKey()`: frame-cached distance key for sort stability

---

## 19. Bridge System

### BridgeManager (client/src/bridge/BridgeManager.ts)
- iframe <-> parent window communication via `postMessage`
- **Parent -> Client**: pointer lock, chat messages, quality presets, volume, sensitivity, debug toggle
- **Client -> Parent**: game ready, chat messages, key events, player updates, reconnect URL
- Typed message system with `BridgeMessageType` enum and `BridgeMessageDataMap` interface

---

## 20. Services

### Heartbeat (client/src/services/hytopia/heartbeat.ts)
- Matchmaking heartbeat service (side-effect import)

### Profanity Filter (client/src/services/hytopia/profanityFilter.ts)
- Initialized on import for chat message filtering

### Translations (client/src/services/hytopia/translations.ts)
- Internationalization support

---

## 21. Key Design Patterns Summary

### 1. Singleton Pattern
- `Game` class: lazy singleton via static getter
- `EventRouter`: eager singleton via static readonly property

### 2. Manager/Service Locator Pattern
- All subsystems are "*Manager" classes instantiated by Game
- Cross-manager access through Game reference: `this._game.entityManager`

### 3. Event-Driven Architecture
- Central `EventRouter` for decoupled communication
- Network packets -> deserialized -> emitted as typed events -> consumed by managers
- Renderer emits `Animate` event each frame for update orchestration

### 4. Working Variables / Object Pooling
- Module-level pre-allocated `Vector3`, `Quaternion`, `Euler`, `Box3`, `Color` objects
- Pattern: `const vec3 = new Vector3()` at module scope, reused across method calls
- Prevents garbage collection pressure in hot paths

### 5. Manual Matrix Management
- `matrixAutoUpdate = false` everywhere
- Matrices updated explicitly only when transforms change
- Multi-pass update in EntityManager ensures correct parent-child ordering

### 6. Worker Thread Pattern
- CPU-intensive geometry generation offloaded to Web Worker
- Main thread and worker maintain parallel data structures (chunk registry, block types)
- Typed message passing with discriminated union types

### 7. Dirty Flag Pattern
- `_solidMeshesInSceneDirty` in ChunkMeshManager
- `_needsMatrixUpdate`, `_needsMatrixWorldUpdate` in Entity
- `_needsLightLevelUpdate`, `_needsSkyLightUpdate` in Entity

### 8. Interpolation Pattern
- Position, rotation, scale, fog, skybox color all use lerp/slerp
- Configurable interpolation time with server-controlled overrides
- Epsilon-based convergence detection to stop interpolation

### 9. View Distance + Frustum Culling
- Two-stage visibility: view distance check (2D, per-frame) then frustum culling
- Scene graph add/remove instead of visibility toggle for GPU optimization

### 10. Protocol Short Keys
- Network protocol uses minimal single/two-letter keys (`i`, `p`, `r`, `m`, `sv`, etc.)
- Deserializer maps to readable names: `entity.i` -> `id`, `entity.p` -> `position`
- `'in' operator` distinguishes "field not sent" from "field sent as null"

---

## 22. State Management

- **No global state store** -- state distributed across manager instances
- Entity state: per-entity fields with dirty tracking
- Network state: last server tick, connection ID, RTT
- Settings state: quality presets, client settings in SettingsManager
- UI state: loaded HTML, scene UIs, pending templates

---

## 23. Memory Management Patterns

- **Audio node pooling**: max 64 active nodes, LRU eviction
- **Geometry disposal**: explicit `geometry.dispose()` in ChunkMeshManager, Entity
- **Material disposal**: explicit in skybox replacement
- **Texture caching**: Three.js Cache.enabled, error cache for URL existence checks
- **WeakMap usage**: `_modelNodeOverrideBaseTransforms` uses WeakMap for automatic cleanup
- **Pending promise tracking**: sets of pending promises (`_pendingGltfs`, `_pendingEffectiveUris`) for race condition handling

---

## 24. File Organization

```
client/src/
  main.ts                    -- Entry point
  Game.ts                    -- Singleton orchestrator
  style.css                  -- Global styles
  arrows/                    -- Arrow rendering (Arrow, ArrowManager, ArrowConstants, ArrowStats)
  audio/                     -- Audio system (Audio, AudioManager, AudioStats)
  blocks/                    -- Block/voxel system (BlockType, managers, constants, utils)
  bridge/                    -- iframe communication (BridgeManager)
  chunks/                    -- Chunk system (Chunk, managers, constants, stats, volumes)
  core/                      -- Core rendering (Camera, Renderer, DebugPanel, DebugRenderer, PerformanceMetricsManager)
  entities/                  -- Entity system (Entity, EntityManager, StaticEntity, StaticEntityManager, constants, stats)
  events/                    -- Event system (EventRouter)
  gltf/                      -- glTF pipeline (GLTFManager, EmissiveMeshBasicMaterial, GLTFStats)
  input/                     -- Input handling (InputManager)
  mobile/                    -- Mobile support (MobileManager, utils)
  network/                   -- Networking (NetworkManager, Deserializer, Assets, Servers)
  particles/                 -- Particle system (ParticleEmitter, ParticleEmitterCore, ParticlesManager, constants)
  players/                   -- Player tracking (Player, PlayerManager)
  services/hytopia/          -- External services (heartbeat, profanityFilter, translations)
  settings/                  -- Settings system (SettingsManager)
  textures/                  -- Custom textures (CustomTextureManager)
  three/                     -- Three.js extensions (CSS2DRenderer, postprocessing, utils)
  types/                     -- TypeScript declarations (fetch.d.ts)
  ui/                        -- UI system (UIManager, Modal, SceneUI, SceneUIStats, globals, templates)
  workers/                   -- Web workers (ChunkWorker, ChunkWorkerClient, ChunkWorkerConstants, BlockTextureAtlasManager)
```
