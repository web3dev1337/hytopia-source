# HYTOPIA Engine — Verified Findings Only

Date: 2026-03-02  
Branch: `analysis/codebase-audit`

This document lists **only findings that were manually verified in code** (not “likely”, not “possible”, not “depends” without stating what is strictly verified).

If a risk depends on deployment / embedding policy, the *code-level fact* is still listed, and the dependency is called out explicitly.

---

## Security / Trust Boundaries

### 1) TLS private key committed in-repo (publicly trusted cert, wildcard SAN)

- Evidence: `server/src/networking/ssl/certs.ts:100`
- Verified facts:
  - `SSL_KEY` is a real private key committed directly in source.
  - The corresponding `SSL_CERT` is issued by Amazon and includes SANs for `local.hytopiahosting.com` and `*.dns-is-boring-we-do-ip-addresses.hytopiahosting.com`.
  - Certificate validity window is `2025-11-20` through `2026-12-19`.
- Why it matters:
  - Anyone with this repo contents can impersonate endpoints covered by the wildcard SAN in any context that trusts public CAs.

### 2) Client UI executes fetched HTML and scripts (no sandbox)

- Evidence: `client/src/ui/UIManager.ts:149` and `client/src/ui/UIManager.ts:164`
- Verified facts:
  - The client fetches HTML (`deserializedUI.htmlUri`) and assigns it into the DOM via `innerHTML`.
  - It then executes `<script>` tags via `_executeScripts(...)`.
- Why it matters:
  - This allows arbitrary JS execution in the game iframe context from any server-controlled UI payload (by design/trust model, but it is an execution sink).

### 3) BridgeManager accepts `message` events without origin/source validation

- Evidence: `client/src/bridge/BridgeManager.ts:94` and `client/src/bridge/BridgeManager.ts:152`
- Verified facts:
  - The client subscribes to `window.addEventListener('message', ...)`.
  - `_onParentMessage` does not check `event.origin` and does not check `event.source === window.parent` before handling commands.
- Why it matters:
  - Impact depends on embedding policy (who can iframe the client / who can send messages). The missing validation is a concrete gap regardless.

### 4) GraphQL query builds request by interpolating `userId` into a query string

- Evidence: `server/src/networking/PlatformGateway.ts:198` and `server/src/networking/PlatformGateway.ts:201`
- Verified facts:
  - `getPlayerCosmetics(userId)` interpolates `userId` directly into the GraphQL query string.
- Why it matters:
  - Whether this is exploitable depends on whether `userId` can be attacker-controlled. The interpolation pattern is still a footgun.

---

## Server Bugs

### 5) WebServer asset cache metadata never revalidated after first stat

- Evidence: `server/src/networking/WebServer.ts:241`
- Verified facts:
  - `_assetCache` caches `{ size, etag }` on first access and does not re-stat / invalidate entries when the file changes.
- Why it matters:
  - During dev or when assets change on disk, the server can serve stale `etag` / `content-length` behavior until restarted.

---

## Entity / Gameplay Bugs

### 6) PlayerEntity adds a chat listener on spawn without any removal path

- Evidence: `server/src/worlds/entities/PlayerEntity.ts:132` and `server/src/worlds/entities/PlayerEntity.ts:137`
- Verified facts:
  - `PlayerEntity.spawn()` registers an anonymous `player.on(PlayerEvent.CHAT_MESSAGE_SEND, ...)` handler.
  - There is no corresponding `off(...)` in `PlayerEntity` for despawn/unload.
- Why it matters:
  - Respawn/world-switch patterns can accumulate listeners and stale callbacks.

### 7) DefaultPlayerEntity cosmetics can apply after despawn (async race)

- Evidence: `server/src/worlds/entities/DefaultPlayerEntity.ts:119` and `server/src/worlds/entities/DefaultPlayerEntity.ts:122`
- Verified facts:
  - `DefaultPlayerEntity.spawn()` attaches a `.then(...)` handler to `this.player.cosmetics`.
  - The callback does not check `this.isSpawned` / `this.world` before spawning cosmetic child entities into `world`.
- Why it matters:
  - If the promise resolves after despawn, cosmetic entities can be spawned unexpectedly.

---

## Client Resource Leaks / Performance

### 8) DebugRenderer raycast visualization allocates GPU resources without disposal

- Evidence: `client/src/core/DebugRenderer.ts:48` and `client/src/core/DebugRenderer.ts:63`
- Verified facts:
  - For each debug raycast, the client allocates new `BufferGeometry()` and `LineBasicMaterial()`.
  - It later removes the group from the scene but does not dispose geometry/material resources.
- Why it matters:
  - Over time this can leak WebGL resources in sessions where debug raycasts are emitted frequently.

### 9) Liquid material animation time is frame-rate dependent

- Evidence: `client/src/blocks/BlockMaterialManager.ts:271`
- Verified facts:
  - Liquid shader time uses a fixed per-frame increment (`+= 0.0075`) instead of delta time.
- Why it matters:
  - Animation speed varies with FPS.

### 10) LightLevelVolume packed index helper allocates an object on each call

- Evidence: `client/src/chunks/LightLevelVolume.ts:25`
- Verified facts:
  - `_getPackedIndex()` returns a fresh `{ byteIndex, isHighNibble }` object for each call.
- Why it matters:
  - This adds avoidable allocation churn in tight loops.

---

## Server Performance

### 11) Path reconstruction uses `unshift()` and coordinate keys allocate strings

- Evidence: `server/src/worlds/entities/controllers/PathfindingEntityController.ts:515`
- Verified facts:
  - `_reconstructPath()` calls `path.unshift(...)` inside a loop.
  - `_coordinateToKey()` uses template-string concatenation to build string keys.
- Why it matters:
  - `unshift()` in a loop is O(N²) behavior, and string keys add GC churn in pathfinding hot paths.

