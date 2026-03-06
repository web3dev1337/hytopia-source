export interface ProcessSnapshotEntry {
  timestamp: number;
  cpuPct: number;
  rssMb: number;
  threads: number;
  fds: number;
}

export interface CollectedMetrics {
  serverSnapshots: ServerSnapshot[];
  clientSnapshots: ClientSnapshot[];
  tickReports: TickReportEntry[];
  spikes: SpikeEntry[];
  processSnapshots: ProcessSnapshotEntry[];
  startTime: number;
  endTime: number;
}

export interface ServerSnapshot {
  timestamp: number;
  avgTickMs: number;
  maxTickMs: number;
  p95TickMs: number;
  p99TickMs: number;
  ticksOverBudget: number;
  totalTicks: number;
  budgetMs: number;
  operations: Record<string, OperationSnapshot>;
  memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
  network?: {
    connectedPlayers: number;
    bytesSentTotal: number;
    bytesReceivedTotal: number;
    bytesSentPerSecond: number;
    bytesReceivedPerSecond: number;
    packetsSentPerSecond: number;
    packetsReceivedPerSecond: number;
    avgSerializationMs: number;
    compressionCount: number;
  };
}

export interface OperationSnapshot {
  count: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface ClientSnapshot {
  timestamp: number;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  textureMemoryMb: number;
}

export interface TickReportEntry {
  timestamp: number;
  tick: number;
  durationMs: number;
  budgetPercent: number;
  phases: Record<string, number>;
  entityCount: number;
  playerCount: number;
}

export interface SpikeEntry {
  timestamp: number;
  tick: number;
  durationMs: number;
  phases: Record<string, number>;
  entityCount: number;
}

export default class MetricCollector {
  private _serverSnapshots: ServerSnapshot[] = [];
  private _clientSnapshots: ClientSnapshot[] = [];
  private _tickReports: TickReportEntry[] = [];
  private _spikes: SpikeEntry[] = [];
  private _processSnapshots: ProcessSnapshotEntry[] = [];
  private _startTime: number = 0;
  private _collecting: boolean = false;

  public startCollecting(): void {
    this._collecting = true;
    this._startTime = Date.now();
    this._serverSnapshots = [];
    this._clientSnapshots = [];
    this._tickReports = [];
    this._spikes = [];
    this._processSnapshots = [];
  }

  public stopCollecting(): CollectedMetrics {
    this._collecting = false;

    return {
      serverSnapshots: this._serverSnapshots,
      clientSnapshots: this._clientSnapshots,
      tickReports: this._tickReports,
      spikes: this._spikes,
      processSnapshots: this._processSnapshots,
      startTime: this._startTime,
      endTime: Date.now(),
    };
  }

  public get isCollecting(): boolean {
    return this._collecting;
  }

  public addServerSnapshot(snapshot: ServerSnapshot): void {
    if (!this._collecting) return;

    this._serverSnapshots.push(snapshot);
  }

  public addClientSnapshot(snapshot: ClientSnapshot): void {
    if (!this._collecting) return;

    this._clientSnapshots.push(snapshot);
  }

  public addTickReport(report: TickReportEntry): void {
    if (!this._collecting) return;

    this._tickReports.push(report);
  }

  public addSpike(spike: SpikeEntry): void {
    if (!this._collecting) return;

    this._spikes.push(spike);
  }

  public addProcessSnapshot(snapshot: ProcessSnapshotEntry): void {
    if (!this._collecting) return;

    this._processSnapshots.push(snapshot);
  }
}
