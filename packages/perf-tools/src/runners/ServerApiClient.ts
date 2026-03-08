import * as http from 'node:http';
import * as https from 'node:https';
import type { ServerSnapshot } from './MetricCollector.js';

interface HealthResponse {
  status?: string;
  version?: string;
  runtime?: string;
  playerCount?: number;
}

export interface NetworkSnapshot {
  connectedPlayers: number;
  bytesSentTotal: number;
  bytesReceivedTotal: number;
  bytesSentPerSecond: number;
  bytesReceivedPerSecond: number;
  packetsSentPerSecond: number;
  packetsReceivedPerSecond: number;
  avgSerializationMs: number;
  compressionCount: number;
}

interface PerfSnapshotResponse {
  source?: 'perf_harness' | 'legacy_perf_api';
  timestamp: number;
  avgTickMs: number;
  maxTickMs: number;
  p95TickMs: number;
  p99TickMs: number;
  ticksOverBudget: number;
  totalTicks: number;
  budgetMs: number;
  operations: Record<string, {
    count: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  }>;
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
  network?: NetworkSnapshot;
}

interface LegacyStatsWindowSnapshot {
  average?: number;
  count?: number;
  max?: number;
  min?: number;
  p50?: number;
  p95?: number;
  sampleCount?: number;
}

interface LegacyPerfSnapshotResponse {
  generatedAt?: string;
  packets?: {
    batches?: {
      compressedBatches?: number;
      rawBytes?: number;
      reliableBatches?: number;
      totalBatches?: number;
      unreliableBatches?: number;
      wireBytes?: number;
    };
    families?: Record<string, {
      batchCount?: number;
      packetCount?: number;
      rawBytes?: number;
      wireBytes?: number;
      averageRawBytes?: number;
      averageWireBytes?: number;
    }>;
  };
  spans?: Record<string, LegacyStatsWindowSnapshot>;
  worlds?: Record<string, Record<string, LegacyStatsWindowSnapshot>>;
}

interface LegacyPerfEnvelopeResponse {
  playerCount?: number;
  process?: {
    jsHeapSizeMb?: number;
    jsHeapCapacityMb?: number;
    processHeapSizeMb?: number;
    rssSizeMb?: number;
  };
  snapshot?: LegacyPerfSnapshotResponse;
  version?: string;
}

export type ServerAction =
  | { type: 'spawn_bots'; count: number; behavior?: string; origin?: { x: number; y: number; z: number } }
  | { type: 'despawn_bots'; count?: number }
  | { type: 'load_map'; mapPath: string; worldId?: number }
  | { type: 'generate_blocks'; blockCount: number; blockTypeId: number; worldId?: number; layout?: 'dense' | 'slab'; slabHeight?: number; origin?: { x: number; y: number; z: number }; clear?: boolean }
  | { type: 'spawn_entities'; count: number; kind?: 'model' | 'block'; options?: Record<string, unknown>; tag?: string }
  | { type: 'despawn_entities'; tag?: string }
  | { type: 'start_block_churn'; blocksPerTick: number; blockTypeId: number; mode?: 'toggle' | 'place' | 'remove'; min?: { x: number; y: number; z: number }; max?: { x: number; y: number; z: number } }
  | { type: 'stop_block_churn' }
  | { type: 'create_worlds'; count: number; mapPath?: string; setDefault?: boolean }
  | { type: 'set_default_world'; worldId: number }
  | { type: 'clear_world' }
  | { type: 'reset' };

export default class ServerApiClient {
  private _baseUrl: URL;
  private _token: string | undefined;
  private _perfApiMode: 'modern' | 'legacy' | undefined;
  private _previousLegacyNetworkSample:
    | { timestamp: number; bytesSentTotal: number; packetsSentTotal: number }
    | undefined;

  constructor(baseUrl: string, options?: { token?: string }) {
    this._baseUrl = new URL(baseUrl);
    this._token = options?.token;
  }

  public async waitForHealthy(timeoutMs: number = 90_000): Promise<HealthResponse> {
    const start = Date.now();
    let lastError: unknown;

    while (Date.now() - start < timeoutMs) {
      try {
        const health = await this.health();

        if (health.status === 'OK') {
          return health;
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
    throw new Error(`Server not healthy after ${timeoutMs}ms: ${message}`);
  }

  public async health(): Promise<HealthResponse> {
    const url = new URL('/', this._baseUrl);
    const res = await this._request(url, { method: 'GET' });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Health check failed: ${res.statusCode} ${res.statusMessage}`);
    }

    return JSON.parse(res.body) as HealthResponse;
  }

  public async reset(): Promise<void> {
    const url = new URL('/__perf/reset', this._baseUrl);
    const res = await this._request(url, {
      method: 'POST',
      headers: this._headers(),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Reset failed: ${res.statusCode} ${res.statusMessage}`);
    }
  }

  public async action(action: ServerAction): Promise<void> {
    if (this._perfApiMode === 'legacy') {
      throw new Error('Perf action failed: target only exposes the legacy snapshot/reset perf API');
    }

    const url = new URL('/__perf/action', this._baseUrl);
    const res = await this._request(url, {
      method: 'POST',
      headers: {
        ...this._headers(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(action),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode === 404 || res.statusCode === 501) {
        this._perfApiMode = 'legacy';
      }

      throw new Error(`Action failed: ${res.statusCode} ${res.statusMessage}${res.body ? ` - ${res.body}` : ''}`);
    }
  }

  public async snapshot(): Promise<ServerSnapshot> {
    if (this._perfApiMode === 'legacy') {
      return await this._snapshotLegacy();
    }

    try {
      const snapshot = await this._snapshotModern();

      this._perfApiMode = 'modern';
      return snapshot;
    } catch (error) {
      if (!this._looksLikeMissingModernPerfApi(error)) {
        throw error;
      }
    }

    const legacySnapshot = await this._snapshotLegacy();

    this._perfApiMode = 'legacy';
    return legacySnapshot;
  }

  private async _snapshotModern(): Promise<ServerSnapshot> {
    const url = new URL('/__perf/snapshot', this._baseUrl);
    const res = await this._request(url, { method: 'GET', headers: this._headers() });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Snapshot failed: ${res.statusCode} ${res.statusMessage}`);
    }

    const data = JSON.parse(res.body) as PerfSnapshotResponse;

    return {
      source: data.source ?? 'perf_harness',
      timestamp: data.timestamp,
      avgTickMs: data.avgTickMs,
      maxTickMs: data.maxTickMs,
      p95TickMs: data.p95TickMs,
      p99TickMs: data.p99TickMs,
      ticksOverBudget: data.ticksOverBudget,
      totalTicks: data.totalTicks,
      budgetMs: data.budgetMs,
      operations: data.operations,
      memory: data.memory,
      network: data.network,
    };
  }

  private async _snapshotLegacy(): Promise<ServerSnapshot> {
    const url = new URL('/__perf', this._baseUrl);
    const res = await this._request(url, { method: 'GET', headers: this._headers() });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Legacy snapshot failed: ${res.statusCode} ${res.statusMessage}`);
    }

    const data = JSON.parse(res.body) as LegacyPerfEnvelopeResponse;
    const snapshot = data.snapshot;
    const spans = snapshot?.spans ?? {};
    const tickSnapshot = this._resolveLegacyTickSnapshot(spans);
    const timestamp = this._resolveLegacyTimestamp(snapshot?.generatedAt);
    const bytesSentTotal = snapshot?.packets?.batches?.wireBytes ?? 0;
    const packetsSentTotal = Object.values(snapshot?.packets?.families ?? {}).reduce((total, family) => {
      return total + (family.packetCount ?? 0);
    }, 0);
    let bytesSentPerSecond = 0;
    let packetsSentPerSecond = 0;

    if (this._previousLegacyNetworkSample && timestamp > this._previousLegacyNetworkSample.timestamp) {
      const elapsedSeconds = (timestamp - this._previousLegacyNetworkSample.timestamp) / 1000;

      if (elapsedSeconds > 0) {
        bytesSentPerSecond = Math.max(0, (bytesSentTotal - this._previousLegacyNetworkSample.bytesSentTotal) / elapsedSeconds);
        packetsSentPerSecond = Math.max(0, (packetsSentTotal - this._previousLegacyNetworkSample.packetsSentTotal) / elapsedSeconds);
      }
    }

    this._previousLegacyNetworkSample = {
      timestamp,
      bytesSentTotal,
      packetsSentTotal,
    };

    return {
      source: 'legacy_perf_api',
      timestamp,
      avgTickMs: tickSnapshot?.average ?? 0,
      maxTickMs: tickSnapshot?.max ?? 0,
      p95TickMs: tickSnapshot?.p95 ?? 0,
      p99TickMs: tickSnapshot?.max ?? tickSnapshot?.p95 ?? 0,
      ticksOverBudget: 0,
      totalTicks: tickSnapshot?.count ?? tickSnapshot?.sampleCount ?? 0,
      budgetMs: 1000 / 60,
      operations: Object.fromEntries(
        Object.entries(spans).map(([name, legacySpan]) => [name, {
          count: legacySpan.count ?? legacySpan.sampleCount ?? 0,
          avgMs: legacySpan.average ?? 0,
          p95Ms: legacySpan.p95 ?? 0,
          p99Ms: legacySpan.max ?? legacySpan.p95 ?? 0,
          maxMs: legacySpan.max ?? 0,
        }]),
      ),
      memory: {
        heapUsedMb: data.process?.jsHeapSizeMb ?? data.process?.processHeapSizeMb ?? 0,
        heapTotalMb: data.process?.jsHeapCapacityMb ?? 0,
        rssMb: data.process?.rssSizeMb ?? 0,
      },
      network: {
        connectedPlayers: data.playerCount ?? 0,
        bytesSentTotal,
        bytesReceivedTotal: 0,
        bytesSentPerSecond,
        bytesReceivedPerSecond: 0,
        packetsSentPerSecond,
        packetsReceivedPerSecond: 0,
        avgSerializationMs: spans.serialize_packets?.average ?? spans.serialize_packets_encode?.average ?? 0,
        compressionCount: snapshot?.packets?.batches?.compressedBatches ?? 0,
      },
    };
  }

  private _looksLikeMissingModernPerfApi(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /Snapshot failed: (404|500|501)\b/.test(error.message);
  }

  private _resolveLegacyTimestamp(generatedAt: string | undefined): number {
    if (!generatedAt) {
      return Date.now();
    }

    const parsed = Date.parse(generatedAt);

    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  private _resolveLegacyTickSnapshot(
    spans: Record<string, LegacyStatsWindowSnapshot>,
  ): LegacyStatsWindowSnapshot | undefined {
    const preferred = ['world_tick', 'ticker_tick'];

    for (const name of preferred) {
      if (spans[name]) {
        return spans[name];
      }
    }

    for (const [name, snapshot] of Object.entries(spans)) {
      if (name.includes('tick')) {
        return snapshot;
      }
    }

    return undefined;
  }

  private _headers(): Record<string, string> {
    if (!this._token) return {};

    return {
      'x-hytopia-perf-token': this._token,
    };
  }

  private async _request(
    url: URL,
    options: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ statusCode: number; statusMessage: string; body: string }> {
    const transport = url.protocol === 'https:' ? https : http;

    return await new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method: options.method,
        headers: options.headers,
        rejectUnauthorized: !this._shouldAllowInsecureTls(url),
      }, res => {
        const chunks: Buffer[] = [];

        res.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? 'Unknown Error',
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  private _shouldAllowInsecureTls(url: URL): boolean {
    if (url.protocol !== 'https:') {
      return false;
    }

    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '::1'
      || url.hostname === 'local.hytopiahosting.com';
  }
}
