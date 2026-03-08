import type http from 'http';
import ErrorHandler from '@/errors/ErrorHandler';
import NetworkMetrics from '@/metrics/NetworkMetrics';
import PerformanceMonitor from '@/metrics/PerformanceMonitor';

const PERF_PREFIX = '/__perf';
const MAX_BODY_BYTES = 1024 * 1024;

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

export default class PerfHarness {
  public static enableIfConfigured(): void {
    if (!isPerfToolsEnabled()) {
      return;
    }

    try {
      if (!PerformanceMonitor.instance.isEnabled) {
        PerformanceMonitor.instance.enable({ snapshotIntervalMs: 0 });
      }

      if (!NetworkMetrics.instance.isEnabled) {
        NetworkMetrics.instance.enable();
      }
    } catch (error) {
      ErrorHandler.warning(`PerfHarness.enableIfConfigured(): Failed to enable perf tools. Error: ${String(error)}`);
    }
  }

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
      PerformanceMonitor.instance.resetStats();
      NetworkMetrics.instance.reset();
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return true;
    }

    if ((reqPath === `${PERF_PREFIX}/snapshot` || reqPath === PERF_PREFIX) && req.method === 'GET') {
      const snapshot = PerformanceMonitor.instance.getSnapshot();
      const network = NetworkMetrics.instance.getSnapshot();

      respondJson(res, 200, {
        source: 'perf_harness',
        timestamp: Date.now(),
        avgTickMs: snapshot.avgTickMs,
        maxTickMs: snapshot.maxTickMs,
        p95TickMs: snapshot.p95TickMs,
        p99TickMs: snapshot.p99TickMs,
        ticksOverBudget: snapshot.ticksOverBudget,
        totalTicks: snapshot.totalTicks,
        budgetMs: snapshot.budgetMs,
        operations: snapshot.operations,
        memory: snapshot.memory,
        network,
      });
      return true;
    }

    if (reqPath === `${PERF_PREFIX}/action` && req.method === 'POST') {
      drainBody(req, () => {
        respondJson(res, 501, {
          ok: false,
          error: 'Perf actions are not available on this overlay target.',
        });
      });
      return true;
    }

    respondJson(res, 404, { ok: false, error: 'Perf endpoint not found' });
    return true;
  }
}
