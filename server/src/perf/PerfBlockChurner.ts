import { WorldLoopEvent, type WorldLoopEventPayloads } from '@/worlds/WorldLoop';
import type World from '@/worlds/World';
import type Vector3Like from '@/shared/types/math/Vector3Like';

export type PerfBlockChurnMode = 'toggle' | 'place' | 'remove';

export interface PerfBlockChurnOptions {
  blocksPerTick: number;
  blockTypeId: number;
  mode?: PerfBlockChurnMode;
  min?: Vector3Like;
  max?: Vector3Like;
}

export default class PerfBlockChurner {
  private _world: World | null = null;
  private _options: PerfBlockChurnOptions | null = null;
  private _tickFn: ((payload: WorldLoopEventPayloads[WorldLoopEvent.TICK_START]) => void) | null = null;
  private _toggleParity: boolean = false;

  public get isRunning(): boolean {
    return !!this._tickFn;
  }

  public start(world: World, options: PerfBlockChurnOptions): void {
    this.stop();

    const blocksPerTick = Math.max(0, Math.floor(options.blocksPerTick));
    const blockTypeId = Math.max(0, Math.floor(options.blockTypeId));

    const min = options.min ?? { x: -32, y: 0, z: -32 };
    const max = options.max ?? { x: 32, y: 16, z: 32 };
    const bounds = normalizeBounds(min, max);
    const mode: PerfBlockChurnMode = options.mode ?? 'toggle';

    this._world = world;
    this._options = {
      blocksPerTick,
      blockTypeId,
      mode,
      min: bounds.min,
      max: bounds.max,
    };
    this._toggleParity = false;

    this._tickFn = () => {
      this._tick();
    };

    world.loop.on(WorldLoopEvent.TICK_START, this._tickFn);
  }

  public stop(): void {
    if (this._world && this._tickFn) {
      this._world.loop.off(WorldLoopEvent.TICK_START, this._tickFn);
    }

    this._world = null;
    this._options = null;
    this._tickFn = null;
    this._toggleParity = false;
  }

  private _tick(): void {
    if (!this._world || !this._options) return;

    const { blocksPerTick, blockTypeId, min, max, mode } = this._options;
    if (!min || !max) return;

    const rangeX = max.x - min.x + 1;
    const rangeY = max.y - min.y + 1;
    const rangeZ = max.z - min.z + 1;

    if (rangeX <= 0 || rangeY <= 0 || rangeZ <= 0) return;

    const toggleOn = this._toggleParity;
    this._toggleParity = !this._toggleParity;

    for (let i = 0; i < blocksPerTick; i++) {
      const x = min.x + randomInt(rangeX);
      const y = min.y + randomInt(rangeY);
      const z = min.z + randomInt(rangeZ);

      const nextId = mode === 'toggle'
        ? (toggleOn ? blockTypeId : 0)
        : mode === 'place'
          ? blockTypeId
          : 0;

      this._world.chunkLattice.setBlock({ x, y, z }, nextId);
    }
  }
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function normalizeBounds(a: Vector3Like, b: Vector3Like): { min: Vector3Like; max: Vector3Like } {
  return {
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    },
  };
}

