# HYTOPIA Engine

## READ THESE ENTIRE DOCUMENTS BEFORE DOING ANYTHING

1. **Read `CODEBASE_DOCUMENTATION.md` NOW** — Complete file inventory for server, client, protocol, assets, and examples. Do NOT grep blindly for files. Read this first so you know where everything lives.
2. **Read `README.md`** — Architecture overview, quick start, SDK build pipeline.

> **Update before PR:** If you added/deleted/moved files, update CODEBASE_DOCUMENTATION.md before creating a PR.

## Overview

HYTOPIA is a multiplayer voxel game engine monorepo. The **server** (TypeScript/Bun) runs Rapier3D physics at 60 Hz and syncs state to browser **clients** (Three.js) at 30 Hz over WebTransport/WebSocket. The server compiles into the public [HYTOPIA SDK](https://github.com/hytopiagg/sdk) (`npm install hytopia`). Game developers write server-side logic using the SDK; the client is deployed to `play.hytopia.com`.

## Architecture

- **Monorepo**: `server/`, `client/`, `protocol/`, `sdk/` (submodule), `sdk-examples/`, `assets/`
- **Server entry**: `server/src/index.ts` (SDK barrel export), `server/src/GameServer.ts` (singleton + `startServer()`)
- **Client entry**: `client/src/main.ts` → `Game.instance.start()` — `Game` singleton owns all client managers
- **Dev sandbox**: `server/src/playground.ts` — hot-reloaded via nodemon, loads boilerplate map
- **Physics**: Rapier3D (`@dimforge/rapier3d-simd-compat`) at 60 Hz, default gravity `y = -32`
- **Networking**: WebTransport (QUIC) preferred, WebSocket fallback. Packets serialized with msgpackr, large payloads gzip-compressed
- **Protocol**: `protocol/` defines all packet schemas (AJV-validated). Published as `@hytopia.com/server-protocol`
- **Rendering**: Three.js `WebGLRenderer` + `MeshBasicMaterial` (no dynamic lights). Post-processing: SMAA, bloom, outline. Chunk meshes built in a Web Worker with face culling + AO (no greedy quad merging)
- **Persistence**: `@hytopia.com/save-states` for player/global KV data
- **Singleton pattern**: Most server systems use `ClassName.instance`; client systems owned by `Game` singleton

## Commands

```bash
# Server dev (hot-reload, localhost:8080)
cd server && npm install && npm run dev

# Client dev (localhost:5173)
cd client && npm install && npm run dev

# Build server → sdk/server.mjs (+ types + docs)
cd server && npm run build

# Lint/format server
cd server && npx eslint --fix ./src

# Test SDK examples against local build
cd server && npm run build
cd ../sdk-examples/<example> && npm install && npm run dev
```

## Code Style

- TypeScript strict mode, ESNext target, `@/*` path alias → `./src/*`
- ESLint + tsdoc: single quotes, 2-space indent, trailing commas, unix linebreaks
- Server builds with Bun (`bun build`), client builds with Vite
- `@typescript-eslint/no-explicit-any` is off — `any` is allowed
- Unused params prefixed with `_` are allowed

## Testing

- Server tests live in `server/test/` — currently a placeholder (`_setup.ts`)
- SDK examples in `sdk-examples/` are the primary integration test surface — build the server, then run any example against the client

## Gotchas

1. **No dynamic Three.js lights** — Client uses `MeshBasicMaterial`. Lighting is applied via custom shader uniforms, not Three.js light objects.
2. **Chunks are 16x16x16** — Not 16x256x16 like Minecraft. The lattice manages many chunks.
3. **Physics 60 Hz, network 30 Hz** — `NetworkSynchronizer` flushes every 2 physics ticks. Don't assume per-tick network sync.
4. **WebTransport + WebSocket dual transport** — `Socket.ts` runs both on the same port. Test with both transport types.
5. **`sdk/` is a git submodule** — `npm run build` in `server/` outputs directly into `sdk/`. Don't edit `sdk/server.mjs` by hand.
6. **`playground.ts` is dev-only** — Not part of the SDK build. Changes here don't affect the published SDK.
7. **Assets are a separate npm package** — `@hytopia.com/assets`. The `assets/release/` dir is published independently via CI.
8. **Connection has 30s reconnection window** — Don't assume instant disconnect on transport drop.
9. **Player auth skipped in local dev** — `PlatformGateway` session token validation only runs in production.
10. **Basis transcoder required** — Client Vite config copies basis transcoder files from Three.js into `public/basis/` at build time.
