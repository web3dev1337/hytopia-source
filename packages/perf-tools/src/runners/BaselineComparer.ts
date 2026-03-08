import * as fs from 'node:fs';

export interface BaselineResult {
  avgTickMs: number;
  maxTickMs: number;
  p95TickMs: number;
  p99TickMs: number;
  ticksOverBudgetPct: number;
  avgMemoryMb: number;
  avgFps?: number;
  client?: {
    avgFps: number;
    minFps: number;
    avgFrameTimeMs: number;
    avgDrawCalls: number;
    maxDrawCalls: number;
    avgTriangles: number;
    maxTriangles: number;
    avgGeometries: number;
    avgEntities: number;
    avgVisibleChunks: number;
    avgUsedMemoryMb: number;
  };
  operations: Record<string, { avgMs: number; p95Ms: number }>;
  network?: {
    totalBytesSent: number;
    totalBytesReceived: number;
    maxConnectedPlayers: number;
    avgBytesSentPerSecond: number;
    maxBytesSentPerSecond: number;
    avgBytesReceivedPerSecond: number;
    maxBytesReceivedPerSecond: number;
    avgPacketsSentPerSecond: number;
    maxPacketsSentPerSecond: number;
    avgPacketsReceivedPerSecond: number;
    maxPacketsReceivedPerSecond: number;
    avgSerializationMs: number;
    compressionCountTotal: number;
  };
}

export interface ComparisonEntry {
  metric: string;
  baseline: number;
  current: number;
  changePct: number;
  status: 'pass' | 'warning' | 'fail';
}

export interface ComparisonResult {
  scenarioName: string;
  entries: ComparisonEntry[];
  overallStatus: 'pass' | 'warning' | 'fail';
  warningThresholdPct: number;
  failThresholdPct: number;
}

export interface BaselineComparerOptions {
  warningThresholdPct?: number;
  failThresholdPct?: number;
}

export interface ComparisonScope {
  includeServerMetrics?: boolean;
  includeServerTailMetrics?: boolean;
  includeServerBudgetMetrics?: boolean;
  includeServerNetworkMetrics?: boolean;
  includeClientMetrics?: boolean;
  includeClientRenderMetrics?: boolean;
}

export interface LoadedBenchmarkInput {
  baseline: BaselineResult;
  metrics?: {
    serverSnapshotCount?: number;
    clientSnapshotCount?: number;
  };
  validation?: {
    valid?: boolean;
    warnings?: string[];
    issues?: string[];
  };
  capabilities?: {
    serverMetricSources?: string[];
    clientMetricSources?: string[];
  };
}

export default class BaselineComparer {
  private _warningPct: number;
  private _failPct: number;

  constructor(options?: BaselineComparerOptions) {
    this._warningPct = options?.warningThresholdPct ?? 5;
    this._failPct = options?.failThresholdPct ?? 15;
  }

  public compare(
    baseline: BaselineResult,
    current: BaselineResult,
    scenarioName: string = 'benchmark',
    scope?: ComparisonScope,
  ): ComparisonResult {
    const entries: ComparisonEntry[] = [];
    const includeServerMetrics = scope?.includeServerMetrics ?? true;
    const includeServerTailMetrics = scope?.includeServerTailMetrics ?? includeServerMetrics;
    const includeServerBudgetMetrics = scope?.includeServerBudgetMetrics ?? includeServerMetrics;
    const includeServerNetworkMetrics = scope?.includeServerNetworkMetrics ?? includeServerMetrics;
    const includeClientMetrics = scope?.includeClientMetrics ?? true;
    const includeClientRenderMetrics = scope?.includeClientRenderMetrics ?? includeClientMetrics;

    if (includeServerMetrics) {
      entries.push(this._compareMetric('avgTickMs', baseline.avgTickMs, current.avgTickMs));
      entries.push(this._compareMetric('maxTickMs', baseline.maxTickMs, current.maxTickMs));
      entries.push(this._compareMetric('p95TickMs', baseline.p95TickMs, current.p95TickMs));
      entries.push(this._compareMetric('avgMemoryMb', baseline.avgMemoryMb, current.avgMemoryMb));

      if (includeServerTailMetrics) {
        entries.push(this._compareMetric('p99TickMs', baseline.p99TickMs, current.p99TickMs));
      }

      if (includeServerBudgetMetrics) {
        entries.push(this._compareMetric('ticksOverBudgetPct', baseline.ticksOverBudgetPct, current.ticksOverBudgetPct));
      }
    }

    if (includeClientMetrics && baseline.avgFps !== undefined && current.avgFps !== undefined) {
      entries.push(this._compareMetric('avgFps', baseline.avgFps, current.avgFps, true));
    }

    if (includeClientMetrics && baseline.client && current.client) {
      entries.push(this._compareMetric('client.avgFps', baseline.client.avgFps, current.client.avgFps, true));
      entries.push(this._compareMetric('client.minFps', baseline.client.minFps, current.client.minFps, true));
      entries.push(this._compareMetric('client.avgFrameTimeMs', baseline.client.avgFrameTimeMs, current.client.avgFrameTimeMs));

      if (includeClientRenderMetrics) {
        entries.push(this._compareMetric('client.avgDrawCalls', baseline.client.avgDrawCalls, current.client.avgDrawCalls));
        entries.push(this._compareMetric('client.avgTriangles', baseline.client.avgTriangles, current.client.avgTriangles));
      }
    }

    if (includeServerMetrics && includeServerNetworkMetrics && baseline.network && current.network) {
      entries.push(this._compareMetric('net.maxBytesSentPerSecond', baseline.network.maxBytesSentPerSecond, current.network.maxBytesSentPerSecond));
      entries.push(this._compareMetric('net.avgBytesSentPerSecond', baseline.network.avgBytesSentPerSecond, current.network.avgBytesSentPerSecond));
      entries.push(this._compareMetric('net.avgSerializationMs', baseline.network.avgSerializationMs, current.network.avgSerializationMs));
    }

    const allBaselineOps = includeServerMetrics
      ? new Set([...Object.keys(baseline.operations ?? {}), ...Object.keys(current.operations ?? {})])
      : new Set<string>();

    for (const op of allBaselineOps) {
      if (baseline.operations?.[op] && current.operations?.[op]) {
        entries.push(this._compareMetric(`ops.${op}.avgMs`, baseline.operations[op].avgMs, current.operations[op].avgMs));
        entries.push(this._compareMetric(`ops.${op}.p95Ms`, baseline.operations[op].p95Ms, current.operations[op].p95Ms));
      }
    }

    const overallStatus = entries.some(e => e.status === 'fail')
      ? 'fail'
      : entries.some(e => e.status === 'warning')
        ? 'warning'
        : 'pass';

    return {
      scenarioName,
      entries,
      overallStatus,
      warningThresholdPct: this._warningPct,
      failThresholdPct: this._failPct,
    };
  }

  public static loadInput(filePath: string): LoadedBenchmarkInput {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.baseline && typeof data.baseline === 'object' && 'avgTickMs' in data.baseline) {
      return {
        baseline: data.baseline as BaselineResult,
        metrics: data.metrics,
        validation: data.validation,
        capabilities: data.capabilities,
      };
    }

    return {
      baseline: data as BaselineResult,
    };
  }

  public static loadBaseline(filePath: string): BaselineResult {
    return BaselineComparer.loadInput(filePath).baseline;
  }

  public static saveBaseline(filePath: string, baseline: BaselineResult): void {
    fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf-8');
  }

  private _compareMetric(name: string, baseline: number, current: number, lowerIsBetter: boolean = false): ComparisonEntry {
    if (baseline === 0) {
      return { metric: name, baseline, current, changePct: 0, status: 'pass' };
    }

    const changePct = lowerIsBetter
      ? ((baseline - current) / baseline) * 100
      : ((current - baseline) / baseline) * 100;

    let status: 'pass' | 'warning' | 'fail' = 'pass';

    if (changePct > this._failPct) {
      status = 'fail';
    } else if (changePct > this._warningPct) {
      status = 'warning';
    }

    return { metric: name, baseline, current, changePct, status };
  }
}
