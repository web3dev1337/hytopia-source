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

export type ServerAction =
  | { type: 'spawn_bots'; count: number; behavior?: string }
  | { type: 'despawn_bots'; count?: number }
  | { type: 'load_map'; mapPath: string; worldId?: number }
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
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status} ${res.statusText}`);
    }

    return await res.json() as HealthResponse;
  }

  public async reset(): Promise<void> {
    const url = new URL('/__perf/reset', this._baseUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
    });

    if (!res.ok) {
      throw new Error(`Reset failed: ${res.status} ${res.statusText}`);
    }
  }

  public async action(action: ServerAction): Promise<void> {
    const url = new URL('/__perf/action', this._baseUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this._headers(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(action),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Action failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
    }
  }

  public async snapshot(): Promise<ServerSnapshot> {
    const url = new URL('/__perf/snapshot', this._baseUrl);
    const res = await fetch(url, { method: 'GET', headers: this._headers() });

    if (!res.ok) {
      throw new Error(`Snapshot failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as PerfSnapshotResponse;

    return {
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

  private _headers(): Record<string, string> {
    if (!this._token) return {};

    return {
      'x-hytopia-perf-token': this._token,
    };
  }
}
