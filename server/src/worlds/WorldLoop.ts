import ErrorHandler from '@/errors/ErrorHandler';
import EventRouter from '@/events/EventRouter';
import PerformanceMonitor from '@/metrics/PerformanceMonitor';
import PlayerManager from '@/players/PlayerManager';
import Telemetry, { TelemetrySpanOperation } from '@/metrics/Telemetry';
import Ticker from '@/shared/classes/Ticker';
import { DEFAULT_TICK_RATE } from '@/worlds/physics/Simulation';
import type World from '@/worlds/World';

/**
 * Event types a WorldLoop instance can emit.
 *
 * See `WorldLoopEventPayloads` for the payloads.
 *
 * **Category:** Events
 * @public
 */
export enum WorldLoopEvent {
  START      = 'WORLD_LOOP.START',
  STOP       = 'WORLD_LOOP.STOP',
  TICK_START = 'WORLD_LOOP.TICK_START',
  TICK_END   = 'WORLD_LOOP.TICK_END',
  TICK_ERROR = 'WORLD_LOOP.TICK_ERROR',
}

/**
 * Event payloads for WorldLoop emitted events.
 *
 * **Category:** Events
 * @public
 */
export interface WorldLoopEventPayloads {
  /** Emitted when the world loop starts. */
  [WorldLoopEvent.START]:      { worldLoop: WorldLoop }

  /** Emitted when the world loop stops. */
  [WorldLoopEvent.STOP]:       { worldLoop: WorldLoop }

  /** Emitted when the world loop tick starts. */
  [WorldLoopEvent.TICK_START]: { worldLoop: WorldLoop, tickDeltaMs: number }

  /** Emitted when the world loop tick ends. */
  [WorldLoopEvent.TICK_END]:   { worldLoop: WorldLoop, tickDurationMs: number }

  /** Emitted when an error occurs during a world loop tick. */
  [WorldLoopEvent.TICK_ERROR]: { worldLoop: WorldLoop, error: Error }
}

/**
 * Manages the tick loop for a world.
 *
 * When to use: advanced scheduling or instrumentation of a world's tick cycle.
 * Do NOT use for: normal lifecycle control—use `World.start` and `World.stop`.
 *
 * @remarks
 * The world loop automatically handles ticking physics, entities, and other world logic.
 *
 * The internal order of tick operations is:
 * 1) Tick entity logic
 * 2) Step physics
 * 3) Check and emit entity updates
 * 4) Synchronize network packets with player clients
 *
 * <h2>Events</h2>
 *
 * This class is an EventRouter, and instances of it emit events with payloads listed under
 * `WorldLoopEventPayloads`.
 *
 * **Category:** Core
 * @public
 */
export default class WorldLoop extends EventRouter {
  /** @internal */
  private _currentTick: number = 0;

  /** @internal */
  private _ticker: Ticker;

  /** @internal */
  private _world: World;
  
  /** @internal */
  constructor(world: World, tickRate: number = DEFAULT_TICK_RATE) {
    super();

    this._ticker = new Ticker(tickRate, this._tick, this._onTickError);
    this._world = world;
  }

  /**
   * The current tick count of the world loop.
   *
   * **Category:** Core
   */
  public get currentTick(): number {
    return this._currentTick;
  }

  /**
   * Whether the world loop is started.
   *
   * **Category:** Core
   */
  public get isStarted(): boolean {
    return this._ticker.isStarted;
  }

  /**
   * The next scheduled tick time in milliseconds.
   *
   * **Category:** Core
   */
  public get nextTickMs(): number {
    return this._ticker.nextTickMs;
  }

  /**
   * The fixed timestep of the world loop in seconds.
   *
   * **Category:** Core
   */
  public get timestepS(): number {
    return this._ticker.fixedTimestepS;
  }

  /**
   * The world this loop manages.
   *
   * **Category:** Core
   */
  public get world(): World {
    return this._world;
  }

  /** @internal */
  public start(): void {
    this._ticker.start();

    this.emitWithWorld(this._world, WorldLoopEvent.START, { worldLoop: this });
  }

  /** @internal */
  public stop(): void {
    this._ticker.stop();

    this.emitWithWorld(this._world, WorldLoopEvent.STOP, { worldLoop: this });
  }

  /** @internal */
  private _tick = (tickDeltaMs: number): void => {
    this.emitWithWorld(this._world, WorldLoopEvent.TICK_START, {
      worldLoop: this,
      tickDeltaMs,
    });

    const tickStart = performance.now();
    const perfMon = PerformanceMonitor.instance;
    const profiling = perfMon.isEnabled;

    if (profiling) {
      perfMon.beginTick(
        this._currentTick,
        this._world.entityManager.entityCount,
        PlayerManager.instance.playerCount,
        this._world.id,
      );
    }

    Telemetry.startSpan({
      operation: TelemetrySpanOperation.WORLD_TICK,
      attributes: {
        serverPlayerCount: PlayerManager.instance.playerCount,
        targetTickRate: this._ticker.targetTicksPerSecond,
        targetTickRateMs: this._ticker.fixedTimestepMs,
        worldId: this._world.id,
        worldName: this._world.name,
        worldChunkCount: this._world.chunkLattice.chunkCount,
        worldEntityCount: this._world.entityManager.entityCount,
        worldLoopTick: this._currentTick,
      },
    }, () => {
      let phaseStart: number;

      phaseStart = profiling ? performance.now() : 0;
      Telemetry.startSpan({
        operation: TelemetrySpanOperation.ENTITIES_TICK,
      }, () => this._world.entityManager.tickEntities(tickDeltaMs));
      if (profiling) perfMon.recordPhase('entities_tick', performance.now() - phaseStart, this._world.id);

      phaseStart = profiling ? performance.now() : 0;
      Telemetry.startSpan({
        operation: TelemetrySpanOperation.SIMULATION_STEP,
      }, () => this._world.simulation.step(tickDeltaMs));
      if (profiling) perfMon.recordPhase('simulation_step', performance.now() - phaseStart, this._world.id);

      phaseStart = profiling ? performance.now() : 0;
      Telemetry.startSpan({
        operation: TelemetrySpanOperation.ENTITIES_EMIT_UPDATES,
      }, () => this._world.entityManager.checkAndEmitUpdates());
      if (profiling) perfMon.recordPhase('entities_emit_updates', performance.now() - phaseStart, this._world.id);

      if (this._world.networkSynchronizer.shouldSynchronize()) {
        phaseStart = profiling ? performance.now() : 0;
        Telemetry.startSpan({
          operation: TelemetrySpanOperation.NETWORK_SYNCHRONIZE,
        }, () => this._world.networkSynchronizer.synchronize());
        if (profiling) perfMon.recordPhase('network_synchronize', performance.now() - phaseStart, this._world.id);
      }
    });

    if (profiling) {
      perfMon.endTick(this._world.id);
    }

    this._currentTick++;

    this.emitWithWorld(this._world, WorldLoopEvent.TICK_END, {
      worldLoop: this,
      tickDurationMs: performance.now() - tickStart,
    });
  };

  /** @internal */
  private _onTickError = (error: Error) => {
    ErrorHandler.error(`WorldLoop._onTickError(): Error: ${error}`);

    this.emitWithWorld(this._world, WorldLoopEvent.TICK_ERROR, {
      worldLoop: this,
      error,
    });
  };
}
