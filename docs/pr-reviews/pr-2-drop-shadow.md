# PR Review: PR #2 — Blob Shadows + Client Config Refactor

PR: https://github.com/hytopiagg/hytopia-source/pull/2  
Author: @RZDESIGN  
Reviewed commit: `7ca966a0c60e87ab531bde4dd507d7921154bfe8` (branch `drop-shadow`)  
Review date: 2026-03-02  

**Recommendation:** Request changes before merging (mixes concerns + introduces perf/correctness risks).

## Summary of what this PR does

- Removes `@hytopia.com/lib` from the client and updates usage accordingly (`client/package.json`, `client/src/services/hytopia/heartbeat.ts`).
- Adds a Vite dev proxy path for assets/blocks when `VITE_ASSET_PROXY_TARGET` is set (`client/vite.config.js`, `client/src/network/Assets.ts`).
- Introduces per-entity “blob shadow” rendering + new settings toggle (`client/src/entities/Entity.ts`, `client/src/settings/SettingsManager.ts`).
- Changes UI script execution to async and adds custom handling for `script[src]` (`client/src/ui/UIManager.ts`).
- Adds a small behavior change in transparent sort key handling (`client/src/three/utils.ts`).
- Includes large lockfile churn, including a new example lockfile (`sdk-examples/zombies-fps/package-lock.json`).

## Blockers / Requested changes

### 1) Lockfiles + PR scope

This PR includes heavy, mostly unrelated lockfile changes:

- `sdk-examples/zombies-fps/package-lock.json` is newly added (large) while other examples do not have lockfiles.
- `server/.gitignore` adds `package-lock.json` while `server/package-lock.json` is committed in this same PR.
- `client/package-lock.json` is also heavily changed.

Requested:

- Remove the new `sdk-examples/zombies-fps/package-lock.json` (or standardize lockfile policy across all examples in a separate PR).
- Decide whether `server/package-lock.json` is tracked. If tracked, don’t ignore it. If not tracked, remove it from git (separate PR) and keep ignore.
- If lockfile changes are not intentional, revert lockfile drift and keep this PR focused on the functional changes.

### 2) Blob shadows enabled by default for *all* quality presets (perf risk)

`blobShadows.enabled` is set to `true` for ULTRA/HIGH/MEDIUM/LOW/POWER_SAVING in `client/src/settings/SettingsManager.ts`.

Requested:

- Disable blob shadows for LOW and POWER_SAVING at minimum, or gate by quality tier / distance.
- Consider making this feature opt-in until it’s profiled on lower-end devices.

### 3) Blob shadows: avoidable per-frame work + allocation churn

Implementation details in `client/src/entities/Entity.ts`:

- Adds a `Mesh` + `MeshBasicMaterial` per entity (extra draw calls + transparent sorting).
- Ground scanning can run very frequently (near entities refresh every frame).
- When the entity becomes invisible or attached, `_updateBlobShadow()` calls `_clearBlobShadow()` which removes the mesh and disposes the material; this can churn GPU resources if entities cross view distance/frustum boundaries.

Requested:

- Throttle ground scans even when near; ideally rescan only when `(floor(x), floor(z), floor(footY))` changes.
- Prefer create-once + hide/show, and only dispose on entity disposal or when the feature is globally disabled.
- If many entities are expected on-screen, consider an instanced approach (central “BlobShadowManager” using a single `InstancedMesh`).

### 4) UI script handling may break real UIs (semantics change)

`client/src/ui/UIManager.ts` now fetches `script[src]` and inlines it into a new `<script>` tag.

Risks:

- Does not preserve important script attributes for `src` scripts (e.g. `type="module"`, `defer`, `crossorigin`).
- Changes execution semantics (module scripts, CSP, and cross-origin loading are likely to break).
- Serializes loading (can slow UI boot if multiple scripts).

Requested:

- For `script[src]`, keep it as a `src` script and `await` `onload/onerror` to preserve ordering without changing semantics.
- Copy over attributes for both inline and `src` scripts.
- If guarding against HTML/error responses is required, use `Content-Type` checks or handle `onerror` with a clear warning, rather than inlining fetched text.

### 5) Vite asset proxy: env + TLS edge cases

- `client/vite.config.js` reads `process.env.VITE_ASSET_PROXY_TARGET` directly; depending on local setup, `.env` may not populate `process.env` the way you expect.
- Proxy uses `secure: true` but the comment suggests `https://localhost:8080` as a potential target; self-signed/local TLS will fail without extra configuration.

Requested:

- Use Vite `loadEnv` for consistency.
- Make `secure` conditional (or document that the proxy target must have valid TLS).

## Performance notes (why these blockers matter)

- Blob shadows can add meaningful CPU + GPU cost:
  - extra renderables per entity (and transparent sorting overhead),
  - frequent world/chunk lookups for ground detection,
  - potential material/mesh dispose/recreate churn on visibility toggles.
- Because blob shadows are enabled for all presets, lower-end devices will pay this cost without opting in.

## Suggested test plan

- `cd client && npm ci && npm run build`
- Load a UI that uses `script type="module"` and/or `script src=...` to ensure the new UI script logic doesn’t break execution/order.
- Profiling pass with many entities visible to quantify blob shadow cost before enabling on LOW/POWER_SAVING presets.

