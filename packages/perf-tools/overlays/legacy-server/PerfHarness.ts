import type http from 'http';
import PerformanceBaseline from '@/metrics/PerformanceBaseline';
import Telemetry from '@/metrics/Telemetry';
import PlayerManager from '@/players/PlayerManager';

const PERF_PREFIX = '/__perf';
const DEFAULT_BUDGET_MS = 1000 / 60;
const MAX_BODY_BYTES = 1024 * 1024;

type LegacyStatsWindowSnapshot = {
  average: number;
  count: number;
  max: number;
  min: number;
  p50: number;
  p95: number;
  sampleCount: number;
};

type LegacyPerformanceBaselineSnapshot = {
  generatedAt: string;
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
};

let previousNetworkSample:
  | { timestamp: number; bytesSentTotal: number; packetsSentTotal: number }
  | undefined;

function isPerfToolsEnabled(): boolean {
  const value = process.env.HYTOPIA_PERF_TOOLS;

  return value === '1' || value === 'true';
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.HYTOPIA_PERF_TOOLS_TOKEN;

  if (!token) {
    return true;
  }

  return req.headers['x-hytopia-perf-token'] === token;
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function drainBody(req: http.IncomingMessage, onDone: () => void): void {
  let received = 0;

  req.on('data', chunk => {
    received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));

    if (received > MAX_BODY_BYTES) {
      req.destroy();
    }
  });

  req.on('error', onDone);
  req.on('end', onDone);
}

function findTickWindow(
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

function sumLegacyPacketCount(snapshot: LegacyPerformanceBaselineSnapshot): number {
  return Object.values(snapshot.packets?.families ?? {}).reduce((total, family) => {
    return total + (family.packetCount ?? 0);
  }, 0);
}

function getSerializationAverageMs(
  spans: Record<string, LegacyStatsWindowSnapshot>,
): number {
  return spans.serialize_packets?.average
    ?? spans.serialize_packets_encode?.average
    ?? 0;
}

function toOperationSnapshot(snapshot: LegacyStatsWindowSnapshot) {
  return {
    count: snapshot.count || snapshot.sampleCount || 0,
    avgMs: snapshot.average || 0,
    p95Ms: snapshot.p95 || 0,
    p99Ms: snapshot.max || snapshot.p95 || 0,
    maxMs: snapshot.max || 0,
  };
}

function toModernSnapshot(
  legacySnapshot: LegacyPerformanceBaselineSnapshot,
  processStats: Record<string, unknown>,
  playerCount: number,
) {
  const generatedAtMs = Date.parse(legacySnapshot.generatedAt);
  const timestamp = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const spans = legacySnapshot.spans ?? {};
  const tickWindow = findTickWindow(spans);
  const bytesSentTotal = legacySnapshot.packets?.batches?.wireBytes ?? 0;
  const packetsSentTotal = sumLegacyPacketCount(legacySnapshot);
  let bytesSentPerSecond = 0;
  let packetsSentPerSecond = 0;

  if (previousNetworkSample && timestamp > previousNetworkSample.timestamp) {
    const elapsedSeconds = (timestamp - previousNetworkSample.timestamp) / 1000;

    if (elapsedSeconds > 0) {
      bytesSentPerSecond = Math.max(0, (bytesSentTotal - previousNetworkSample.bytesSentTotal) / elapsedSeconds);
      packetsSentPerSecond = Math.max(0, (packetsSentTotal - previousNetworkSample.packetsSentTotal) / elapsedSeconds);
    }
  }

  previousNetworkSample = {
    timestamp,
    bytesSentTotal,
    packetsSentTotal,
  };

  return {
    source: 'legacy_perf_api',
    timestamp,
    avgTickMs: tickWindow?.average ?? 0,
    maxTickMs: tickWindow?.max ?? 0,
    p95TickMs: tickWindow?.p95 ?? 0,
    p99TickMs: tickWindow?.max ?? tickWindow?.p95 ?? 0,
    ticksOverBudget: 0,
    totalTicks: tickWindow?.count ?? tickWindow?.sampleCount ?? 0,
    budgetMs: DEFAULT_BUDGET_MS,
    operations: Object.fromEntries(
      Object.entries(spans).map(([name, snapshot]) => [name, toOperationSnapshot(snapshot)]),
    ),
    memory: {
      heapUsedMb: Number(processStats.jsHeapSizeMb ?? processStats.processHeapSizeMb ?? 0),
      heapTotalMb: Number(processStats.jsHeapCapacityMb ?? 0),
      rssMb: Number(processStats.rssSizeMb ?? 0),
    },
    network: {
      connectedPlayers: playerCount,
      bytesSentTotal,
      bytesReceivedTotal: 0,
      bytesSentPerSecond,
      bytesReceivedPerSecond: 0,
      packetsSentPerSecond,
      packetsReceivedPerSecond: 0,
      avgSerializationMs: getSerializationAverageMs(spans),
      compressionCount: legacySnapshot.packets?.batches?.compressedBatches ?? 0,
    },
  };
}

export default class PerfHarness {
  public static enableIfConfigured(): void {}

  public static handleWebRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!isPerfToolsEnabled()) {
      return false;
    }

    const reqPath = req.url?.split('?')[0] ?? '/';

    if (!reqPath.startsWith(PERF_PREFIX)) {
      return false;
    }

    if (!isAuthorized(req)) {
      respondJson(res, 401, { ok: false, error: 'Unauthorized' });
      return true;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,x-hytopia-perf-token',
      });
      res.end();
      return true;
    }

    if ((reqPath === `${PERF_PREFIX}/reset`) && (req.method === 'POST' || req.method === 'DELETE')) {
      previousNetworkSample = undefined;
      PerformanceBaseline.reset();
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return true;
    }

    if ((reqPath === `${PERF_PREFIX}/snapshot` || reqPath === PERF_PREFIX) && req.method === 'GET') {
      const processStats = Telemetry.getProcessStats() as Record<string, unknown>;
      const legacySnapshot = PerformanceBaseline.snapshot() as LegacyPerformanceBaselineSnapshot;

      if (reqPath === PERF_PREFIX) {
        respondJson(res, 200, {
          playerCount: PlayerManager.instance.playerCount,
          process: processStats,
          snapshot: legacySnapshot,
        });
      } else {
        respondJson(res, 200, toModernSnapshot(
          legacySnapshot,
          processStats,
          PlayerManager.instance.playerCount,
        ));
      }

      return true;
    }

    if (reqPath === `${PERF_PREFIX}/action` && req.method === 'POST') {
      drainBody(req, () => {
        respondJson(res, 501, {
          ok: false,
          error: 'Perf actions are not available on this legacy overlay target.',
        });
      });
      return true;
    }

    respondJson(res, 404, { ok: false, error: 'Perf endpoint not found' });
    return true;
  }
}
