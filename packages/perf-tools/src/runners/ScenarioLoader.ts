import * as fs from 'node:fs';
import * as yaml from 'js-yaml';

export interface ScenarioVector3 {
  x: number;
  y: number;
  z: number;
}

export type ScenarioClientTarget = 'primary' | 'all' | 'extras';

export interface ScenarioAction {
  type:
    | 'spawn_bots'
    | 'despawn_bots'
    | 'load_map'
    | 'generate_blocks'
    | 'spawn_entities'
    | 'despawn_entities'
    | 'start_block_churn'
    | 'stop_block_churn'
    | 'create_worlds'
    | 'set_default_world'
    | 'clear_world'
    | 'connect_clients'
    | 'disconnect_clients'
    | 'wait'
    | 'walk_player'
    | 'wait_for_entities'
    | 'set_camera'
    | 'throttle_cpu'
    | 'send_chat'
    | 'custom';
  count?: number;
  behavior?: string;
  durationMs?: number;
  mapPath?: string;
  position?: ScenarioVector3;
  yaw?: number;
  pitch?: number;
  rate?: number;
  message?: string;
  worldId?: number;
  kind?: 'model' | 'block';
  tag?: string;
  options?: Record<string, unknown>;
  blockCount?: number;
  layout?: 'dense' | 'slab';
  slabHeight?: number;
  origin?: ScenarioVector3;
  clear?: boolean;
  blocksPerTick?: number;
  blockTypeId?: number;
  mode?: 'toggle' | 'place' | 'remove';
  min?: ScenarioVector3;
  max?: ScenarioVector3;
  setDefault?: boolean;
  staggerMs?: number;
  target?: ScenarioClientTarget;
  script?: string;
}

export interface ScenarioPhase {
  name: string;
  duration?: string;
  actions?: ScenarioAction[];
  collect?: boolean;
}

export interface ScenarioThresholds {
  tick_duration_ms?: { avg?: number; p95?: number; p99?: number; max?: number };
  memory_mb?: { max?: number };
  fps?: { min?: number; avg?: number };
  network?: { maxBytesPerSecond?: number };
  client?: {
    fps_min?: number;
    fps_avg?: number;
    draw_calls_max?: number;
    triangles_max?: number;
    frame_time_ms_max?: number;
  };
}

export interface Scenario {
  name: string;
  description?: string;
  serverScript?: string;
  phases: ScenarioPhase[];
  thresholds?: ScenarioThresholds;
  clients?: number;
  browserClients?: number;
  warmupMs?: number;
}

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)$/);

  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60000;
    default: return value;
  }
}

export function loadScenario(filePath: string): Scenario {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = filePath.split('.').pop()?.toLowerCase();

  let raw: unknown;

  if (ext === 'yaml' || ext === 'yml') {
    raw = yaml.load(content);
  } else if (ext === 'json') {
    raw = JSON.parse(content);
  } else {
    throw new Error(`Unsupported scenario format: ${ext}. Use .yaml, .yml, or .json`);
  }

  return validateScenario(raw);
}

function validateScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Scenario must be an object');
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error('Scenario must have a "name" string field');
  }

  if (!Array.isArray(obj.phases) || obj.phases.length === 0) {
    throw new Error('Scenario must have a non-empty "phases" array');
  }

  return {
    name: obj.name,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    serverScript: typeof obj.serverScript === 'string' ? obj.serverScript : undefined,
    phases: obj.phases.map(validatePhase),
    thresholds: obj.thresholds as ScenarioThresholds | undefined,
    clients: typeof obj.clients === 'number' ? obj.clients : undefined,
    browserClients: typeof obj.browserClients === 'number' ? obj.browserClients : undefined,
    warmupMs: typeof obj.warmupMs === 'number' ? obj.warmupMs : undefined,
  };
}

function validatePhase(raw: unknown, index: number): ScenarioPhase {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Phase ${index} must be an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error(`Phase ${index} must have a "name" string`);
  }

  return {
    name: obj.name,
    duration: typeof obj.duration === 'string' ? obj.duration : undefined,
    actions: Array.isArray(obj.actions) ? obj.actions as ScenarioAction[] : undefined,
    collect: typeof obj.collect === 'boolean' ? obj.collect : undefined,
  };
}
