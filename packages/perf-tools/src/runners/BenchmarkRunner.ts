import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import MetricCollector, { type CollectedMetrics } from './MetricCollector.js';
import ServerApiClient from './ServerApiClient.js';
import WsClient from './WsClient.js';
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
  private _serverApi: ServerApiClient;
  private _wsClients: WsClient[] = [];
  private _log: (msg: string) => void;

  constructor(options?: BenchmarkRunnerOptions) {
    this._options = {
      serverCommand: options?.serverCommand ?? 'npm run build:perf-harness && node src/perf-harness.mjs',
      serverCwd: options?.serverCwd ?? resolveDefaultServerCwd(process.cwd()),
      clientUrl: options?.clientUrl ?? 'https://local.hytopiahosting.com:8080',
      headless: options?.headless ?? true,
      verbose: options?.verbose ?? false,
    };
    this._collector = new MetricCollector();
    this._serverApi = new ServerApiClient(this._options.clientUrl);
    this._log = this._options.verbose ? console.log : () => {};
  }

  public async run(scenario: Scenario): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const phaseResults: PhaseResult[] = [];

    this._log(`[bench] Starting scenario: ${scenario.name}`);

    try {
      await this._startServer();
      await this._serverApi.waitForHealthy();

      if (scenario.clients && scenario.clients > 0) {
        await this._launchWsClients(scenario.clients);
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
      await this._serverApi.reset();
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
            await this._serverApi.action({
              type: 'spawn_bots',
              count: action.count ?? 0,
              behavior: action.behavior,
            });
            break;
          case 'despawn_bots':
            await this._serverApi.action({
              type: 'despawn_bots',
              count: action.count,
            });
            break;
          case 'load_map':
            await this._serverApi.action({
              type: 'load_map',
              mapPath: action.mapPath ?? '',
            });
            break;
          case 'spawn_entities':
          case 'custom':
            throw new Error(`Action not supported yet: ${action.type}`);
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
    if (!this._collector.isCollecting) {
      await this._wait(durationMs);
      return;
    }

    const intervalMs = 1000;
    const intervals = Math.ceil(durationMs / intervalMs);

    for (let i = 0; i < intervals; i++) {
      const remaining = Math.min(intervalMs, durationMs - i * intervalMs);

      await this._wait(remaining);

      const snapshot = await this._serverApi.snapshot();
      this._collector.addServerSnapshot(snapshot);
    }
  }

  private async _startServer(): Promise<void> {
    const baseUrl = new URL(this._options.clientUrl);
    const startPort = baseUrl.port ? Number(baseUrl.port) : (baseUrl.protocol === 'https:' ? 443 : 80);
    const port = await pickAvailablePort(startPort);
    const finalUrl = new URL(this._options.clientUrl);

    finalUrl.port = String(port);
    this._options.clientUrl = finalUrl.toString();
    this._serverApi = new ServerApiClient(this._options.clientUrl);

    this._log(`[bench] Starting server (cwd=${this._options.serverCwd}): ${this._options.serverCommand}`);
    this._log(`[bench] Using server URL: ${this._options.clientUrl}`);

    this._serverProcess = spawn(this._options.serverCommand, {
      cwd: this._options.serverCwd,
      shell: true,
      detached: true,
      stdio: this._options.verbose ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        HYTOPIA_PERF_TOOLS: '1',
        NODE_ENV: 'production',
        PORT: String(port),
      },
    });
  }

  private async _launchWsClients(count: number): Promise<void> {
    const wsUrl = toWebSocketUrl(this._options.clientUrl);

    this._log(`[bench] Launching ${count} WebSocket client(s): ${wsUrl}`);

    for (let i = 0; i < count; i++) {
      const client = new WsClient({ url: wsUrl });
      await client.connect();
      this._wsClients.push(client);
    }
  }

  private async _cleanup(): Promise<void> {
    for (const client of this._wsClients) {
      await client.close();
    }

    this._wsClients = [];

    if (this._serverProcess) {
      const pid = this._serverProcess.pid;

      try {
        if (pid) {
          process.kill(-pid, 'SIGTERM');
        } else {
          this._serverProcess.kill('SIGTERM');
        }
      } catch {
        this._serverProcess.kill('SIGTERM');
      }

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

function resolveDefaultServerCwd(startDir: string): string {
  let dir = startDir;

  for (let i = 0; i < 8; i++) {
    const serverPkg = path.join(dir, 'server', 'package.json');

    if (fs.existsSync(serverPkg)) {
      return path.join(dir, 'server');
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.join(startDir, 'server');
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function pickAvailablePort(startPort: number): Promise<number> {
  const minPort = Math.max(1, Math.floor(startPort));

  for (let port = minPort; port < minPort + 50; port++) {
    // eslint-disable-next-line no-await-in-loop
    const available = await canListen(port);
    if (available) return port;
  }

  throw new Error(`No available port found (starting from ${startPort})`);
}

async function canListen(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = net.createServer();

    server.unref();

    server.once('error', () => {
      resolve(false);
    });

    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}
