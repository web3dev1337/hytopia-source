import { spawn, type ChildProcess } from 'node:child_process';
import MetricCollector, { type CollectedMetrics } from './MetricCollector.js';
import HeadlessClient from './HeadlessClient.js';
import { type Scenario, type ScenarioPhase, parseDuration } from './ScenarioLoader.js';
import type { BaselineResult } from './BaselineComparer.js';

export interface BenchmarkRunnerOptions {
  serverCommand?: string;
  serverCwd?: string;
  clientUrl?: string;
  headless?: boolean;
  verbose?: boolean;
}

export interface BenchmarkResult {
  scenario: Scenario;
  metrics: CollectedMetrics;
  baseline: BaselineResult;
  durationMs: number;
  phaseResults: PhaseResult[];
}

export interface PhaseResult {
  name: string;
  durationMs: number;
  collected: boolean;
}

export default class BenchmarkRunner {
  private _options: Required<BenchmarkRunnerOptions>;
  private _collector: MetricCollector;
  private _serverProcess: ChildProcess | null = null;
  private _clients: HeadlessClient[] = [];
  private _log: (msg: string) => void;

  constructor(options?: BenchmarkRunnerOptions) {
    this._options = {
      serverCommand: 'npm run dev',
      serverCwd: '.',
      clientUrl: 'http://localhost:8080',
      headless: true,
      verbose: false,
      ...options,
    };
    this._collector = new MetricCollector();
    this._log = this._options.verbose ? console.log : () => {};
  }

  public async run(scenario: Scenario): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const phaseResults: PhaseResult[] = [];

    this._log(`[bench] Starting scenario: ${scenario.name}`);

    try {
      if (scenario.serverScript) {
        await this._startServer(scenario.serverScript);
      }

      if (scenario.clients && scenario.clients > 0) {
        await this._launchClients(scenario.clients);
      }

      if (scenario.warmupMs) {
        this._log(`[bench] Warming up for ${scenario.warmupMs}ms`);
        await this._wait(scenario.warmupMs);
      }

      for (const phase of scenario.phases) {
        const phaseResult = await this._runPhase(phase);

        phaseResults.push(phaseResult);
      }
    } finally {
      await this._cleanup();
    }

    const metrics = this._collector.stopCollecting();
    const baseline = this._buildBaseline(metrics);

    return {
      scenario,
      metrics,
      baseline,
      durationMs: Date.now() - startTime,
      phaseResults,
    };
  }

  private async _runPhase(phase: ScenarioPhase): Promise<PhaseResult> {
    const startTime = Date.now();

    this._log(`[bench] Phase: ${phase.name}`);

    if (phase.collect) {
      this._collector.startCollecting();
    }

    if (phase.actions) {
      for (const action of phase.actions) {
        this._log(`[bench]   Action: ${action.type}`);

        switch (action.type) {
          case 'wait':
            if (action.durationMs) {
              await this._wait(action.durationMs);
            }
            break;
          case 'spawn_bots':
          case 'despawn_bots':
          case 'spawn_entities':
          case 'load_map':
          case 'custom':
            this._log(`[bench]   Action ${action.type} - would execute via server API`);
            break;
        }
      }
    }

    if (phase.duration) {
      const durationMs = parseDuration(phase.duration);

      this._log(`[bench]   Waiting ${durationMs}ms`);
      await this._collectDuring(durationMs);
    }

    return {
      name: phase.name,
      durationMs: Date.now() - startTime,
      collected: phase.collect ?? false,
    };
  }

  private async _collectDuring(durationMs: number): Promise<void> {
    const intervalMs = 1000;
    const intervals = Math.ceil(durationMs / intervalMs);

    for (let i = 0; i < intervals; i++) {
      const remaining = Math.min(intervalMs, durationMs - i * intervalMs);

      await this._wait(remaining);

      for (const client of this._clients) {
        const snapshot = await client.collectClientMetrics();

        if (snapshot) {
          this._collector.addClientSnapshot(snapshot);
        }
      }
    }
  }

  private async _startServer(scriptPath: string): Promise<void> {
    this._log(`[bench] Starting server: ${scriptPath}`);

    const [cmd, ...args] = this._options.serverCommand.split(' ');

    this._serverProcess = spawn(cmd, args, {
      cwd: this._options.serverCwd,
      stdio: this._options.verbose ? 'inherit' : 'pipe',
      env: { ...process.env, PERF_SCRIPT: scriptPath },
    });

    await this._wait(3000);
  }

  private async _launchClients(count: number): Promise<void> {
    this._log(`[bench] Launching ${count} headless client(s)`);

    for (let i = 0; i < count; i++) {
      const client = new HeadlessClient({
        url: this._options.clientUrl,
        headless: this._options.headless,
      });

      await client.launch();
      await client.navigate();
      this._clients.push(client);
    }
  }

  private async _cleanup(): Promise<void> {
    for (const client of this._clients) {
      await client.close();
    }

    this._clients = [];

    if (this._serverProcess) {
      this._serverProcess.kill('SIGTERM');
      this._serverProcess = null;
    }
  }

  private _buildBaseline(metrics: CollectedMetrics): BaselineResult {
    const snapshots = metrics.serverSnapshots;

    if (snapshots.length === 0) {
      return {
        avgTickMs: 0,
        maxTickMs: 0,
        p95TickMs: 0,
        p99TickMs: 0,
        ticksOverBudgetPct: 0,
        avgMemoryMb: 0,
        operations: {},
      };
    }

    const avgTickMs = snapshots.reduce((s, v) => s + v.avgTickMs, 0) / snapshots.length;
    const maxTickMs = Math.max(...snapshots.map(s => s.maxTickMs));
    const p95TickMs = snapshots.reduce((s, v) => s + v.p95TickMs, 0) / snapshots.length;
    const p99TickMs = snapshots.reduce((s, v) => s + v.p99TickMs, 0) / snapshots.length;
    const totalTicks = snapshots.reduce((s, v) => s + v.totalTicks, 0);
    const overBudget = snapshots.reduce((s, v) => s + v.ticksOverBudget, 0);
    const avgMemoryMb = snapshots.reduce((s, v) => s + v.memory.heapUsedMb, 0) / snapshots.length;

    const operations: Record<string, { avgMs: number; p95Ms: number }> = {};
    const opNames = new Set(snapshots.flatMap(s => Object.keys(s.operations)));

    for (const name of opNames) {
      const opSnapshots = snapshots.filter(s => s.operations[name]);

      if (opSnapshots.length > 0) {
        operations[name] = {
          avgMs: opSnapshots.reduce((s, v) => s + v.operations[name].avgMs, 0) / opSnapshots.length,
          p95Ms: opSnapshots.reduce((s, v) => s + v.operations[name].p95Ms, 0) / opSnapshots.length,
        };
      }
    }

    const clientSnapshots = metrics.clientSnapshots;
    const avgFps = clientSnapshots.length > 0
      ? clientSnapshots.reduce((s, v) => s + v.fps, 0) / clientSnapshots.length
      : undefined;

    return {
      avgTickMs,
      maxTickMs,
      p95TickMs,
      p99TickMs,
      ticksOverBudgetPct: totalTicks > 0 ? (overBudget / totalTicks) * 100 : 0,
      avgMemoryMb,
      avgFps,
      operations,
    };
  }

  private _wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
