import * as fs from 'node:fs';
import type { BenchmarkResult } from '../runners/BenchmarkRunner.js';
import type { ComparisonResult } from '../runners/BaselineComparer.js';

export interface JsonReport {
  timestamp: string;
  scenario: string;
  durationMs: number;
  baseline: object;
  phases: object[];
  comparison?: object;
  metrics?: {
    tickReportCount: number;
    spikeCount: number;
    serverSnapshotCount: number;
    clientSnapshotCount: number;
  };
  capabilities?: {
    serverMetrics: boolean;
    serverMetricSources: string[];
    clientMetrics: boolean;
    clientMetricSources: string[];
  };
  validation?: {
    valid: boolean;
    warnings: string[];
    issues: string[];
  };
}

export default class JsonReporter {
  public generateReport(result: BenchmarkResult, comparison?: ComparisonResult): JsonReport {
    return {
      timestamp: new Date().toISOString(),
      scenario: result.scenario.name,
      durationMs: result.durationMs,
      baseline: result.baseline,
      phases: result.phaseResults,
      comparison: comparison ?? undefined,
      metrics: {
        tickReportCount: result.metrics.tickReports.length,
        spikeCount: result.metrics.spikes.length,
        serverSnapshotCount: result.metrics.serverSnapshots.length,
        clientSnapshotCount: result.metrics.clientSnapshots.length,
      },
      capabilities: {
        serverMetrics: result.capabilities.serverMetrics,
        serverMetricSources: result.capabilities.serverMetricSources,
        clientMetrics: result.capabilities.clientMetrics,
        clientMetricSources: result.capabilities.clientMetricSources,
      },
      validation: result.validation,
    };
  }

  public writeReport(report: JsonReport, outputPath: string): void {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  }

  public writeFullData(result: BenchmarkResult, outputPath: string): void {
    const data = {
      ...this.generateReport(result),
      rawMetrics: {
        serverSnapshots: result.metrics.serverSnapshots,
        clientSnapshots: result.metrics.clientSnapshots,
        tickReports: result.metrics.tickReports,
        spikes: result.metrics.spikes,
      },
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
