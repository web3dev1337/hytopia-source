# Networking Layer Audit

Audited files:
- `server/src/networking/WebServer.ts`
- `server/src/networking/Socket.ts`
- `server/src/networking/Connection.ts`
- `server/src/networking/PlatformGateway.ts`
- `server/src/networking/NetworkSynchronizer.ts`
- `server/src/networking/Serializer.ts`
- `server/src/networking/ssl/certs.ts`
- `protocol/packets/PacketCore.ts`
- `protocol/packets/PacketDefinitions.ts`

---

### [SECURITY] SSL Private Key Shipped in Source Code
**Benefit: 5/5 | Risk: 5/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/ssl/certs.ts:100-127`

The SSL private key is committed directly into the source code repository. This is explicitly documented as intentional for local development (resolving `local.hytopiahosting.com` to `127.0.0.1`) and for WebTransport support. However, the same certificate covers `*.dns-is-boring-we-do-ip-addresses.hytopiahosting.com` (a wildcard). Anyone with access to this repo (it appears to be an SDK) can impersonate any subdomain of that wildcard. If this cert is used in production infrastructure beyond localhost, it constitutes a critical TLS vulnerability. The certificate expires `2026-12-19` so the window is limited but still open.

**Recommendation:** Confirm this cert is ONLY used for local dev. In production, inject certs via environment variables or mounted secrets. Consider whether the wildcard SAN is truly needed for the shipped dev cert. If the repo is public, any user can MITM connections to `*.dns-is-boring-we-do-ip-addresses.hytopiahosting.com`.

---

### [BUG] Asset Cache Serves Stale Data After File Changes
**Benefit: 4/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/WebServer.ts:242-257`

The `_assetCache` Map caches `{ size, etag }` based on the file's mtime and size at the time of first access. Once cached, the metadata is never invalidated. If a file is modified on disk (common during development with hot-reload workflows), the server will continue serving the old etag/size, leading to:
1. Incorrect `content-length` headers (truncated or padded responses).
2. False 304 Not Modified responses when the file has actually changed.

**Recommendation:** Either disable caching in dev mode, or re-stat the file periodically / on every request and compare mtime to invalidate the cache entry. A simple approach: always re-stat but keep the cached etag to avoid recomputing if mtime hasn't changed.

---

### [BUG] WebSocket Reconnection: OPEN Event Race Condition
**Benefit: 4/5 | Risk: 3/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Socket.ts:113-119`

```typescript
this._wss.handleUpgrade(req, socket, head, ws => {
  if (ws.readyState !== WebSocket.OPEN) {
    ws.once('open', () => this._wss.emit('connection', ws, req));
  } else {
    this._wss.emit('connection', ws, req);
  }
});
```

The `ws` library's `handleUpgrade` callback delivers the WebSocket after the upgrade is complete; `readyState` should already be `OPEN`. The `once('open')` branch exists as a safety net but creates a subtle issue: if the WebSocket transitions to `CLOSING` or `CLOSED` before 'open' fires (e.g., client disconnects immediately), the 'open' event will never fire, and the connection will leak -- no Connection object is created, no cleanup occurs, and the `socket` reference from the upgrade is already detached. The `_connectionIdConnections` / `_userIdConnections` maps will not have an entry, but auth state (session lookup) was already performed and wasted.

**Recommendation:** Remove the `readyState` branch since `handleUpgrade` guarantees OPEN state. If kept for safety, add a `ws.once('close')` handler in the non-OPEN branch to clean up.

---

### [BUG] Reconnect Window Timer Not Cleared on killDuplicateConnection
**Benefit: 4/5 | Risk: 3/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:346-351`

```typescript
public killDuplicateConnection(): void {
  this._isDuplicate = true;
  this._cleanupConnections();
  this.emitWithGlobal(ConnectionEvent.DISCONNECTED, { connection: this });
  this._finalizeClose();
}
```

`killDuplicateConnection` calls `_finalizeClose()` directly but does NOT clear `_closeTimeout`. If a previous disconnection already started the 30-second reconnect timer, `_finalizeClose()` will be called twice: once by `killDuplicateConnection` and once when the timeout fires. The second call emits `ConnectionEvent.CLOSED` again and calls `offAll()` on an already-cleaned-up EventRouter, which is harmless but wasteful. More importantly, the timeout callback holds a reference to the Connection, preventing GC for up to 30 seconds.

**Recommendation:** Add `if (this._closeTimeout) { clearTimeout(this._closeTimeout); this._closeTimeout = null; }` at the start of `killDuplicateConnection`.

---

### [PERFORMANCE] Synchronous gzipSync Blocks Event Loop
**Benefit: 4/5 | Risk: 3/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:183`

```typescript
outputBuffer = gzipSync(outputBuffer, { level: 1 });
```

`gzipSync` is called on the main thread during packet serialization. For chunk data that exceeds 64KB (which chunk packets commonly do), this blocks the event loop. With multiple players receiving chunk data simultaneously, this creates visible stutter. Level 1 is fast but still measurable for 100KB+ buffers.

**Recommendation:** Consider pre-compressing chunk data when the chunk is generated (since chunk block data changes infrequently), or use a worker thread for compression. Alternatively, since the compressed result is cached by packet array identity, the cost is amortized per unique packet batch -- but the first serialization still blocks.

---

### [PERFORMANCE] Per-Packet Validation in serializePackets is Redundant
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:156-159`

```typescript
for (const packet of packets) {
  if (!protocol.isValidPacket(packet)) {
    return ErrorHandler.error(...);
  }
}
```

Every call to `serializePackets` validates each packet against its AJV schema before serializing. The packets were already constructed via `protocol.createPacket()` in `NetworkSynchronizer`, which also validates via `packetDef.validate(data)` (see `PacketCore.ts:94`). This means every outbound packet is validated twice. AJV schema validation is not free -- for complex schemas with nested objects (entities, chunks), this adds up.

**Recommendation:** Remove the validation in `serializePackets` and rely on the `createPacket` validation. If paranoia is desired, gate this behind a debug flag.

---

### [BUG] GraphQL Injection in getPlayerCosmetics
**Benefit: 4/5 | Risk: 4/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/PlatformGateway.ts:200-201`

```typescript
query: `{
  userById(id: "${userId}") {
```

The `userId` parameter is interpolated directly into a GraphQL query string without sanitization. If `userId` comes from an untrusted source (e.g., derived from session data that could be manipulated), an attacker could inject arbitrary GraphQL operations. Even if `userId` is always server-controlled today, this is a ticking time bomb if the call surface ever expands.

**Recommendation:** Use GraphQL variables instead of string interpolation:
```typescript
query: `query($id: String!) { userById(id: $id) { ... } }`,
variables: { id: userId }
```

---

### [BUG] WebTransport Writer Not Closed on Cleanup
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:470-500`

`_cleanupConnections()` sets `_wtReliableWriter` and `_wtUnreliableWriter` to `undefined` without calling `.close()` on them first. The `WritableStreamDefaultWriter` holds a lock on the underlying stream. While the parent `WebTransportSession.close()` (called via the 50ms `setTimeout`) should eventually tear everything down, not explicitly releasing the writer lock means that if any async `.write()` is still in-flight, it may fail with a confusing "writer is locked" error rather than a clean shutdown.

**Recommendation:** Call `this._wtReliableWriter?.close().catch(() => {})` and `this._wtUnreliableWriter?.close().catch(() => {})` before nulling them.

---

### [BUG] WebTransport Session Stream Iterator Never Terminates on Shutdown
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Socket.ts:198-211`

```typescript
private async _startWebTransport() {
  this._wts.startServer();
  for await (const wt of this._wts.sessionStream('/')) {
    // ...
  }
}
```

The `for await` loop on `sessionStream('/')` will run indefinitely. There is no mechanism to break out of this loop on server shutdown. When `WebServer.stop()` is called, the HTTP/2 server closes, but the WebTransport (HTTP/3) server has no corresponding `stop()` call. This means the process may hang on shutdown, waiting for the session stream iterator to complete.

**Recommendation:** Store the `_wts` server reference and call `_wts.stopServer()` (or equivalent) during shutdown. Add an `AbortController` to break the `for await` loop.

---

### [PERFORMANCE] Entity Sync Reliable/Unreliable Classification is Fragile
**Benefit: 3/5 | Risk: 2/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/NetworkSynchronizer.ts:163-187`

```typescript
for (const key in entitySync) {
  isReliableUpdate = key !== 'i' && key !== 'p' && key !== 'r';
  if (isReliableUpdate) { break; }
}
```

The reliable/unreliable classification iterates over entity sync object keys and checks if any key is NOT `i`, `p`, or `r`. This has two issues:
1. **Fragile:** If new position/rotation-related keys are added to the entity schema (like interpolation hints), they will accidentally force reliable mode.
2. **Incorrect classification:** The `for...in` loop breaks on the FIRST non-i/p/r key, but the final value of `isReliableUpdate` is always from the LAST iteration of the `for...in` loop body before the `break`. Actually, re-reading: it sets `isReliableUpdate` on every key and breaks when it finds a reliable key. But `for...in` order is not guaranteed by spec (though V8 does insertion order for string keys). If `r` (rotation as `[x,y,z,w]`) comes before `p` in the object, and there's also a property like `ri` (rotation interpolation), the logic works but is hard to reason about.

**Recommendation:** Use an explicit allowlist Set: `const UNRELIABLE_KEYS = new Set(['i', 'p', 'r']); const isReliable = Object.keys(entitySync).some(k => !UNRELIABLE_KEYS.has(k));`

---

### [PERFORMANCE] onPacket Registers a New Listener Per Packet Type Without Filtering
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:361-367`

```typescript
public onPacket<T extends AnyPacket>(id: T[0], callback: (packet: T) => void): void {
  this.on(ConnectionEvent.PACKET_RECEIVED, ({ packet }) => {
    if (packet[0] === id) {
      callback(packet as T);
    }
  });
}
```

Every call to `onPacket` adds a new listener to `PACKET_RECEIVED`. Each incoming packet fires ALL registered `PACKET_RECEIVED` listeners, and each one checks `packet[0] === id`. For N registered packet types, every incoming packet triggers N comparisons. Currently only HEARTBEAT is registered via `onPacket` in the constructor, so this is not a real issue today. But if more packet types are registered (e.g., for plugins or custom handlers), this becomes O(N) per received packet.

**Recommendation:** Consider a `Map<PacketId, callback[]>` dispatch table instead of N event listeners.

---

### [BUG] _onClose Fires Multiple Times for Dual-Transport Connections
**Benefit: 3/5 | Risk: 3/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:456-461`

A Connection can have both a WebSocket and a WebTransport bound simultaneously (during transport upgrades). Both transports wire `_onClose`:
- WebSocket: `this._ws.onclose = this._onClose`
- WebTransport: `wt.closed.finally(() => wt.userData.onclose?.())`

If the connection has both transports active and the server calls `disconnect()` (which closes both), `_onClose` will fire twice. The first invocation starts the 30-second reconnect timer. The second invocation starts ANOTHER 30-second timer (overwriting `_closeTimeout` -- but the first `setTimeout` reference is lost and cannot be cleared). This means `_finalizeClose` will be called twice: once from the leaked first timeout, and once from the second.

**Recommendation:** Guard `_onClose` to only fire once: `if (this._closeTimeout) return;` at the top of `_onClose`.

---

### [PERFORMANCE] Stale Asset Cache Grows Unbounded
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/WebServer.ts:121`

`_assetCache` is a `Map<string, { size, etag }>` that is populated on first access and never evicted. For servers hosting many assets or dynamically generated content, this map grows without bound. Each entry is small (~100 bytes), but over long server lifetimes with many unique asset paths, this could become meaningful.

**Recommendation:** Add a simple LRU eviction or periodic cache clear (e.g., clear every N minutes). For most game servers with a fixed asset set, this is low priority.

---

### [BUG] WebSocket send() Can Throw on Closed Connection
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:421`

```typescript
this._ws!.send(serializedBuffer);
```

The `readyState` is checked earlier (`this._ws && this._ws.readyState === WebSocket.OPEN`), but between the check and the `send()` call, the WebSocket could transition to CLOSING/CLOSED (e.g., if `_onClose` fires from a network event between these lines). The `ws` library's `send()` on a non-OPEN socket will throw synchronously. This throw IS caught by the outer `try/catch`, but it emits an `ErrorHandler.error` log for every packet sent to a recently-disconnected player, which could be noisy.

**Recommendation:** Wrap the `ws.send()` in its own try/catch or check `readyState` again immediately before send.

---

### [PERFORMANCE] Unframer Allocates 512KB Buffer Per WebTransport Connection
**Benefit: 3/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `protocol/packets/PacketCore.ts:108`

```typescript
let buffer = new Uint8Array(512 * 1024); // 512KB initial buffer
```

Each WebTransport reliable stream creates a 512KB buffer for the unframer. With 100 concurrent WebTransport connections, this is 50MB of pre-allocated memory that may mostly go unused (typical game packets are a few KB). The buffer grows via doubling up to 32MB.

**Recommendation:** Start with a smaller initial buffer (e.g., 16KB or 64KB) and let the doubling growth handle the rare large-packet case. Most packets are well under 64KB (the compression threshold).

---

### [BUG] _handleReconnect Returns True for New Transport Bindings (Not Just Reconnections)
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:521-530`

```typescript
private _handleReconnect(): boolean {
  const reconnected = !!this._ws || !!this._wt;
  // ...
  return reconnected;
}
```

`_handleReconnect` returns `true` if either `_ws` or `_wt` existed before the new binding. This is called from both `bindWs` and `bindWt`. But when a client first connects via WebSocket and then upgrades to WebTransport (adding a second transport to the same Connection), `_handleReconnect` will return `true` even though this is a transport upgrade, not a reconnection. This causes `ConnectionEvent.RECONNECTED` to be emitted, triggering a full world re-sync for the player, which is wasteful.

**Recommendation:** Distinguish between "transport upgrade on an active connection" (neither transport was closed) vs "reconnection after disconnection" (the reconnect timer was running). Only emit RECONNECTED when `_closeTimeout !== null`.

---

### [PERFORMANCE] Heartbeat Creates a New Packet Array on Every Beat
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:434-439`

```typescript
private _onHeartbeatPacket = () => {
  this.send([ protocol.createPacket(protocol.bidirectionalPackets.heartbeatPacketDefinition, null) ], true);
};
```

Every heartbeat response creates a new single-element array and a new packet object. Heartbeats are sent frequently (likely every ~30 seconds to prevent NGINX timeouts). While individually cheap, this creates unnecessary GC pressure. The heartbeat response packet is always identical.

**Recommendation:** Create the heartbeat response packet once as a module-level constant and reuse it.

---

### [FEATURE] No Rate Limiting on Inbound Packets
**Benefit: 3/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:441-454`

There is no rate limiting on inbound packet processing. A malicious client could flood the server with packets (heartbeats, inputs, chat messages) at an extremely high rate. Each packet is deserialized (msgpack unpack) and validated (AJV schema check), consuming CPU. While `isValidPacket` rejects malformed data, the deserialization and validation cost is paid regardless.

**Recommendation:** Add a simple per-connection packet rate limiter (e.g., max N packets per second). Disconnect clients that exceed the threshold.

---

### [FEATURE] No Maximum Message Size Enforcement for WebSocket
**Benefit: 3/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Socket.ts:66`

```typescript
this._wss = new WebSocketServer({ noServer: true });
```

The `ws` WebSocketServer is created with `noServer: true` but no `maxPayload` option. The default `maxPayload` in `ws` is 100MB. A malicious client could send a single 100MB WebSocket message, causing the server to allocate 100MB for deserialization before any validation occurs.

The WebTransport path has a 32MB `MAX_FRAME_BUFFER_SIZE` cap in the unframer, but WebSocket has no equivalent protection.

**Recommendation:** Set `maxPayload` to a reasonable limit (e.g., 1MB or 2MB) when creating the WebSocketServer.

---

### [BUG] PlatformGateway GraphQL WebSocket Connection Never Closes
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/PlatformGateway.ts:108-111`

```typescript
this._gqlWs = graphQLWS.createClient({
  url: 'wss://prod.gql.hytopia.com/graphql',
  webSocketImpl: WebSocket,
});
```

The `graphql-ws` client is created in the constructor and maintained as a singleton for the lifetime of the process. There is no `dispose()` call on server shutdown. The WebSocket connection to the GraphQL server will remain open until the process exits. This is generally fine for long-running servers, but during graceful shutdown sequences, this orphaned connection may prevent clean process exit.

**Recommendation:** Add a `dispose()` method to PlatformGateway that calls `this._gqlWs.dispose()` and invoke it during server shutdown.

---

### [PERFORMANCE] NetworkSynchronizer Player Join Sends Full World State Without Chunking
**Benefit: 2/5 | Risk: 3/5 | Effort: 4/5 | Surgical: no | Backwards Compatible: yes**

File: `server/src/networking/NetworkSynchronizer.ts:1084-1148`

When a player joins (`_onPlayerJoinedWorld`), the synchronizer queues the ENTIRE world state -- all audios, block types, chunks, entities, particle emitters, players, scene UIs, and world config -- into the per-player sync queue. This is all flushed in a single synchronize() tick. For worlds with hundreds of chunks and thousands of entities, this creates a massive spike in outbound bandwidth and serialization CPU. The resulting packet can exceed the 64KB gzip threshold, triggering synchronous compression.

**Recommendation:** Implement a streaming join protocol that sends world state in phases (block types first, then chunks in batches, then entities). This requires client-side changes to handle partial initial state, so it is not backwards compatible with existing clients without protocol versioning.

---

### [BUG] CORS Allows All Origins
**Benefit: 2/5 | Risk: 2/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/WebServer.ts:84`

```typescript
const CORS = { 'access-control-allow-origin': '*' };
```

The server sets `Access-Control-Allow-Origin: *` on all responses. Since this is a game asset server (not an API with cookies/auth), this is generally acceptable. However, if the server ever serves authenticated endpoints or sensitive data, this would need to be restricted.

**Recommendation:** Low priority. Document the intentional `*` policy. If authenticated endpoints are ever added, scope CORS appropriately.

---

### [PERFORMANCE] serializePackets Cache Keyed by Array Identity, Not Content
**Benefit: 2/5 | Risk: 1/5 | Effort: 2/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:167`

```typescript
const cachedSerializedBuffer = Connection._cachedPacketsSerializedBuffer.get(packets);
```

The cache uses the `packets` array reference as the Map key. This means two different array instances containing identical packets will NOT hit the cache. The cache only works because `NetworkSynchronizer.synchronize()` reuses the same array reference for shared broadcast packets (sent to all players). Per-player packets that happen to be identical will each be serialized separately.

**Recommendation:** This is a design choice, not a bug. The identity-based caching is fast (O(1) lookup) and works well for the broadcast case which is the hot path. Content-based caching would require hashing the packet content, which could be more expensive than the serialization itself.

---

### [BUG] WebServer.stop() Does Not Clean Up _server Reference
**Benefit: 2/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/WebServer.ts:176-186`

```typescript
public stop(): Promise<boolean> {
  if (!this._server) { ... }
  return new Promise((resolve, reject) => {
    this._server!.close(err => (err ? reject(err) : resolve(true)));
  });
}
```

After `stop()` resolves, `this._server` still holds a reference to the closed server. A subsequent call to `start()` will return early with a warning ("already started") because `this._server` is truthy, even though the server is closed. The server cannot be restarted after stopping.

**Recommendation:** Set `this._server = undefined` after successful close. The `_onStopped` callback is already wired to `close` event, so this could be done there.

---

### [FEATURE] No Backpressure Handling for WebTransport Writes
**Benefit: 2/5 | Risk: 2/5 | Effort: 3/5 | Surgical: yes | Backwards Compatible: yes**

File: `server/src/networking/Connection.ts:412-418`

```typescript
this._wtReliableWriter?.write(protocol.framePacketBuffer(serializedBuffer)).catch(() => { ... });
this._wtUnreliableWriter?.write(serializedBuffer).catch(() => { ... });
```

WebTransport write operations return promises that are fire-and-forget (only catching errors). There is no backpressure mechanism -- if the client is slow to consume data, writes will queue up in the WebTransport layer. Unlike WebSocket (which has `bufferedAmount` and emits `drain`), the current implementation has no way to detect or respond to a slow consumer.

**Recommendation:** Monitor `desiredSize` on the writable stream and skip/throttle unreliable packets when the buffer is filling up. For reliable packets, consider a per-connection write queue with a maximum depth.

---

### [PERFORMANCE] msgpackr Float32 Quantization Reduces Precision
**Benefit: 1/5 | Risk: 1/5 | Effort: 1/5 | Surgical: yes | Backwards Compatible: no**

File: `server/src/shared/helpers/msgpackr.ts:7`

```typescript
export default new Packr({ useFloat32: FLOAT32_OPTIONS.ALWAYS });
```

All floats are serialized as 32-bit (4 bytes) instead of 64-bit (8 bytes). This halves the space for float values but reduces precision from ~15 significant digits to ~7. For positions, rotations, and colors this is perfectly adequate. For accumulated timestamps or large coordinate values, precision loss could theoretically cause jitter. This is a deliberate trade-off for bandwidth savings and is flagged here only for documentation.

**Recommendation:** No change needed. The precision is sufficient for game state. If sub-millimeter precision is ever needed at large world coordinates, consider selective Float64 for specific fields.
