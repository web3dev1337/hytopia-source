import EventRouter from '@/events/EventRouter';

export enum PerformanceMonitorEvent {
  TICK_REPORT = 'PERFORMANCE_MONITOR.TICK_REPORT',
  SPIKE_DETECTED = 'PERFORMANCE_MONITOR.SPIKE_DETECTED',
  SNAPSHOT = 'PERFORMANCE_MONITOR.SNAPSHOT',
}

export interface PerformanceMonitorEventPayloads {
  [PerformanceMonitorEvent.TICK_REPORT]: TickReport;
  [PerformanceMonitorEvent.SPIKE_DETECTED]: TickReport;
  [PerformanceMonitorEvent.SNAPSHOT]: PerformanceSnapshot;
}

export interface OperationStats {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface TickReport {
  worldId: number;
  tick: number;
  durationMs: number;
  budgetMs: number;
  budgetPercent: number;
  phases: Record<string, number>;
  entityCount: number;
  playerCount: number;
  heapUsedMb: number;
}

export interface PerformanceSnapshot {
  uptimeMs: number;
  tickRate: number;
  avgTickMs: number;
  maxTickMs: number;
  p95TickMs: number;
  p99TickMs: number;
  ticksOverBudget: number;
  totalTicks: number;
  budgetMs: number;
  operations: Record<string, OperationStats>;
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
}

export interface PerformanceMonitorOptions {
  spikeThresholdMs?: number;
  tickBudgetMs?: number;
  snapshotIntervalMs?: number;
  historySize?: number;
}

interface OperationAccumulator {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  samples: Float64Array;
  sampleIndex: number;
  sampleCount: number;
}

interface WorldTickState {
  tickDurations: Float64Array;
  tickIndex: number;
  tickCount: number;
  ticksOverBudget: number;
  maxTickMs: number;
  totalTicks: number;

  currentTick: number;
  currentTickStart: number;
  currentPhases: Record<string, number>;
  currentEntityCount: number;
  currentPlayerCount: number;
}

export default class PerformanceMonitor extends EventRouter {
  private static _instance: PerformanceMonitor;

  public static get instance(): PerformanceMonitor {
    if (!PerformanceMonitor._instance) {
      PerformanceMonitor._instance = new PerformanceMonitor();
    }

    return PerformanceMonitor._instance;
  }

  private _enabled: boolean = false;
  private _entityProfilingEnabled: boolean = false;
  private _spikeThresholdMs: number = 50;
  private _tickBudgetMs: number = 16.67;
  private _snapshotIntervalMs: number = 5000;
  private _historySize: number = 3600;
  private _startTime: number = 0;

  private _operations: Map<string, OperationAccumulator> = new Map();

  private _worldTicks: Map<number, WorldTickState> = new Map();

  private _entityCosts: Map<number, { tickMs: number; name: string }> = new Map();

  private _snapshotTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    super();
  }

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public get isEntityProfilingEnabled(): boolean {
    return this._enabled && this._entityProfilingEnabled;
  }

  public enable(options?: PerformanceMonitorOptions): void {
    if (this._enabled) return;

    this._enabled = true;
    this._startTime = performance.now();
    this._spikeThresholdMs = options?.spikeThresholdMs ?? 50;
    this._tickBudgetMs = options?.tickBudgetMs ?? 16.67;
    this._snapshotIntervalMs = options?.snapshotIntervalMs ?? 5000;

    this._historySize = options?.historySize ?? 3600;

    this._worldTicks.clear();
    this._operations.clear();
    this._entityCosts.clear();

    if (this._snapshotIntervalMs > 0) {
      this._snapshotTimer = setInterval(() => {
        const snapshot = this.getSnapshot();

        this.emit(PerformanceMonitorEvent.SNAPSHOT, snapshot);
      }, this._snapshotIntervalMs);
    }
  }

  public disable(): void {
    this._enabled = false;
    this._entityProfilingEnabled = false;

    if (this._snapshotTimer) {
      clearInterval(this._snapshotTimer);
      this._snapshotTimer = null;
    }
  }

  public enableEntityProfiling(enabled: boolean): void {
    this._entityProfilingEnabled = enabled;

    if (!enabled) {
      this._entityCosts.clear();
    }
  }

  public measure<T>(name: string, fn: () => T): T {
    if (!this._enabled) return fn();

    const start = performance.now();
    const result = fn();
    const durationMs = performance.now() - start;

    this._recordOperation(name, durationMs);

    return result;
  }

  public async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this._enabled) return fn();

    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;

    this._recordOperation(name, durationMs);

    return result;
  }

  public startTiming(name: string): () => void {
    if (!this._enabled) return () => {};

    const start = performance.now();

    return () => {
      this._recordOperation(name, performance.now() - start);
    };
  }

  public beginTick(tick: number, entityCount: number, playerCount: number, worldId: number = 0): void {
    const state = this._getOrCreateWorldTickState(worldId);

    state.currentTick = tick;
    state.currentTickStart = performance.now();
    state.currentPhases = {};
    state.currentEntityCount = entityCount;
    state.currentPlayerCount = playerCount;
  }

  public recordPhase(phaseName: string, durationMs: number, worldId: number = 0): void {
    const state = this._worldTicks.get(worldId);

    if (!state) {
      return;
    }

    state.currentPhases[phaseName] = durationMs;
  }

  public endTick(worldId: number = 0): void {
    const state = this._worldTicks.get(worldId);

    if (!state) {
      return;
    }

    const durationMs = performance.now() - state.currentTickStart;

    state.tickDurations[state.tickIndex] = durationMs;
    state.tickIndex = (state.tickIndex + 1) % state.tickDurations.length;
    state.tickCount = Math.min(state.tickCount + 1, state.tickDurations.length);
    state.totalTicks++;

    if (durationMs > state.maxTickMs) {
      state.maxTickMs = durationMs;
    }

    if (durationMs > this._tickBudgetMs) {
      state.ticksOverBudget++;
    }

    const heapUsedMb = process.memoryUsage().heapUsed / 1048576;

    const report: TickReport = {
      worldId,
      tick: state.currentTick,
      durationMs,
      budgetMs: this._tickBudgetMs,
      budgetPercent: (durationMs / this._tickBudgetMs) * 100,
      phases: { ...state.currentPhases },
      entityCount: state.currentEntityCount,
      playerCount: state.currentPlayerCount,
      heapUsedMb,
    };

    this.emit(PerformanceMonitorEvent.TICK_REPORT, report);

    if (durationMs > this._spikeThresholdMs) {
      this.emit(PerformanceMonitorEvent.SPIKE_DETECTED, report);
    }
  }

  public recordEntityCost(entityId: number, name: string, tickMs: number): void {
    this._entityCosts.set(entityId, { tickMs, name });
  }

  public getEntityCosts(): Map<number, { tickMs: number; name: string }> {
    return new Map(this._entityCosts);
  }

  public getSnapshot(worldId?: number): PerformanceSnapshot {
    const mem = process.memoryUsage();
    const tickSamples = typeof worldId === 'number'
      ? this._getTickSamples(worldId)
      : this._getAllTickSamples();
    const sorted = tickSamples.slice().sort((a, b) => a - b);

    const rollup = typeof worldId === 'number'
      ? this._getRollup(worldId)
      : this._getGlobalRollup();

    return {
      uptimeMs: performance.now() - this._startTime,
      tickRate: 60,
      avgTickMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
      maxTickMs: rollup.maxTickMs,
      p95TickMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      p99TickMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0,
      ticksOverBudget: rollup.ticksOverBudget,
      totalTicks: rollup.totalTicks,
      budgetMs: this._tickBudgetMs,
      operations: this._getOperationStats(),
      memory: {
        heapUsedMb: mem.heapUsed / 1048576,
        heapTotalMb: mem.heapTotal / 1048576,
        rssMb: mem.rss / 1048576,
      },
    };
  }

  public resetStats(): void {
    this._worldTicks.clear();
    this._operations.clear();
    this._entityCosts.clear();
  }

  private _recordOperation(name: string, durationMs: number): void {
    let acc = this._operations.get(name);

    if (!acc) {
      acc = {
        count: 0,
        totalMs: 0,
        minMs: Infinity,
        maxMs: 0,
        lastMs: 0,
        samples: new Float64Array(1000),
        sampleIndex: 0,
        sampleCount: 0,
      };
      this._operations.set(name, acc);
    }

    acc.count++;
    acc.totalMs += durationMs;
    acc.lastMs = durationMs;

    if (durationMs < acc.minMs) acc.minMs = durationMs;
    if (durationMs > acc.maxMs) acc.maxMs = durationMs;

    acc.samples[acc.sampleIndex] = durationMs;
    acc.sampleIndex = (acc.sampleIndex + 1) % acc.samples.length;
    acc.sampleCount = Math.min(acc.sampleCount + 1, acc.samples.length);
  }

  private _getOrCreateWorldTickState(worldId: number): WorldTickState {
    const id = Math.floor(worldId);
    let state = this._worldTicks.get(id);

    if (!state) {
      state = {
        tickDurations: new Float64Array(this._historySize),
        tickIndex: 0,
        tickCount: 0,
        ticksOverBudget: 0,
        maxTickMs: 0,
        totalTicks: 0,
        currentTick: 0,
        currentTickStart: 0,
        currentPhases: {},
        currentEntityCount: 0,
        currentPlayerCount: 0,
      };
      this._worldTicks.set(id, state);
    }

    return state;
  }

  private _getTickSamples(worldId: number): number[] {
    const state = this._worldTicks.get(Math.floor(worldId));

    if (!state || state.tickCount === 0) return [];

    const result: number[] = [];

    for (let i = 0; i < state.tickCount; i++) {
      result.push(state.tickDurations[i]);
    }

    return result;
  }

  private _getAllTickSamples(): number[] {
    const result: number[] = [];

    for (const state of this._worldTicks.values()) {
      for (let i = 0; i < state.tickCount; i++) {
        result.push(state.tickDurations[i]);
      }
    }

    return result;
  }

  private _getRollup(worldId: number): { maxTickMs: number; ticksOverBudget: number; totalTicks: number } {
    const state = this._worldTicks.get(Math.floor(worldId));

    return {
      maxTickMs: state?.maxTickMs ?? 0,
      ticksOverBudget: state?.ticksOverBudget ?? 0,
      totalTicks: state?.totalTicks ?? 0,
    };
  }

  private _getGlobalRollup(): { maxTickMs: number; ticksOverBudget: number; totalTicks: number } {
    let maxTickMs = 0;
    let ticksOverBudget = 0;
    let totalTicks = 0;

    for (const state of this._worldTicks.values()) {
      maxTickMs = Math.max(maxTickMs, state.maxTickMs);
      ticksOverBudget += state.ticksOverBudget;
      totalTicks += state.totalTicks;
    }

    return { maxTickMs, ticksOverBudget, totalTicks };
  }

  private _getOperationStats(): Record<string, OperationStats> {
    const result: Record<string, OperationStats> = {};

    for (const [ name, acc ] of this._operations) {
      const samples: number[] = [];

      for (let i = 0; i < acc.sampleCount; i++) {
        samples.push(acc.samples[i]);
      }

      samples.sort((a, b) => a - b);

      result[name] = {
        count: acc.count,
        totalMs: acc.totalMs,
        avgMs: acc.count > 0 ? acc.totalMs / acc.count : 0,
        minMs: acc.minMs === Infinity ? 0 : acc.minMs,
        maxMs: acc.maxMs,
        lastMs: acc.lastMs,
        p50Ms: samples.length > 0 ? samples[Math.floor(samples.length * 0.5)] : 0,
        p95Ms: samples.length > 0 ? samples[Math.floor(samples.length * 0.95)] : 0,
        p99Ms: samples.length > 0 ? samples[Math.floor(samples.length * 0.99)] : 0,
      };
    }

    return result;
  }
}
