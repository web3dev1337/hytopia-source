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
import PerfBlockChurner from '@/perf/PerfBlockChurner';
import type { PerfBlockChurnMode } from '@/perf/PerfBlockChurner';
import WorldManager from '@/worlds/WorldManager';
import Entity from '@/worlds/entities/Entity';
import { ColliderShape } from '@/worlds/physics/Collider';
import { RigidBodyType } from '@/worlds/physics/RigidBody';
import type { BotBehavior } from '@/bots/BotPlayer';
import type { EntityOptions } from '@/worlds/entities/Entity';
import type { WorldMap } from '@/worlds/World';
import type http from 'http';
import type Vector3Like from '@/shared/types/math/Vector3Like';
import type World from '@/worlds/World';

const PERF_PREFIX = '/__perf';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_PERF_ENTITY_TAG = 'perf-tools';

type PerfAction =
  | { type: 'spawn_bots'; count: number; behavior?: string }
  | { type: 'despawn_bots'; count?: number }
  | { type: 'load_map'; mapPath: string; worldId?: number }
  | { type: 'spawn_entities'; count: number; kind?: 'model' | 'block'; options?: Record<string, unknown>; tag?: string }
  | { type: 'despawn_entities'; tag?: string }
  | { type: 'start_block_churn'; blocksPerTick: number; blockTypeId: number; mode?: PerfBlockChurnMode; min?: Vector3Like; max?: Vector3Like }
  | { type: 'stop_block_churn' }
  | { type: 'create_worlds'; count: number; mapPath?: string; setDefault?: boolean }
  | { type: 'set_default_world'; worldId: number }
  | { type: 'clear_world' }
  | { type: 'reset' };

const blockChurner = new PerfBlockChurner();

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

function getWorldOrDefault(worldId: number | undefined): World {
  if (typeof worldId === 'number') {
    const w = WorldManager.instance.getWorld(Math.floor(worldId));
    if (w) return w;
  }

  return WorldManager.instance.getDefaultWorld();
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

function loadMapFromAssets(mapPath: string, worldId?: number): { loaded: boolean; mapPath: string; worldId: number } {
  const world = getWorldOrDefault(worldId);
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

  return { loaded: true, mapPath, worldId: world.id };
}

function spawnEntities(
  count: number,
  kind: 'model' | 'block' | undefined,
  options: Record<string, unknown> | undefined,
  tag: string | undefined,
): { spawned: number; tag: string } {
  const world = WorldManager.instance.getDefaultWorld();
  const total = Math.max(0, Math.floor(count));
  const resolvedTag = (tag ?? DEFAULT_PERF_ENTITY_TAG).trim() || DEFAULT_PERF_ENTITY_TAG;
  const parsedOptions = options ?? {};
  const entityKind: 'model' | 'block' = kind ?? (typeof parsedOptions.modelUri === 'string' ? 'model' : 'block');

  const origin = { x: 0, y: 10, z: 0 };
  const spacing = 2;
  const grid = Math.ceil(Math.sqrt(total));

  for (let i = 0; i < total; i++) {
    const gx = i % grid;
    const gz = Math.floor(i / grid);
    const position = {
      x: origin.x + (gx - grid / 2) * spacing,
      y: origin.y,
      z: origin.z + (gz - grid / 2) * spacing,
    };

    let entityOptions: EntityOptions;

    if (entityKind === 'model') {
      const modelUri = getString(parsedOptions, 'modelUri') ?? 'models/npcs/wumpus.gltf';
      const modelScale = parseModelScale(getUnknown(parsedOptions, 'modelScale'));
      const modelPreferredShape = parseColliderShape(getUnknown(parsedOptions, 'modelPreferredShape'));
      const rigidBodyType = parseRigidBodyType(getRecord(parsedOptions, 'rigidBodyOptions')?.type);
      const disableAutoCollider = getBoolean(parsedOptions, 'disableAutoCollider');

      entityOptions = {
        modelUri,
        modelScale,
        modelPreferredShape: disableAutoCollider ? ColliderShape.NONE : modelPreferredShape,
        rigidBodyOptions: rigidBodyType ? { type: rigidBodyType } : undefined,
        isEnvironmental: getBoolean(parsedOptions, 'isEnvironmental'),
        name: getString(parsedOptions, 'name'),
        tag: resolvedTag,
      };
    } else {
      const blockTextureUri = getString(parsedOptions, 'blockTextureUri') ?? 'blocks/bricks.png';
      const blockHalfExtents = parseVector3Like(getUnknown(parsedOptions, 'blockHalfExtents')) ?? { x: 0.5, y: 0.5, z: 0.5 };
      const rigidBodyType = parseRigidBodyType(getRecord(parsedOptions, 'rigidBodyOptions')?.type);

      entityOptions = {
        blockTextureUri,
        blockHalfExtents,
        rigidBodyOptions: rigidBodyType ? { type: rigidBodyType } : undefined,
        isEnvironmental: getBoolean(parsedOptions, 'isEnvironmental'),
        name: getString(parsedOptions, 'name'),
        tag: resolvedTag,
      };
    }

    const entity = new Entity(entityOptions);
    entity.spawn(world, position);
  }

  return { spawned: total, tag: resolvedTag };
}

function despawnEntities(tag?: string): { despawned: number; tag: string } {
  const world = WorldManager.instance.getDefaultWorld();
  const resolvedTag = (tag ?? DEFAULT_PERF_ENTITY_TAG).trim() || DEFAULT_PERF_ENTITY_TAG;

  const entities = world.entityManager.getEntitiesByTag(resolvedTag);

  for (const entity of entities) {
    entity.despawn();
  }

  return { despawned: entities.length, tag: resolvedTag };
}

function parseRigidBodyType(raw: unknown): RigidBodyType | undefined {
  if (typeof raw !== 'string') return undefined;

  const v = raw.toLowerCase();

  switch (v) {
    case 'dynamic': return RigidBodyType.DYNAMIC;
    case 'fixed': return RigidBodyType.FIXED;
    case 'kinematic_position': return RigidBodyType.KINEMATIC_POSITION;
    case 'kinematic_velocity': return RigidBodyType.KINEMATIC_VELOCITY;
    default: return undefined;
  }
}

function parseColliderShape(raw: unknown): ColliderShape | undefined {
  if (typeof raw !== 'string') return undefined;

  const v = raw.toLowerCase();

  switch (v) {
    case 'none': return ColliderShape.NONE;
    case 'ball': return ColliderShape.BALL;
    case 'block': return ColliderShape.BLOCK;
    case 'capsule': return ColliderShape.CAPSULE;
    case 'cone': return ColliderShape.CONE;
    case 'cylinder': return ColliderShape.CYLINDER;
    case 'round-cylinder': return ColliderShape.ROUND_CYLINDER;
    case 'trimesh': return ColliderShape.TRIMESH;
    case 'voxels': return ColliderShape.VOXELS;
    case 'wedge': return ColliderShape.WEDGE;
    default: return undefined;
  }
}

function parseVector3Like(raw: unknown): Vector3Like | undefined {
  const obj = getUnknownRecord(raw);
  if (!obj) return undefined;

  const x = getNumber(obj, 'x');
  const y = getNumber(obj, 'y');
  const z = getNumber(obj, 'z');

  if (x === undefined || y === undefined || z === undefined) return undefined;

  return { x, y, z };
}

function parseModelScale(raw: unknown): Vector3Like | number | undefined {
  if (typeof raw === 'number') return raw;

  return parseVector3Like(raw);
}

function getUnknown(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function getUnknownRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (Array.isArray(raw)) return undefined;

  return raw as Record<string, unknown>;
}

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return getUnknownRecord(record[key]);
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];

  return typeof v === 'string' ? v : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const v = record[key];

  return typeof v === 'number' ? v : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const v = record[key];

  return typeof v === 'boolean' ? v : undefined;
}

function startBlockChurn(
  blocksPerTick: number,
  blockTypeId: number,
  mode: PerfBlockChurnMode | undefined,
  min: Vector3Like | undefined,
  max: Vector3Like | undefined,
): { started: boolean; blocksPerTick: number; blockTypeId: number } {
  const world = WorldManager.instance.getDefaultWorld();

  blockChurner.start(world, {
    blocksPerTick,
    blockTypeId,
    mode,
    min,
    max,
  });

  return {
    started: true,
    blocksPerTick: Math.max(0, Math.floor(blocksPerTick)),
    blockTypeId: Math.max(0, Math.floor(blockTypeId)),
  };
}

function stopBlockChurn(): { stopped: boolean } {
  blockChurner.stop();

  return { stopped: true };
}

function createWorlds(count: number, mapPath: string | undefined, setDefault: boolean | undefined): { created: number; defaultWorldId: number } {
  const total = Math.max(0, Math.floor(count));
  let mapRaw: string | undefined;

  if (typeof mapPath === 'string' && mapPath.trim().length > 0) {
    const resolved = resolveMapPath(mapPath);
    if (!resolved) throw new Error('Invalid mapPath');
    if (!fs.existsSync(resolved)) throw new Error(`Map not found: ${mapPath}`);
    mapRaw = fs.readFileSync(resolved, 'utf-8');
  }

  const created: World[] = [];

  for (let i = 0; i < total; i++) {
    const map = mapRaw ? JSON.parse(mapRaw) as WorldMap : undefined;

    created.push(WorldManager.instance.createWorld({
      name: `Perf World ${i + 1}`,
      skyboxUri: 'skyboxes/partly-cloudy',
      tag: DEFAULT_PERF_ENTITY_TAG,
      map,
    }));
  }

  if (setDefault && created.length > 0) {
    WorldManager.instance.setDefaultWorld(created[0]);
  }

  return { created: created.length, defaultWorldId: WorldManager.instance.getDefaultWorld().id };
}

function setDefaultWorld(worldId: number): { ok: boolean; defaultWorldId: number } {
  const id = Math.floor(worldId);
  const world = WorldManager.instance.getWorld(id);

  if (!world) {
    throw new Error(`World not found: ${id}`);
  }

  WorldManager.instance.setDefaultWorld(world);

  return { ok: true, defaultWorldId: world.id };
}

function clearDefaultWorld(): { ok: boolean } {
  const world = WorldManager.instance.getDefaultWorld();

  stopBlockChurn();
  BotManager.instance.despawnAll();

  for (const entity of world.entityManager.getEntitiesByTagSubstring(DEFAULT_PERF_ENTITY_TAG)) {
    entity.despawn();
  }

  world.chunkLattice.clear();

  return { ok: true };
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
      const defaultWorld = WorldManager.instance.getDefaultWorld();

      respondJson(res, 200, {
        ...perf,
        timestamp: Date.now(),
        players: PlayerManager.instance.playerCount,
        bots: BotManager.instance.botCount,
        worlds: {
          count: WorldManager.instance.getAllWorlds().length,
          defaultWorldId: defaultWorld.id,
        },
        world: {
          id: defaultWorld.id,
          chunkCount: defaultWorld.chunkLattice.chunkCount,
          entityCount: defaultWorld.entityManager.entityCount,
        },
        blockChurn: {
          running: blockChurner.isRunning,
        },
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

              const result = loadMapFromAssets(action.mapPath, typeof action.worldId === 'number' ? action.worldId : undefined);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'spawn_entities': {
              if (typeof action.count !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"count" is required' });
              }

              const result = spawnEntities(
                action.count,
                action.kind === 'model' || action.kind === 'block' ? action.kind : undefined,
                typeof action.options === 'object' && action.options ? action.options : undefined,
                typeof action.tag === 'string' ? action.tag : undefined,
              );
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'despawn_entities': {
              const result = despawnEntities(typeof action.tag === 'string' ? action.tag : undefined);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'start_block_churn': {
              if (typeof action.blocksPerTick !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"blocksPerTick" is required' });
              }

              if (typeof action.blockTypeId !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"blockTypeId" is required' });
              }

              const result = startBlockChurn(
                action.blocksPerTick,
                action.blockTypeId,
                action.mode,
                action.min,
                action.max,
              );
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'stop_block_churn': {
              const result = stopBlockChurn();
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'create_worlds': {
              if (typeof action.count !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"count" is required' });
              }

              const result = createWorlds(
                action.count,
                typeof action.mapPath === 'string' ? action.mapPath : undefined,
                typeof action.setDefault === 'boolean' ? action.setDefault : undefined,
              );
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'set_default_world': {
              if (typeof action.worldId !== 'number') {
                return respondJson(res, 400, { ok: false, error: '"worldId" is required' });
              }

              const result = setDefaultWorld(action.worldId);
              respondJson(res, 200, { ok: true, result });

              return;
            }
            case 'clear_world': {
              const result = clearDefaultWorld();
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
