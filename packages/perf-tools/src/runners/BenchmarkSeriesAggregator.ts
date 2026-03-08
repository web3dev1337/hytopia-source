import * as fs from 'node:fs';
import type { BaselineResult, ComparisonEntry, ComparisonResult, LoadedBenchmarkInput } from './BaselineComparer.js';

export interface AggregatedBenchmarkInput extends LoadedBenchmarkInput {
  scenario?: string;
  durationMs?: number;
  aggregation: {
    method: 'median';
    runCount: number;
    sourceFiles: string[];
  };
}

export type SeriesVerdict = 'improves' | 'neutral' | 'regresses' | 'inconclusive';

export interface SeriesComparisonSummary {
  comparison: ComparisonResult;
  verdict: SeriesVerdict;
  keyEntries: ComparisonEntry[];
}

const CORE_METRICS = new Set([
  'avgTickMs',
  'p95TickMs',
  'avgFps',
  'client.avgFrameTimeMs',
]);

type ReportWithMetadata = LoadedBenchmarkInput & {
  scenario?: string;
  durationMs?: number;
};

export default class BenchmarkSeriesAggregator {
  public aggregateFiles(filePaths: string[]): AggregatedBenchmarkInput {
    if (filePaths.length === 0) {
      throw new Error('aggregateFiles(): expected at least one benchmark report.');
    }

    const reports = filePaths.map(filePath => this._loadReport(filePath));

    for (const [index, report] of reports.entries()) {
      if (report.validation?.valid === false) {
        throw new Error(`aggregateFiles(): ${filePaths[index]} is invalid and cannot be aggregated.`);
      }
    }

    const scenario = this._firstDefined(reports.map(report => report.scenario));
    const durationMsValues = reports
      .map(report => report.durationMs)
      .filter((value): value is number => value !== undefined);

    return {
      scenario,
      durationMs: durationMsValues.length > 0 ? this._median(durationMsValues) : undefined,
      baseline: this._aggregateBaseline(reports.map(report => report.baseline)),
      metrics: this._aggregateMetrics(reports),
      validation: {
        valid: true,
        warnings: [
          `Aggregated ${filePaths.length} benchmark reports using the median for each numeric metric.`,
        ],
        issues: [],
      },
      capabilities: this._aggregateCapabilities(reports),
      aggregation: {
        method: 'median',
        runCount: filePaths.length,
        sourceFiles: filePaths,
      },
    };
  }

  public classifyComparison(comparison: ComparisonResult): SeriesComparisonSummary {
    const keyEntries = comparison.entries.filter(entry => CORE_METRICS.has(entry.metric));
    const improvements = keyEntries.filter(entry => entry.changePct < -comparison.warningThresholdPct);
    const regressions = keyEntries.filter(entry => entry.changePct > comparison.warningThresholdPct);

    let verdict: SeriesVerdict = 'inconclusive';

    if (keyEntries.length === 0) {
      verdict = 'inconclusive';
    } else if (regressions.length === 0 && improvements.length === 0) {
      verdict = 'neutral';
    } else if (regressions.length > 0 && improvements.length === 0) {
      verdict = 'regresses';
    } else if (improvements.length > 0 && regressions.length === 0) {
      verdict = 'improves';
    } else {
      verdict = 'inconclusive';
    }

    return {
      comparison,
      verdict,
      keyEntries,
    };
  }

  private _loadReport(filePath: string): ReportWithMetadata {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const loaded = ('baseline' in data ? data : { baseline: data }) as ReportWithMetadata;

    return {
      scenario: loaded.scenario,
      durationMs: loaded.durationMs,
      baseline: loaded.baseline,
      metrics: loaded.metrics,
      validation: loaded.validation,
      capabilities: loaded.capabilities,
    };
  }

  private _aggregateBaseline(results: BaselineResult[]): BaselineResult {
    const baseline: BaselineResult = {
      avgTickMs: this._median(results.map(result => result.avgTickMs)),
      maxTickMs: this._median(results.map(result => result.maxTickMs)),
      p95TickMs: this._median(results.map(result => result.p95TickMs)),
      p99TickMs: this._median(results.map(result => result.p99TickMs)),
      ticksOverBudgetPct: this._median(results.map(result => result.ticksOverBudgetPct)),
      avgMemoryMb: this._median(results.map(result => result.avgMemoryMb)),
      operations: this._aggregateOperations(results),
    };

    if (results.every(result => result.avgFps !== undefined)) {
      baseline.avgFps = this._median(results.map(result => result.avgFps as number));
    }

    if (results.every(result => result.client !== undefined)) {
      baseline.client = {
        avgFps: this._median(results.map(result => result.client!.avgFps)),
        minFps: this._median(results.map(result => result.client!.minFps)),
        avgFrameTimeMs: this._median(results.map(result => result.client!.avgFrameTimeMs)),
        avgDrawCalls: this._median(results.map(result => result.client!.avgDrawCalls)),
        maxDrawCalls: this._median(results.map(result => result.client!.maxDrawCalls)),
        avgTriangles: this._median(results.map(result => result.client!.avgTriangles)),
        maxTriangles: this._median(results.map(result => result.client!.maxTriangles)),
        avgGeometries: this._median(results.map(result => result.client!.avgGeometries)),
        avgEntities: this._median(results.map(result => result.client!.avgEntities)),
        avgVisibleChunks: this._median(results.map(result => result.client!.avgVisibleChunks)),
        avgUsedMemoryMb: this._median(results.map(result => result.client!.avgUsedMemoryMb)),
      };
    }

    if (results.every(result => result.network !== undefined)) {
      baseline.network = {
        totalBytesSent: this._median(results.map(result => result.network!.totalBytesSent)),
        totalBytesReceived: this._median(results.map(result => result.network!.totalBytesReceived)),
        maxConnectedPlayers: this._median(results.map(result => result.network!.maxConnectedPlayers)),
        avgBytesSentPerSecond: this._median(results.map(result => result.network!.avgBytesSentPerSecond)),
        maxBytesSentPerSecond: this._median(results.map(result => result.network!.maxBytesSentPerSecond)),
        avgBytesReceivedPerSecond: this._median(results.map(result => result.network!.avgBytesReceivedPerSecond)),
        maxBytesReceivedPerSecond: this._median(results.map(result => result.network!.maxBytesReceivedPerSecond)),
        avgPacketsSentPerSecond: this._median(results.map(result => result.network!.avgPacketsSentPerSecond)),
        maxPacketsSentPerSecond: this._median(results.map(result => result.network!.maxPacketsSentPerSecond)),
        avgPacketsReceivedPerSecond: this._median(results.map(result => result.network!.avgPacketsReceivedPerSecond)),
        maxPacketsReceivedPerSecond: this._median(results.map(result => result.network!.maxPacketsReceivedPerSecond)),
        avgSerializationMs: this._median(results.map(result => result.network!.avgSerializationMs)),
        compressionCountTotal: this._median(results.map(result => result.network!.compressionCountTotal)),
      };
    }

    return baseline;
  }

  private _aggregateOperations(results: BaselineResult[]): BaselineResult['operations'] {
    if (results.length === 0) {
      return {};
    }

    const sharedOperationNames = results
      .map(result => new Set(Object.keys(result.operations ?? {})))
      .reduce((shared, current) => {
        return new Set([...shared].filter(name => current.has(name)));
      });

    const operations: BaselineResult['operations'] = {};

    for (const operationName of sharedOperationNames) {
      operations[operationName] = {
        avgMs: this._median(results.map(result => result.operations[operationName].avgMs)),
        p95Ms: this._median(results.map(result => result.operations[operationName].p95Ms)),
      };
    }

    return operations;
  }

  private _aggregateMetrics(reports: ReportWithMetadata[]): AggregatedBenchmarkInput['metrics'] {
    const tickReportCounts = reports
      .map(report => report.metrics?.tickReportCount)
      .filter((value): value is number => value !== undefined);
    const spikeCounts = reports
      .map(report => report.metrics?.spikeCount)
      .filter((value): value is number => value !== undefined);
    const serverSnapshotCounts = reports
      .map(report => report.metrics?.serverSnapshotCount)
      .filter((value): value is number => value !== undefined);
    const clientSnapshotCounts = reports
      .map(report => report.metrics?.clientSnapshotCount)
      .filter((value): value is number => value !== undefined);

    return {
      tickReportCount: tickReportCounts.length > 0 ? this._median(tickReportCounts) : undefined,
      spikeCount: spikeCounts.length > 0 ? this._median(spikeCounts) : undefined,
      serverSnapshotCount: serverSnapshotCounts.length > 0 ? this._median(serverSnapshotCounts) : undefined,
      clientSnapshotCount: clientSnapshotCounts.length > 0 ? this._median(clientSnapshotCounts) : undefined,
    };
  }

  private _aggregateCapabilities(reports: ReportWithMetadata[]): AggregatedBenchmarkInput['capabilities'] {
    const serverMetricSources = reports
      .map(report => report.capabilities?.serverMetricSources ?? [])
      .reduce((shared, sources) => shared.filter(source => sources.includes(source)));
    const clientMetricSources = reports
      .map(report => report.capabilities?.clientMetricSources ?? [])
      .reduce((shared, sources) => shared.filter(source => sources.includes(source)));

    return {
      serverMetrics: reports.every(report => report.capabilities?.serverMetrics !== false),
      serverMetricSources,
      clientMetrics: reports.every(report => report.capabilities?.clientMetrics !== false),
      clientMetricSources,
    };
  }

  private _median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middleIndex = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[middleIndex];
    }

    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  private _firstDefined<T>(values: Array<T | undefined>): T | undefined {
    return values.find((value): value is T => value !== undefined);
  }
}
