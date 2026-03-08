import type { BenchmarkResult } from '../runners/BenchmarkRunner.js';
import type { ComparisonResult } from '../runners/BaselineComparer.js';

export default class ConsoleReporter {
  public reportBenchmark(result: BenchmarkResult): void {
    console.log('');
    console.log(`=== Benchmark: ${result.scenario.name} ===`);
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log('');

    const b = result.baseline;

    console.log('Server Tick Performance:');
    console.log(`  avg: ${b.avgTickMs.toFixed(2)}ms`);
    console.log(`  p95: ${b.p95TickMs.toFixed(2)}ms`);
    console.log(`  p99: ${b.p99TickMs.toFixed(2)}ms`);
    console.log(`  max: ${b.maxTickMs.toFixed(2)}ms`);
    console.log(`  over budget: ${b.ticksOverBudgetPct.toFixed(1)}%`);
    console.log('');

    console.log(`Memory: ${b.avgMemoryMb.toFixed(1)}MB avg heap`);

    if (result.processMetrics && result.processMetrics.snapshots.length > 0) {
      const pm = result.processMetrics;
      console.log('');
      console.log('Process Metrics (OS-level):');
      console.log(`  CPU: avg=${pm.avgCpuPct.toFixed(1)}% max=${pm.maxCpuPct.toFixed(1)}%${pm.maxCpuPct > 90 ? ' FAIL' : pm.maxCpuPct > 70 ? ' WARN' : ''}`);
      console.log(`  RSS: avg=${pm.avgRssMb.toFixed(1)}MB max=${pm.maxRssMb.toFixed(1)}MB`);
      console.log(`  Threads: max=${pm.maxThreads}`);
      console.log(`  FDs: max=${pm.maxFds}`);
    }

    if (b.client) {
      console.log('');
      console.log('Client Performance:');
      console.log(`  FPS: avg=${b.client.avgFps.toFixed(1)} min=${b.client.minFps.toFixed(1)}`);
      console.log(`  Frame time: avg=${b.client.avgFrameTimeMs.toFixed(2)}ms`);
      console.log(`  Draw calls: avg=${b.client.avgDrawCalls.toFixed(0)} max=${b.client.maxDrawCalls}`);
      console.log(`  Triangles: avg=${this._formatK(b.client.avgTriangles)} max=${this._formatK(b.client.maxTriangles)}`);
      console.log(`  Geometries: avg=${b.client.avgGeometries.toFixed(0)}`);
      console.log(`  Entities: avg=${b.client.avgEntities.toFixed(0)}`);
      console.log(`  Visible chunks: avg=${b.client.avgVisibleChunks.toFixed(0)}`);

      if (b.client.avgUsedMemoryMb > 0) {
        console.log(`  JS Heap: avg=${b.client.avgUsedMemoryMb.toFixed(1)}MB`);
      }
    } else if (b.avgFps !== undefined) {
      console.log(`Client FPS: ${b.avgFps.toFixed(1)} avg`);
    }

    if (b.network) {
      console.log('');
      console.log('Network (server):');
      console.log(`  bytes sent: avg=${(b.network.avgBytesSentPerSecond / 1_000_000).toFixed(2)}MB/s max=${(b.network.maxBytesSentPerSecond / 1_000_000).toFixed(2)}MB/s`);
      console.log(`  bytes recv: avg=${(b.network.avgBytesReceivedPerSecond / 1_000_000).toFixed(2)}MB/s max=${(b.network.maxBytesReceivedPerSecond / 1_000_000).toFixed(2)}MB/s`);
      console.log(`  totals: sent=${(b.network.totalBytesSent / 1_000_000).toFixed(1)}MB recv=${(b.network.totalBytesReceived / 1_000_000).toFixed(1)}MB players=${b.network.maxConnectedPlayers}`);
      console.log(`  serialize: avg=${b.network.avgSerializationMs.toFixed(2)}ms compressTotal=${b.network.compressionCountTotal}`);
    }

    const opNames = Object.keys(b.operations);

    if (opNames.length > 0) {
      console.log('');
      console.log('Operations:');

      for (const name of opNames.sort()) {
        const op = b.operations[name];

        console.log(`  ${name}: avg=${op.avgMs.toFixed(2)}ms p95=${op.p95Ms.toFixed(2)}ms`);
      }
    }

    console.log('');

    if (result.scenario.thresholds) {
      this._reportThresholds(result);
    }

    console.log('Phases:');

    for (const phase of result.phaseResults) {
      console.log(`  ${phase.name}: ${(phase.durationMs / 1000).toFixed(1)}s${phase.collected ? ' (collected)' : ''}`);
    }

    console.log('');

    if (result.validation.warnings.length > 0 || result.validation.issues.length > 0) {
      console.log('Validation:');

      for (const warning of result.validation.warnings) {
        console.log(`  WARN ${warning}`);
      }

      for (const issue of result.validation.issues) {
        console.log(`  FAIL ${issue}`);
      }

      console.log(`  Overall: ${result.validation.valid ? 'VALID' : 'INVALID'}`);
      console.log('');
    }
  }

  public reportComparison(comparison: ComparisonResult): void {
    console.log('');
    console.log(`=== Comparison: ${comparison.scenarioName} ===`);
    console.log(`Thresholds: warning >${comparison.warningThresholdPct}%, fail >${comparison.failThresholdPct}%`);
    console.log(`Overall: ${this._statusIcon(comparison.overallStatus)} ${comparison.overallStatus.toUpperCase()}`);
    console.log('');

    const maxNameLen = Math.max(...comparison.entries.map(e => e.metric.length));

    for (const entry of comparison.entries) {
      const name = entry.metric.padEnd(maxNameLen);
      const icon = this._statusIcon(entry.status);
      const change = entry.changePct > 0 ? `+${entry.changePct.toFixed(1)}%` : `${entry.changePct.toFixed(1)}%`;

      console.log(`  ${icon} ${name}  ${entry.baseline.toFixed(2)} -> ${entry.current.toFixed(2)}  (${change})`);
    }

    console.log('');
  }

  private _reportThresholds(result: BenchmarkResult): void {
    const t = result.scenario.thresholds!;
    const b = result.baseline;
    let allPass = true;

    console.log('Threshold Checks:');

    if (t.tick_duration_ms) {
      if (t.tick_duration_ms.avg !== undefined) {
        const pass = b.avgTickMs <= t.tick_duration_ms.avg;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} tick avg ${b.avgTickMs.toFixed(2)}ms <= ${t.tick_duration_ms.avg}ms`);
      }

      if (t.tick_duration_ms.p99 !== undefined) {
        const pass = b.p99TickMs <= t.tick_duration_ms.p99;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} tick p99 ${b.p99TickMs.toFixed(2)}ms <= ${t.tick_duration_ms.p99}ms`);
      }
    }

    if (t.memory_mb?.max !== undefined) {
      const pass = b.avgMemoryMb <= t.memory_mb.max;

      allPass = allPass && pass;
      console.log(`  ${pass ? 'PASS' : 'FAIL'} memory ${b.avgMemoryMb.toFixed(1)}MB <= ${t.memory_mb.max}MB`);
    }

    if (t.client && b.client) {
      const ct = t.client;

      if (ct.fps_min !== undefined) {
        const pass = b.client.minFps >= ct.fps_min;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} client minFps ${b.client.minFps.toFixed(1)} >= ${ct.fps_min}`);
      }

      if (ct.fps_avg !== undefined) {
        const pass = b.client.avgFps >= ct.fps_avg;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} client avgFps ${b.client.avgFps.toFixed(1)} >= ${ct.fps_avg}`);
      }

      if (ct.draw_calls_max !== undefined) {
        const pass = b.client.maxDrawCalls <= ct.draw_calls_max;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} client maxDrawCalls ${b.client.maxDrawCalls} <= ${ct.draw_calls_max}`);
      }

      if (ct.triangles_max !== undefined) {
        const pass = b.client.maxTriangles <= ct.triangles_max;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} client maxTriangles ${b.client.maxTriangles} <= ${ct.triangles_max}`);
      }

      if (ct.frame_time_ms_max !== undefined) {
        const pass = b.client.avgFrameTimeMs <= ct.frame_time_ms_max;

        allPass = allPass && pass;
        console.log(`  ${pass ? 'PASS' : 'FAIL'} client avgFrameTime ${b.client.avgFrameTimeMs.toFixed(2)}ms <= ${ct.frame_time_ms_max}ms`);
      }
    }

    if (t.network?.maxBytesPerSecond !== undefined && b.network) {
      const pass = b.network.maxBytesSentPerSecond <= t.network.maxBytesPerSecond;

      allPass = allPass && pass;
      console.log(`  ${pass ? 'PASS' : 'FAIL'} net maxBytesSent ${(b.network.maxBytesSentPerSecond / 1_000_000).toFixed(2)}MB/s <= ${(t.network.maxBytesPerSecond / 1_000_000).toFixed(2)}MB/s`);
    }

    console.log(`  Overall: ${allPass ? 'ALL PASS' : 'SOME FAILED'}`);
    console.log('');
  }

  private _formatK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
  }

  private _statusIcon(status: 'pass' | 'warning' | 'fail'): string {
    switch (status) {
      case 'pass': return 'OK';
      case 'warning': return 'WARN';
      case 'fail': return 'FAIL';
    }
  }
}
