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
  private _startTime: number = 0;

  private _operations: Map<string, OperationAccumulator> = new Map();

  private _tickDurations: Float64Array;
  private _tickIndex: number = 0;
  private _tickCount: number = 0;
  private _ticksOverBudget: number = 0;
  private _maxTickMs: number = 0;
  private _totalTicks: number = 0;

  private _currentTick: number = 0;
  private _currentTickStart: number = 0;
  private _currentPhases: Record<string, number> = {};
  private _currentEntityCount: number = 0;
  private _currentPlayerCount: number = 0;

  private _entityCosts: Map<number, { tickMs: number; name: string }> = new Map();

  private _snapshotTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    super();
    this._tickDurations = new Float64Array(3600);
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

    const historySize = options?.historySize ?? 3600;

    this._tickDurations = new Float64Array(historySize);
    this._tickIndex = 0;
    this._tickCount = 0;
    this._ticksOverBudget = 0;
    this._maxTickMs = 0;
    this._totalTicks = 0;
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

  public beginTick(tick: number, entityCount: number, playerCount: number): void {
    this._currentTick = tick;
    this._currentTickStart = performance.now();
    this._currentPhases = {};
    this._currentEntityCount = entityCount;
    this._currentPlayerCount = playerCount;
  }

  public recordPhase(phaseName: string, durationMs: number): void {
    this._currentPhases[phaseName] = durationMs;
    this._recordOperation(phaseName, durationMs);
  }

  public endTick(): void {
    const durationMs = performance.now() - this._currentTickStart;

    this._tickDurations[this._tickIndex] = durationMs;
    this._tickIndex = (this._tickIndex + 1) % this._tickDurations.length;
    this._tickCount = Math.min(this._tickCount + 1, this._tickDurations.length);
    this._totalTicks++;

    if (durationMs > this._maxTickMs) {
      this._maxTickMs = durationMs;
    }

    if (durationMs > this._tickBudgetMs) {
      this._ticksOverBudget++;
    }

    const heapUsedMb = process.memoryUsage().heapUsed / 1048576;

    const report: TickReport = {
      tick: this._currentTick,
      durationMs,
      budgetMs: this._tickBudgetMs,
      budgetPercent: (durationMs / this._tickBudgetMs) * 100,
      phases: { ...this._currentPhases },
      entityCount: this._currentEntityCount,
      playerCount: this._currentPlayerCount,
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

  public getSnapshot(): PerformanceSnapshot {
    const mem = process.memoryUsage();
    const tickSamples = this._getTickSamples();
    const sorted = tickSamples.slice().sort((a, b) => a - b);

    return {
      uptimeMs: performance.now() - this._startTime,
      tickRate: 60,
      avgTickMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
      maxTickMs: this._maxTickMs,
      p95TickMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      p99TickMs: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0,
      ticksOverBudget: this._ticksOverBudget,
      totalTicks: this._totalTicks,
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
    this._tickIndex = 0;
    this._tickCount = 0;
    this._ticksOverBudget = 0;
    this._maxTickMs = 0;
    this._totalTicks = 0;
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

  private _getTickSamples(): number[] {
    if (this._tickCount === 0) return [];

    const result: number[] = [];

    for (let i = 0; i < this._tickCount; i++) {
      result.push(this._tickDurations[i]);
    }

    return result;
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
