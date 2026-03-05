import fs from 'fs';
import path from 'path';
import BotManager from '@/bots/BotManager';
import ChaseBehavior from '@/bots/behaviors/ChaseBehavior';
import IdleBehavior from '@/bots/behaviors/IdleBehavior';
import InteractBehavior from '@/bots/behaviors/InteractBehavior';
import RandomWalkBehavior from '@/bots/behaviors/RandomWalkBehavior';
import ErrorHandler from '@/errors/ErrorHandler';
import NetworkMetrics from '@/metrics/NetworkMetrics';
import PerformanceMonitor from '@/metrics/PerformanceMonitor';
import PlayerManager from '@/players/PlayerManager';
import WorldManager from '@/worlds/WorldManager';
import type { BotBehavior } from '@/bots/BotPlayer';
import type { WorldMap } from '@/worlds/World';
import type http from 'http';

const PERF_PREFIX = '/__perf';
const MAX_BODY_BYTES = 1024 * 1024;

type PerfAction =
  | { type: 'spawn_bots'; count: number; behavior?: string }
  | { type: 'despawn_bots'; count?: number }
  | { type: 'load_map'; mapPath: string }
  | { type: 'reset' };

function isPerfToolsEnabled(): boolean {
  const v = process.env.HYTOPIA_PERF_TOOLS;

  return v === '1' || v === 'true';
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.HYTOPIA_PERF_TOOLS_TOKEN;
  if (!token) {
    return true;
  }

  const header = req.headers['x-hytopia-perf-token'];

  return header === token;
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onBody: (body: unknown) => void,
): void {
  let received = 0;
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    received += chunk.length;

    if (received > MAX_BODY_BYTES) {
      respondJson(res, 413, { ok: false, error: 'Request body too large' });
      req.destroy();

      return;
    }

    chunks.push(chunk);
  });

  req.on('error', () => {
    respondJson(res, 400, { ok: false, error: 'Failed to read request body' });
  });

  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const json: unknown = raw.length > 0 ? JSON.parse(raw) as unknown : {};
      onBody(json);
    } catch {
      respondJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  });
}

function resolveMapPath(mapPath: string): string | null {
  const assetRoot = path.resolve('assets');

  const normalized = mapPath
    .trim()
    .replace(/^\/+/, '')
    .replace(/^assets[\\/]/, '');

  const absolute = path.resolve(assetRoot, normalized);

  if (!absolute.startsWith(assetRoot)) {
    return null;
  }

  return absolute;
}

function createBehavior(name: string | undefined): BotBehavior | null {
  switch ((name ?? '').toLowerCase()) {
    case '':
    case 'idle':
      return new IdleBehavior();
    case 'random_walk':
    case 'randomwalk':
      return new RandomWalkBehavior();
    case 'chase':
      return new ChaseBehavior();
    case 'interact':
      return new InteractBehavior();
    default:
      return null;
  }
}

function spawnBots(count: number, behaviorName: string | undefined): { spawned: number } {
  const world = WorldManager.instance.getDefaultWorld();
  const spawnedBots = Math.max(0, Math.floor(count));
  const origin = { x: 0, y: 10, z: 0 };
  const radius = Math.ceil(Math.sqrt(spawnedBots)) * 2;

  for (let i = 0; i < spawnedBots; i++) {
    const angle = (i / Math.max(1, spawnedBots)) * Math.PI * 2;
    const dist = (i % Math.max(1, radius)) * 0.8;
    const behavior = createBehavior(behaviorName) ?? new IdleBehavior();

    BotManager.instance.spawnBot(world, {
      behavior,
      spawnPosition: {
        x: origin.x + Math.cos(angle) * dist,
        y: origin.y,
        z: origin.z + Math.sin(angle) * dist,
      },
    });
  }

  return { spawned: spawnedBots };
}

function despawnBots(count?: number): { despawned: number; remaining: number } {
  const bots = BotManager.instance.getAllBots();

  if (count === undefined) {
    const despawned = bots.length;
    BotManager.instance.despawnAll();

    return { despawned, remaining: 0 };
  }

  const target = Math.max(0, Math.floor(count));
  let despawned = 0;

  for (let i = bots.length - 1; i >= 0 && despawned < target; i--) {
    BotManager.instance.despawnBot(bots[i].id);
    despawned++;
  }

  return { despawned, remaining: BotManager.instance.botCount };
}

function loadMapFromAssets(mapPath: string): { loaded: boolean; mapPath: string } {
  const world = WorldManager.instance.getDefaultWorld();
  const resolved = resolveMapPath(mapPath);

  if (!resolved) {
    throw new Error('Invalid mapPath');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Map not found: ${mapPath}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const map = JSON.parse(raw) as WorldMap;
  world.loadMap(map);

  return { loaded: true, mapPath };
}

export default class PerfHarness {
  public static enableIfConfigured(): void {
    if (!isPerfToolsEnabled()) {
      return;
    }

    try {
      if (!PerformanceMonitor.instance.isEnabled) {
        PerformanceMonitor.instance.enable({
          snapshotIntervalMs: 0,
        });
      }

      if (!NetworkMetrics.instance.isEnabled) {
        NetworkMetrics.instance.enable();
      }
    } catch (error) {
      ErrorHandler.warning(`PerfHarness.enableIfConfigured(): Failed to enable perf tools. Error: ${String(error)}`);
    }
  }

  public static handleWebRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!isPerfToolsEnabled()) return false;

    const reqPath = req.url?.split('?')[0] ?? '/';

    if (!reqPath.startsWith(`${PERF_PREFIX}/`)) return false;

    if (!isAuthorized(req)) {
      respondJson(res, 401, { ok: false, error: 'Unauthorized' });

      return true;
    }

    const method = req.method ?? 'GET';

    if (method === 'GET' && reqPath === `${PERF_PREFIX}/snapshot`) {
      const perf = PerformanceMonitor.instance.getSnapshot();
      const network = NetworkMetrics.instance.isEnabled ? NetworkMetrics.instance.getSnapshot() : undefined;

      respondJson(res, 200, {
        ...perf,
        timestamp: Date.now(),
        players: PlayerManager.instance.playerCount,
        bots: BotManager.instance.botCount,
        network,
      });

      return true;
    }

    if (method === 'POST' && reqPath === `${PERF_PREFIX}/reset`) {
      PerformanceMonitor.instance.resetStats();
      NetworkMetrics.instance.reset();
      respondJson(res, 200, { ok: true });

      return true;
    }

    if (method === 'POST' && reqPath === `${PERF_PREFIX}/action`) {
      readJsonBody(req, res, body => {
        try {
          const action = body as Partial<PerfAction>;

          switch (action.type) {
            case 'spawn_bots': {
              if (typeof action.count !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"count" is required' });
              }

              const result = spawnBots(action.count, typeof action.behavior === 'string' ? action.behavior : undefined);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'despawn_bots': {
              const result = despawnBots(typeof action.count === 'number' ? action.count : undefined);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'load_map': {
              if (typeof action.mapPath !== 'string') {
                return respondJson(res, 400, { ok: false, error: '"mapPath" is required' });
              }

              const result = loadMapFromAssets(action.mapPath);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'reset': {
              PerformanceMonitor.instance.resetStats();
              NetworkMetrics.instance.reset();
              respondJson(res, 200, { ok: true });

              return;
            }
            default:
              respondJson(res, 400, { ok: false, error: `Unsupported action: ${String(action.type)}` });
          }
        } catch (error) {
          respondJson(res, 500, { ok: false, error: (error as Error).message });
        }
      });

      return true;
    }

    respondJson(res, 404, { ok: false, error: 'Not found' });

    return true;
  }
}
