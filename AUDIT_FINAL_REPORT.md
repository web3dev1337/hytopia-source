# HYTOPIA Engine — Final Audit Report (Consolidated)

Date: 2026-03-02
Source branch: `analysis/codebase-audit`
Source commit: `4dbc73535c163f69e40225c3d50605aaae770d87`

This file consolidates the six audit reports into a single index and captures post-review corrections.
To avoid false statements, every item is labeled with a verification status.

## Reports

- `AUDIT_NETWORKING.md`
- `AUDIT_SERVER_CORE.md`
- `AUDIT_ENTITIES_PLAYERS.md`
- `AUDIT_PHYSICS_WORLDS.md`
- `AUDIT_CLIENT_SYSTEMS.md`
- `AUDIT_CLIENT_RENDERING.md`

## Finding Counts

Total findings indexed: **179**

- AUDIT_NETWORKING.md: 26
- AUDIT_SERVER_CORE.md: 31
- AUDIT_ENTITIES_PLAYERS.md: 27
- AUDIT_PHYSICS_WORLDS.md: 32
- AUDIT_CLIENT_SYSTEMS.md: 35
- AUDIT_CLIENT_RENDERING.md: 28

## Verification Legend

- `[VERIFIED-TRUE]`: manually checked in code at commit `4dbc73535c163f69e40225c3d50605aaae770d87`
- `[VERIFIED-NUANCE]`: sink/pattern is real, but risk depends on threat model or inputs
- `[CORRECTED-FALSE]`: reviewed and corrected as a false positive (or materially misleading)
- `[UNVERIFIED]`: not yet manually confirmed; treat as a hypothesis to validate

## Corrections / Clarifications Applied After Review

These items were updated in-place in their respective audit reports to remove false or overstated claims:

- `AUDIT_SERVER_CORE.md`: `PersistenceManager.setPlayerData Never Persists to Storage` → corrected (SaveStates proxy auto-flush; caveat on load-failure fallback)
- `AUDIT_SERVER_CORE.md`: `PersistenceManager.getGlobalData Crashes on Network Error (null deref)` → reframed (likely throw/reject handling issue, not deterministic null deref)
- `AUDIT_ENTITIES_PLAYERS.md`: `ColliderMap entity entries leak on entity despawn` → corrected (cleanup is queued and drained each physics tick)
- `AUDIT_CLIENT_SYSTEMS.md`: `BridgeManager postMessage uses wildcard origin` → clarified (read-side origin/source validation is the primary issue)
- `AUDIT_NETWORKING.md`: `GraphQL Injection in getPlayerCosmetics` → clarified (string interpolation sink exists; exploitability depends on trust boundary)

## Verified High-Risk Items (Shortlist)

The following are confirmed and worth prioritizing:

- [VERIFIED-TRUE] `SSL_KEY` committed in-repo (publicly trusted cert; wildcard SAN)
- [VERIFIED-TRUE] Client UI pipeline executes fetched HTML + scripts (XSS/trust-model risk)
- [VERIFIED-NUANCE] Bridge message handler accepts commands without origin/source validation
- [VERIFIED-TRUE] PlayerEntity adds chat listener on spawn without removing it on despawn
- [VERIFIED-TRUE] DefaultPlayerEntity cosmetics promise can resolve after despawn and spawn child entities

## Full Findings Index (All Reports)

### AUDIT_NETWORKING.md

- 01. [SECURITY] SSL Private Key Shipped in Source Code — `server/src/networking/ssl/certs.ts:100-127` — [VERIFIED-TRUE]
- 02. [BUG] Asset Cache Serves Stale Data After File Changes — `server/src/networking/WebServer.ts:242-257` — [VERIFIED-TRUE]
- 03. [BUG] WebSocket Reconnection: OPEN Event Race Condition — `server/src/networking/Socket.ts:113-119` — [UNVERIFIED]
- 04. [BUG] Reconnect Window Timer Not Cleared on killDuplicateConnection — `server/src/networking/Connection.ts:346-351` — [UNVERIFIED]
- 05. [PERFORMANCE] Synchronous gzipSync Blocks Event Loop — `server/src/networking/Connection.ts:183` — [UNVERIFIED]
- 06. [PERFORMANCE] Per-Packet Validation in serializePackets is Redundant — `server/src/networking/Connection.ts:156-159` — [UNVERIFIED]
- 07. [BUG] GraphQL Injection in getPlayerCosmetics — `server/src/networking/PlatformGateway.ts:200-201` — [VERIFIED-NUANCE]
- 08. [BUG] WebTransport Writer Not Closed on Cleanup — `server/src/networking/Connection.ts:470-500` — [UNVERIFIED]
- 09. [BUG] WebTransport Session Stream Iterator Never Terminates on Shutdown — `server/src/networking/Socket.ts:198-211` — [UNVERIFIED]
- 10. [PERFORMANCE] Entity Sync Reliable/Unreliable Classification is Fragile — `server/src/networking/NetworkSynchronizer.ts:163-187` — [UNVERIFIED]
- 11. [PERFORMANCE] onPacket Registers a New Listener Per Packet Type Without Filtering — `server/src/networking/Connection.ts:361-367` — [UNVERIFIED]
- 12. [BUG] _onClose Fires Multiple Times for Dual-Transport Connections — `server/src/networking/Connection.ts:456-461` — [UNVERIFIED]
- 13. [PERFORMANCE] Stale Asset Cache Grows Unbounded — `server/src/networking/WebServer.ts:121` — [UNVERIFIED]
- 14. [BUG] WebSocket send() Can Throw on Closed Connection — `server/src/networking/Connection.ts:421` — [UNVERIFIED]
- 15. [PERFORMANCE] Unframer Allocates 512KB Buffer Per WebTransport Connection — `protocol/packets/PacketCore.ts:108` — [UNVERIFIED]
- 16. [BUG] _handleReconnect Returns True for New Transport Bindings (Not Just Reconnections) — `server/src/networking/Connection.ts:521-530` — [UNVERIFIED]
- 17. [PERFORMANCE] Heartbeat Creates a New Packet Array on Every Beat — `server/src/networking/Connection.ts:434-439` — [UNVERIFIED]
- 18. [FEATURE] No Rate Limiting on Inbound Packets — `server/src/networking/Connection.ts:441-454` — [UNVERIFIED]
- 19. [FEATURE] No Maximum Message Size Enforcement for WebSocket — `server/src/networking/Socket.ts:66` — [UNVERIFIED]
- 20. [BUG] PlatformGateway GraphQL WebSocket Connection Never Closes — `server/src/networking/PlatformGateway.ts:108-111` — [UNVERIFIED]
- 21. [PERFORMANCE] NetworkSynchronizer Player Join Sends Full World State Without Chunking — `server/src/networking/NetworkSynchronizer.ts:1084-1148` — [UNVERIFIED]
- 22. [BUG] CORS Allows All Origins — `server/src/networking/WebServer.ts:84` — [UNVERIFIED]
- 23. [PERFORMANCE] serializePackets Cache Keyed by Array Identity, Not Content — `server/src/networking/Connection.ts:167` — [UNVERIFIED]
- 24. [BUG] WebServer.stop() Does Not Clean Up _server Reference — `server/src/networking/WebServer.ts:176-186` — [VERIFIED-TRUE]
- 25. [FEATURE] No Backpressure Handling for WebTransport Writes — `server/src/networking/Connection.ts:412-418` — [UNVERIFIED]
- 26. [PERFORMANCE] msgpackr Float32 Quantization Reduces Precision — `server/src/shared/helpers/msgpackr.ts:7` — [UNVERIFIED]

### AUDIT_SERVER_CORE.md

- 01. [BUG] PersistenceManager.setPlayerData Never Persists to Storage — server/src/persistence/PersistenceManager.ts:115-121 — [CORRECTED-FALSE]
- 02. [BUG] PersistenceManager.getGlobalData Crashes on Network Error (null deref) — server/src/persistence/PersistenceManager.ts:56-71 — [VERIFIED-NUANCE]
- 03. [BUG] ErrorHandler.enableCrashProtection Registers Duplicate Handlers on Multiple Calls — server/src/errors/ErrorHandler.ts:108-122 — [UNVERIFIED]
- 04. [BUG] Ticker._tick Swallows Non-Error Exceptions Silently — server/src/shared/classes/Ticker.ts:172-181 — [UNVERIFIED]
- 05. [BUG] EventRouter.emit Returns True Even When Final Listener Throws — server/src/events/EventRouter.ts:46-57 — [UNVERIFIED]
- 06. [BUG] SceneUI Constructor Rejects Valid Configurations (Neither Entity Nor Position) — server/src/worlds/ui/SceneUI.ts:140 — [UNVERIFIED]
- 07. [PERFORMANCE] ModelRegistry.preloadModels Loads Models Sequentially — server/src/models/ModelRegistry.ts:181-187 — [UNVERIFIED]
- 08. [PERFORMANCE] ModelRegistry._calculateChecksum Reads Entire File + Base64 Encodes — server/src/models/ModelRegistry.ts:545-553 — [UNVERIFIED]
- 09. [PERFORMANCE] AudioManager/SceneUIManager/ParticleEmitterManager Entity Lookups Use Linear Scan — server/src/worlds/audios/AudioManager.ts:74-76 — [UNVERIFIED]
- 10. [PERFORMANCE] BlockTextureRegistry._createPaddedTexture Iterates All Pixels Including Interior — server/src/textures/BlockTextureRegistry.ts:329-337 — [UNVERIFIED]
- 11. [PERFORMANCE] Telemetry.getProcessStats Called Twice for Slow Ticks — server/src/metrics/Telemetry.ts:163-167 — [UNVERIFIED]
- 12. [BUG] ModelRegistry._preprocessOptimizableModel Temp Files Can Collide — server/src/models/ModelRegistry.ts:778-781 — [UNVERIFIED]
- 13. [BUG] ModelRegistry._optimizeModel Returns inputPath on First Run Failure, Skipping Remaining Runs — server/src/models/ModelRegistry.ts:678-681 — [UNVERIFIED]
- 14. [BUG] Audio.setPosition Shallow-Compares Object References — server/src/worlds/audios/Audio.ts:423 — [UNVERIFIED]
- 15. [FEATURE] EventRouter Has No Way to Remove All Listeners for a Specific Instance — server/src/events/EventRouter.ts — [UNVERIFIED]
- 16. [FEATURE] ChatManager Command Registration Has No Duplicate Protection — server/src/worlds/chat/ChatManager.ts:114-116 — [UNVERIFIED]
- 17. [FEATURE] ChatManager Has No Command Validation or Sanitization — server/src/worlds/chat/ChatManager.ts:164-175 — [UNVERIFIED]
- 18. [PERFORMANCE] ModelRegistry Reads Source File Twice During Data Regeneration — server/src/models/ModelRegistry.ts:427-456 — [UNVERIFIED]
- 19. [BUG] startServer Uses init.length for Arity Detection (Unreliable with Default Parameters) — server/src/GameServer.ts:74 — [UNVERIFIED]
- 20. [BUG] Ticker Accumulator Can Cause Dropped Ticks When TICK_SLOW_UPDATE_CAP < MAX_ACCUMULATOR_TICK_MULTIPLE — server/src/shared/classes/Ticker.ts:4-5, 125-137 — [UNVERIFIED]
- 21. [BUG] ErrorHandler Crash Protection Calls process.exit After 1 Second Regardless of Recovery — server/src/errors/ErrorHandler.ts:117-118 — [UNVERIFIED]
- 22. [PERFORMANCE] Vector3/Quaternion Extend Float32Array (Allocation Cost) — server/src/shared/classes/Vector3.ts, Quaternion.ts — [UNVERIFIED]
- 23. [BUG] ModelRegistry._optimizeModel Writes Checksum Even When UASTC Compression Fails — server/src/models/ModelRegistry.ts:695-703 — [UNVERIFIED]
- 24. [FEATURE] AudioManager Never Cleans Up Non-Looping Audio That Finishes Playing — server/src/worlds/audios/AudioManager.ts — [UNVERIFIED]
- 25. [BUG] Ajv Singleton Inconsistency: Class and Static Instance Are Different — server/src/shared/classes/Ajv.ts:12-16 — [UNVERIFIED]
- 26. [FEATURE] PersistenceManager.setGlobalData Has No Retry Logic Unlike getGlobalData — server/src/persistence/PersistenceManager.ts:104-112 — [UNVERIFIED]
- 27. [FEATURE] SceneUI State Merge Is Shallow Only — server/src/worlds/ui/SceneUI.ts:273-274 — [UNVERIFIED]
- 28. [BUG] EventRouter.emit listenerCount Check Disagrees with Actual Emission — server/src/events/EventRouter.ts:47 — [UNVERIFIED]
- 29. [PERFORMANCE] BlockTextureRegistry.preloadAtlas Loads All Textures Into Memory At Once — server/src/textures/BlockTextureRegistry.ts:168-179 — [UNVERIFIED]
- 30. [FEATURE] ModelRegistry Has No Way to Register Models at Runtime — server/src/models/ModelRegistry.ts — [UNVERIFIED]
- 31. [BUG] AssetsLibrary.syncAsset Uses Relative Path Without CWD Context — server/src/assets/AssetsLibrary.ts:72-73 — [UNVERIFIED]

### AUDIT_ENTITIES_PLAYERS.md

- 01. [BUG] ColliderMap entity entries leak on entity despawn — server/src/worlds/entities/Entity.ts:1323 (spawn) and server/src/worlds/entities/Entity.ts:782 (despawn) — [CORRECTED-FALSE]
- 02. [BUG] PlayerEntity.spawn() leaks event listener on player — server/src/worlds/entities/PlayerEntity.ts:137 — [VERIFIED-TRUE]
- 03. [BUG] DefaultPlayerEntity cosmetics applied after despawn (race condition) — server/src/worlds/entities/DefaultPlayerEntity.ts:122 — [VERIFIED-TRUE]
- 04. [BUG] EntityManager._nextEntityId monotonically increases (no recycling) — server/src/worlds/entities/EntityManager.ts:66 — [UNVERIFIED]
- 05. [PERFORMANCE] PathfindingEntityController._reconstructPath uses array.unshift() in loop — server/src/worlds/entities/controllers/PathfindingEntityController.ts:516-525 — [VERIFIED-TRUE]
- 06. [PERFORMANCE] PathfindingEntityController._coordinateToKey creates strings per call — server/src/worlds/entities/controllers/PathfindingEntityController.ts:528-530 — [VERIFIED-TRUE]
- 07. [PERFORMANCE] PathfindingEntityController._findGroundedStart allocates spread objects in loop — server/src/worlds/entities/controllers/PathfindingEntityController.ts:651-666 — [UNVERIFIED]
- 08. [PERFORMANCE] EntityManager query methods allocate arrays every call — server/src/worlds/entities/EntityManager.ts:97-213 — [UNVERIFIED]
- 09. [BUG] DefaultPlayerEntityController ground contact count can go negative — server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:503 — [UNVERIFIED]
- 10. [BUG] DefaultPlayerEntityController._stepAudio not cleaned up on detach/despawn — server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:414-421 — [UNVERIFIED]
- 11. [BUG] Player.joinWorld() world switch calls disconnect which triggers LEFT_WORLD twice — server/src/players/Player.ts:295-321 — [UNVERIFIED]
- 12. [BUG] SimpleEntityController.tick() face yaw extraction is approximate — server/src/worlds/entities/controllers/SimpleEntityController.ts:487-489 — [UNVERIFIED]
- 13. [PERFORMANCE] DefaultPlayerEntityController.tickWithPlayerInput allocates objects per tick — server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:565-789 — [UNVERIFIED]
- 14. [BUG] Entity.setModelScale division by zero when current scale component is 0 — server/src/worlds/entities/Entity.ts:1041-1045 — [UNVERIFIED]
- 15. [BUG] PathfindingEntityController setTimeout leaks if entity despawns during jump delay — server/src/worlds/entities/controllers/PathfindingEntityController.ts:571-601 — [UNVERIFIED]
- 16. [PERFORMANCE] EntityManager.getEntityChildren scans all entities O(N) — server/src/worlds/entities/EntityManager.ts:203-213 — [UNVERIFIED]
- 17. [BUG] Player._onInputPacket sequence number check allows replay on wrap — server/src/players/Player.ts:522-525 — [UNVERIFIED]
- 18. [BUG] PlayerEntity.tick has unnecessary semicolon after return guard — server/src/worlds/entities/PlayerEntity.ts:146 — [UNVERIFIED]
- 19. [FEATURE] Entity despawn should clear all event listeners to prevent leaks — server/src/worlds/entities/Entity.ts:782-809 — [UNVERIFIED]
- 20. [FEATURE] PlayerUI.sendData and PlayerUI.load lack input validation — server/src/players/PlayerUI.ts:97-210 — [UNVERIFIED]
- 21. [FEATURE] PathfindingEntityController path caching for repeated destinations — server/src/worlds/entities/controllers/PathfindingEntityController.ts:284-308 — [UNVERIFIED]
- 22. [PERFORMANCE] PathfindingEntityController A* pushes duplicate entries to open set — server/src/worlds/entities/controllers/PathfindingEntityController.ts:495 — [UNVERIFIED]
- 23. [FEATURE] Entity re-spawn support — server/src/worlds/entities/Entity.ts:1323-1388 — [UNVERIFIED]
- 24. [BUG] DefaultPlayerEntityController.attach monkey-patches entity.applyImpulse permanently — server/src/worlds/entities/controllers/DefaultPlayerEntityController.ts:405-412 — [UNVERIFIED]
- 25. [BUG] Entity.spawn registers colliders in colliderMap but child-added colliders from controllers are not — server/src/worlds/entities/Entity.ts:1383-1385 and controllers/DefaultPlayerEntityController.ts:478-535 — [UNVERIFIED]
- 26. [PERFORMANCE] Entity.modelAnimations and Entity.modelNodeOverrides return new arrays every access — server/src/worlds/entities/Entity.ts:593 and 604 — [UNVERIFIED]
- 27. [BUG] Player.interact only raycasts against the first player entity — server/src/players/Player.ts:542 — [UNVERIFIED]

### AUDIT_PHYSICS_WORLDS.md

- 01. [PERFORMANCE] Ticker uses setTimeout for 60 Hz loop - inherent jitter — `server/src/shared/classes/Ticker.ts:147` — [UNVERIFIED]
- 02. [PERFORMANCE] Trimesh collider fully recreated on every single block edit — `server/src/worlds/blocks/ChunkLattice.ts:457-461` and `server/src/worlds/blocks/ChunkLattice.ts:485-487` — [UNVERIFIED]
- 03. [PERFORMANCE] `_combineVoxelStates` is O(N^2) in number of block types — `server/src/worlds/blocks/ChunkLattice.ts:507-514` — [UNVERIFIED]
- 04. [BUG] `Chunk.globalCoordinateToOriginCoordinate` fails for negative coordinates — `server/src/worlds/blocks/Chunk.ts:132-138` — [UNVERIFIED]
- 05. [BUG] `globalCoordinateToLocalCoordinate` silently produces wrong results for non-integer inputs — `server/src/worlds/blocks/Chunk.ts:116-122` — [UNVERIFIED]
- 06. [PERFORMANCE] `_propagateVoxelChange` iterates ALL block type colliders for every single block edit — `server/src/worlds/blocks/ChunkLattice.ts:517-524` — [UNVERIFIED]
- 07. [PERFORMANCE] `getAllChunks()` and `getAllWorlds()` create new arrays every call — `server/src/worlds/blocks/ChunkLattice.ts:268` and `server/src/worlds/WorldManager.ts:116` — [UNVERIFIED]
- 08. [BUG] `RigidBody.removeFromSimulation` nullifies `_rigidBodyDesc`, making body non-reusable — `server/src/worlds/physics/RigidBody.ts:1490-1505` — [UNVERIFIED]
- 09. [BUG] World.stop() does not clean up entities, physics, or sub-managers — `server/src/worlds/World.ts:787-796` — [UNVERIFIED]
- 10. [PERFORMANCE] Telemetry spans created every single tick even when telemetry is disabled — `server/src/worlds/WorldLoop.ts:157-187` — [UNVERIFIED]
- 11. [PERFORMANCE] Simulation event emission on every step even without listeners — `server/src/worlds/physics/Simulation.ts:516-544` — [UNVERIFIED]
- 12. [PERFORMANCE] `getWorldsByTag` does linear scan of all worlds — `server/src/worlds/WorldManager.ts:151-161` — [UNVERIFIED]
- 13. [BUG] `ColliderMap` double-buffered cleanup may miss rapid add-remove-add sequences — `server/src/worlds/physics/ColliderMap.ts:134-211` — [UNVERIFIED]
- 14. [BUG] `setBlock` early-return skips rotation-only changes when same blockTypeId — `server/src/worlds/blocks/ChunkLattice.ts:430` — [UNVERIFIED]
- 15. [FEATURE] No way to remove/destroy a world from WorldManager — `server/src/worlds/WorldManager.ts` — [UNVERIFIED]
- 16. [PERFORMANCE] BigInt chunk keys have overhead vs integer keys — `server/src/worlds/blocks/ChunkLattice.ts:615-621` — [UNVERIFIED]
- 17. [PERFORMANCE] `_getBlockTypePlacements` iterates all chunk masks with bit scanning — `server/src/worlds/blocks/ChunkLattice.ts:556-601` — [UNVERIFIED]
- 18. [BUG] `MAX_BLOCK_TYPE_ID = 255` limits world to 255 block types — `server/src/worlds/blocks/Chunk.ts:21` — [UNVERIFIED]
- 19. [PERFORMANCE] BLOCK_ROTATIONS_BY_INDEX sorted on every loadMap call — `server/src/worlds/World.ts:514` — [UNVERIFIED]
- 20. [BUG] Raycast epsilon adjustment assumes axis-aligned ray directions — `server/src/worlds/physics/Simulation.ts:455-464` — [UNVERIFIED]
- 21. [PERFORMANCE] `_applyRigidBodyOptions` and `_applyColliderOptions` create arrays of bound functions — `server/src/worlds/physics/RigidBody.ts:1601-1627` and `server/src/worlds/physics/Collider.ts:1572-1593` — [UNVERIFIED]
- 22. [BUG] No validation of collision group values in `CollisionGroupsBuilder` — `server/src/worlds/physics/CollisionGroupsBuilder.ts:97-100` — [UNVERIFIED]
- 23. [PERFORMANCE] `intersectionsWithRawShape` deduplicates using a Set but creates objects for every result — `server/src/worlds/physics/Simulation.ts:372-407` — [UNVERIFIED]
- 24. [FEATURE] No world-level entity spatial query (nearest entity, entities in radius) — `server/src/worlds/World.ts` — [UNVERIFIED]
- 25. [PERFORMANCE] Ticker accumulator clamp may lose time under sustained load — `server/src/shared/classes/Ticker.ts:125-127` — [UNVERIFIED]
- 26. [BUG] `_requireNotRemoved` in RigidBody uses `ErrorHandler.error` (non-fatal) but returns boolean — `server/src/worlds/physics/RigidBody.ts:1733-1738` — [UNVERIFIED]
- 27. [BUG] `World.loadMap` entities spawn during construction before world starts — `server/src/worlds/World.ts:327-329` and `server/src/worlds/World.ts:557-573` — [UNVERIFIED]
- 28. [FEATURE] No block-level metadata or per-block events — `server/src/worlds/blocks/Chunk.ts` and `server/src/worlds/blocks/BlockType.ts` — [UNVERIFIED]
- 29. [PERFORMANCE] `_onCollisionEvent` and `_onContactForceEvent` do redundant lookups — `server/src/worlds/physics/Simulation.ts:548-567` and `server/src/worlds/physics/Simulation.ts:570-593` — [UNVERIFIED]
- 30. [PERFORMANCE] ChunkLattice rigid body created lazily but never removed — `server/src/worlds/blocks/ChunkLattice.ts:340-343` and `server/src/worlds/blocks/ChunkLattice.ts:434-437` — [UNVERIFIED]
- 31. [BUG] `newCount` calculation in `setBlock` removal path has off-by-one potential — `server/src/worlds/blocks/ChunkLattice.ts:441` — [UNVERIFIED]
- 32. [FEATURE] No chunk unloading for distant/empty chunks — `server/src/worlds/blocks/ChunkLattice.ts` — [UNVERIFIED]

### AUDIT_CLIENT_SYSTEMS.md

- 01. [BUG] BridgeManager postMessage uses wildcard origin -- security risk — `client/src/bridge/BridgeManager.ts:220` — [VERIFIED-NUANCE]
- 02. [BUG] UIManager innerHTML injection allows XSS from server-controlled HTML — `client/src/ui/UIManager.ts:164` — [VERIFIED-TRUE]
- 03. [BUG] Monkey-patched addEventListener does not track removeEventListener — `client/src/ui/UIManager.ts:20-31` — [UNVERIFIED]
- 04. [PERFORMANCE] Deserializer creates many intermediate objects per packet — `client/src/network/Deserializer.ts:274-642` — [UNVERIFIED]
- 05. [BUG] Input sequence numbers increment even when not sent — `client/src/network/NetworkManager.ts:200-206` — [UNVERIFIED]
- 06. [BUG] WebSocket connection promise never rejects on failure — `client/src/network/NetworkManager.ts:325-342` — [UNVERIFIED]
- 07. [BUG] setInterval timers in NetworkManager leak on reconnect — `client/src/network/NetworkManager.ts:156-157` — [UNVERIFIED]
- 08. [BUG] Reliable WebTransport packet queue drops silently on overflow — `client/src/network/NetworkManager.ts:222-225` — [UNVERIFIED]
- 09. [PERFORMANCE] InputManager sends discrete input changes immediately, no batching — `client/src/input/InputManager.ts:337-339` — [UNVERIFIED]
- 10. [BUG] Mobile camera cleanup clears all camera positions when one finger lifts — `client/src/mobile/MobileManager.ts:143-147` — [UNVERIFIED]
- 11. [BUG] SceneUI viewDistance of 0 cannot be set (falsy check) — `client/src/ui/UIManager.ts:291-293` — [UNVERIFIED]
- 12. [BUG] AudioManager uses truthy checks for volume/playbackRate/offset, skipping value 0 — `client/src/audio/AudioManager.ts:87-101` — [UNVERIFIED]
- 13. [BUG] Nametag chat message XSS vector via innerHTML-adjacent patterns — `client/src/ui/templates/Nametag.ts:62` — [UNVERIFIED]
- 14. [BUG] Assets.urlExists caches errors permanently (rejected promises cached forever) — `client/src/network/Assets.ts:88-106` — [UNVERIFIED]
- 15. [BUG] EntityManager._updateEntity processes updates on already-removed entities — `client/src/entities/EntityManager.ts:316-420` — [UNVERIFIED]
- 16. [PERFORMANCE] EntityManager.findEntityByName is O(n) linear scan — `client/src/entities/EntityManager.ts:72-79` — [UNVERIFIED]
- 17. [BUG] Modal overlay does not prevent body scrolling on mobile — `client/src/ui/Modal.ts:17-107` — [UNVERIFIED]
- 18. [BUG] PlayerManager never cleans up player data, grows unbounded — `client/src/players/PlayerManager.ts:33-56` — [UNVERIFIED]
- 19. [PERFORMANCE] AudioManager._cleanupIfNeeded creates a full array on every audio update — `client/src/audio/AudioManager.ts:135-141` — [UNVERIFIED]
- 20. [PERFORMANCE] SettingsManager._levelChangeHistory grows unbounded — `client/src/settings/SettingsManager.ts:232` — [UNVERIFIED]
- 21. [BUG] Heartbeat service starts unconditionally on module load, no cleanup — `client/src/services/hytopia/heartbeat.ts:60` — [UNVERIFIED]
- 22. [BUG] CustomTextureManager.load promise never resolves on texture load failure — `client/src/textures/CustomTextureManager.ts:54-79` — [UNVERIFIED]
- 23. [FEATURE] Input does not support key rebinding — `client/src/input/InputManager.ts:57-96` — [UNVERIFIED]
- 24. [FEATURE] No client-side prediction or reconciliation for player movement — `client/src/input/InputManager.ts:287-303` — [UNVERIFIED]
- 25. [BUG] Keyboard input with Shift key can double-fire due to both code and key mapping — `client/src/input/InputManager.ts:89-143` — [UNVERIFIED]
- 26. [BUG] Translations service initializes with hardcoded production URL — `client/src/services/hytopia/translations.ts:4` — [UNVERIFIED]
- 27. [PERFORMANCE] ParticleEmitter._updatePosition always updates matrix even when nothing changed — `client/src/particles/ParticleEmitter.ts:211-226` — [UNVERIFIED]
- 28. [BUG] Arrow constructor error messages reference wrong field names — `client/src/arrows/Arrow.ts:70-71, 76-77` — [UNVERIFIED]
- 29. [PERFORMANCE] Deserializer.deserializeBlocks/Chunks/etc use .map() creating intermediate arrays — `client/src/network/Deserializer.ts:297-374` — [UNVERIFIED]
- 30. [BUG] SceneUI removeFromScene does not clean up containerDiv or template DOM — `client/src/ui/SceneUI.ts:142-144` — [UNVERIFIED]
- 31. [BUG] SettingsManager quality adjustment has unreachable else branch — `client/src/settings/SettingsManager.ts:272` — [UNVERIFIED]
- 32. [BUG] EntityStats.reset() clears frustumCulledCount twice — `client/src/entities/EntityStats.ts:22, 27` — [UNVERIFIED]
- 33. [BUG] StaticEntity.updateLightLevel recalculates globalCoordinate from position that never changes — `client/src/entities/StaticEntity.ts:136-147` — [UNVERIFIED]
- 34. [FEATURE] Mobile pinch-to-zoom should support touchpad two-finger gestures on desktop — `client/src/mobile/MobileManager.ts` — [UNVERIFIED]
- 35. [PERFORMANCE] HytopiaUI.emitData iterates all callbacks even if data is targeted — `client/src/ui/globals/hytopia.ts:138-142` — [UNVERIFIED]

### AUDIT_CLIENT_RENDERING.md

- 01. PERFORMANCE — No greedy meshing in ChunkWorker — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 02. PERFORMANCE — ChunkWorker uses number[] arrays for geometry, then converts — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 03. PERFORMANCE — BoundaryVolume uses string-key Map for block lookups — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 04. PERFORMANCE — No frustum culling for chunk batch meshes — client/src/chunks/ChunkMeshManager.ts — [UNVERIFIED]
- 05. BUG — DebugRenderer leaks geometries and materials — client/src/core/DebugRenderer.ts — [VERIFIED-TRUE]
- 06. BUG — Liquid material time increment is frame-rate dependent — client/src/blocks/BlockMaterialManager.ts — [VERIFIED-TRUE]
- 07. PERFORMANCE — Every-frame batch view distance check iterates all batches — client/src/chunks/ChunkManager.ts — [UNVERIFIED]
- 08. PERFORMANCE — LightLevelVolume._getPackedIndex allocates object per call — client/src/chunks/LightLevelVolume.ts — [VERIFIED-TRUE]
- 09. PERFORMANCE — AO cache in ChunkWorker uses linear scan of parallel arrays — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 10. PERFORMANCE — Light level calculation iterates all nearby light sources per block — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 11. PERFORMANCE — _clearNearbyLightSourceCache does cubic chunk iteration — client/src/workers/ChunkWorker.ts — [UNVERIFIED]
- 12. PERFORMANCE — GLTFManager copies all instance attributes every frame — client/src/gltf/GLTFManager.ts — [UNVERIFIED]
- 13. PERFORMANCE — ChunkMeshManager creates new BufferGeometry per update — client/src/chunks/ChunkMeshManager.ts — [UNVERIFIED]
- 14. FEATURE — No LOD system for distant chunks — client/src/three/postprocessing/SelectiveOutlinePass.ts — [UNVERIFIED]
- 15. PERFORMANCE — Outline pass 8-direction per-pixel search — client/src/three/postprocessing/SelectiveOutlinePass.ts — [UNVERIFIED]
- 16. PERFORMANCE — Camera allocates vectors per frame in update methods — client/src/core/Camera.ts — [UNVERIFIED]
- 17. PERFORMANCE — Chunk.getLightSources iterates all 4096 blocks — client/src/chunks/Chunk.ts — [UNVERIFIED]
- 18. PERFORMANCE — CompressedTexture readback renders to screen then reads pixels — client/src/gltf/GLTFManager.ts — [UNVERIFIED]
- 19. PERFORMANCE — Legacy BlockTextureAtlasManager has O(n) brute-force space finding — client/src/workers/BlockTextureAtlasManager.ts — [UNVERIFIED]
- 20. PERFORMANCE — ChunkRegistry.getBatchChunkIds creates new array each call — client/src/chunks/ChunkRegistry.ts — [UNVERIFIED]
- 21. BUG — PerformanceMetricsManager has double semicolon — client/src/core/PerformanceMetricsManager.ts — [UNVERIFIED]
- 22. PERFORMANCE — CSS2DRenderer builds transform strings every frame — client/src/three/CSS2DRenderer.ts — [UNVERIFIED]
- 23. PERFORMANCE — Post-processing chain runs all passes unconditionally — client/src/core/Renderer.ts — [UNVERIFIED]
- 24. FEATURE — Transparent instanced mesh flicker at threshold boundary — client/src/gltf/GLTFManager.ts — [UNVERIFIED]
- 25. FEATURE — No transparent instance sorting within InstancedMesh — client/src/gltf/GLTFManager.ts — [UNVERIFIED]
- 26. PERFORMANCE — GLTFManager clones geometry for each InstancedMesh resize — client/src/gltf/GLTFManager.ts — [UNVERIFIED]
- 27. PERFORMANCE — Block data not transferred (copied) between main thread and worker — client/src/workers/ChunkWorkerConstants.ts — [UNVERIFIED]
- 28. PERFORMANCE — View model scene rendered separately adds extra render pass — client/src/core/Renderer.ts — [UNVERIFIED]

