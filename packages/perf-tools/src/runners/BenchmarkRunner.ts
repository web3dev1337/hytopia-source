import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import HeadlessClient from './HeadlessClient.js';
import MetricCollector, { type CollectedMetrics } from './MetricCollector.js';
import ProcessMonitor, { type ProcessMetrics } from './ProcessMonitor.js';
import ServerApiClient from './ServerApiClient.js';
import WsClient from './WsClient.js';
import { type Scenario, type ScenarioPhase, parseDuration } from './ScenarioLoader.js';
import type { BaselineResult } from './BaselineComparer.js';

export interface BenchmarkRunnerOptions {
  serverCommand?: string;
  serverCwd?: string;
  clientUrl?: string;
  clientDevUrl?: string;
  withClient?: boolean;
  headless?: boolean;
  verbose?: boolean;
  noPerfApi?: boolean;
  logFile?: string;
}

export interface BenchmarkResult {
  scenario: Scenario;
  metrics: CollectedMetrics;
  baseline: BaselineResult;
  processMetrics?: ProcessMetrics;
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
  private _processMonitor: ProcessMonitor;
  private _serverProcess: ChildProcess | null = null;
  private _headlessClient: HeadlessClient | null = null;
  private _serverApi: ServerApiClient;
  private _wsClients: WsClient[] = [];
  private _perfApiAvailable: boolean = true;
  private _logStream: fs.WriteStream | null = null;
  private _log: (msg: string) => void;

  constructor(options?: BenchmarkRunnerOptions) {
    this._options = {
      serverCommand: options?.serverCommand ?? 'npm run build:perf-harness && node src/perf-harness.mjs',
      serverCwd: options?.serverCwd ?? resolveDefaultServerCwd(process.cwd()),
      clientUrl: options?.clientUrl ?? 'https://local.hytopiahosting.com:8080',
      clientDevUrl: options?.clientDevUrl ?? '',
      withClient: options?.withClient ?? false,
      headless: options?.headless ?? true,
      verbose: options?.verbose ?? false,
      noPerfApi: options?.noPerfApi ?? false,
      logFile: options?.logFile ?? '',
    };
    this._collector = new MetricCollector();
    this._processMonitor = new ProcessMonitor();
    this._serverApi = new ServerApiClient(this._options.clientUrl);
    this._perfApiAvailable = !this._options.noPerfApi;
    this._log = this._options.verbose ? console.log : () => {};
  }

  public async run(scenario: Scenario): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const phaseResults: PhaseResult[] = [];

    this._log(`[bench] Starting scenario: ${scenario.name}`);

    let processMetrics: ProcessMetrics | undefined;

    try {
      await this._startServer();

      // start process monitor as soon as server PID is available
      if (this._serverProcess?.pid) {
        this._log(`[bench] Starting process monitor (pid=${this._serverProcess.pid})`);
        this._processMonitor.start(this._serverProcess.pid);
      }

      await this._serverApi.waitForHealthy();

      // Launch headless client if configured
      if (this._options.withClient && this._options.clientDevUrl) {
        try {
          this._log(`[bench] Launching headless client: ${this._options.clientDevUrl}`);

          this._headlessClient = new HeadlessClient({
            url: this._options.clientDevUrl,
            headless: this._options.headless,
          });

          await this._headlessClient.launch();

          // Warm up the self-signed HTTPS cert by visiting the server URL first
          this._log('[bench] Warming up server HTTPS cert in headless browser...');
          await this._headlessClient.warmCert(this._options.clientUrl);

          // Navigate with ?join=<server host> and ?perf=1 (auto-appended by HeadlessClient)
          const serverUrl = new URL(this._options.clientUrl);
          const clientNavUrl = new URL(this._options.clientDevUrl);

          clientNavUrl.searchParams.set('join', serverUrl.host);

          await this._headlessClient.navigate(clientNavUrl.toString());

          const perfReady = await this._headlessClient.waitForPerfReady(30000);

          if (!perfReady) {
            this._log('[bench] WARNING: Client perf bridge not ready after 30s — client metrics may be unavailable');
          } else {
            this._log('[bench] Client perf bridge ready');
          }
        } catch (err: any) {
          this._log(`[bench] WARNING: Headless client failed to launch: ${err?.message ?? err}`);
          this._headlessClient = null;
        }
      }

      // probe PerfHarness availability unless explicitly disabled
      if (this._perfApiAvailable) {
        this._perfApiAvailable = await this._probePerfApi();
        if (!this._perfApiAvailable) {
          this._log('[bench] PerfHarness API unavailable — using OS-level monitoring only');
        }
      }

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
      processMetrics = this._processMonitor.stop();
      await this._cleanup();
    }

    const metrics = this._collector.stopCollecting();
    const baseline = this._buildBaseline(metrics);

    return {
      scenario,
      metrics,
      baseline,
      processMetrics,
      durationMs: Date.now() - startTime,
      phaseResults,
    };
  }

  private async _runPhase(phase: ScenarioPhase): Promise<PhaseResult> {
    const startTime = Date.now();

    this._log(`[bench] Phase: ${phase.name}`);

    if (phase.collect) {
      if (this._perfApiAvailable) {
        try {
          await this._serverApi.reset();
        } catch {
          this._log('[bench] PerfHarness reset failed — continuing without it');
          this._perfApiAvailable = false;
        }
      }
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
              worldId: typeof action.worldId === 'number' ? action.worldId : undefined,
            });
            break;
          case 'generate_blocks':
            await this._serverApi.action({
              type: 'generate_blocks',
              blockCount: action.blockCount ?? 0,
              blockTypeId: action.blockTypeId ?? 1,
              worldId: typeof action.worldId === 'number' ? action.worldId : undefined,
              layout: action.layout,
              slabHeight: action.slabHeight,
              origin: action.origin,
              clear: action.clear,
            });
            break;
          case 'spawn_entities':
            await this._serverApi.action({
              type: 'spawn_entities',
              count: action.count ?? 0,
              kind: action.kind,
              options: action.options,
              tag: action.tag,
            });
            break;
          case 'despawn_entities':
            await this._serverApi.action({
              type: 'despawn_entities',
              tag: action.tag,
            });
            break;
          case 'start_block_churn':
            await this._serverApi.action({
              type: 'start_block_churn',
              blocksPerTick: action.blocksPerTick ?? 0,
              blockTypeId: action.blockTypeId ?? 0,
              mode: action.mode,
              min: action.min,
              max: action.max,
            });
            break;
          case 'stop_block_churn':
            await this._serverApi.action({
              type: 'stop_block_churn',
            });
            break;
          case 'create_worlds':
            await this._serverApi.action({
              type: 'create_worlds',
              count: action.count ?? 0,
              mapPath: action.mapPath,
              setDefault: action.setDefault,
            });
            break;
          case 'set_default_world':
            await this._serverApi.action({
              type: 'set_default_world',
              worldId: action.worldId ?? 0,
            });
            break;
          case 'clear_world':
            await this._serverApi.action({
              type: 'clear_world',
            });
            break;
          case 'connect_clients':
            await this._launchWsClients(action.count ?? 0, action.staggerMs);
            break;
          case 'disconnect_clients':
            await this._disconnectWsClients(action.count);
            break;
          case 'custom':
            throw new Error(`Action not supported yet: ${action.type}`);
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

      if (this._perfApiAvailable) {
        try {
          const snapshot = await this._serverApi.snapshot();
          this._collector.addServerSnapshot(snapshot);
        } catch {
          this._log('[bench] PerfHarness snapshot failed — falling back to OS-only');
          this._perfApiAvailable = false;
        }
      }

      if (this._headlessClient?.isConnected) {
        try {
          const clientSnapshot = await this._headlessClient.collectClientMetrics();

          if (clientSnapshot) {
            this._collector.addClientSnapshot(clientSnapshot);
          }
        } catch {
          this._log('[bench] Client metric collection failed');
        }
      }
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

    const useLogFile = this._options.logFile && !this._options.verbose;

    if (useLogFile) {
      const logDir = path.dirname(this._options.logFile);
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      this._logStream = fs.createWriteStream(this._options.logFile, { flags: 'w' });
    }

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

    if (this._logStream && this._serverProcess.stdout) {
      this._serverProcess.stdout.pipe(this._logStream);
    }

    if (this._logStream && this._serverProcess.stderr) {
      this._serverProcess.stderr.pipe(this._logStream);
    }
  }

  private async _launchWsClients(count: number, staggerMs?: number): Promise<void> {
    const wsUrl = toWebSocketUrl(this._options.clientUrl);

    this._log(`[bench] Launching ${count} WebSocket client(s): ${wsUrl}`);

    const delayMs = typeof staggerMs === 'number' ? Math.max(0, Math.floor(staggerMs)) : 0;

    if (delayMs > 0) {
      for (let i = 0; i < count; i++) {
        const client = new WsClient({ url: wsUrl });
        await client.connect();
        this._wsClients.push(client);

        if (i < count - 1) {
          // eslint-disable-next-line no-await-in-loop
          await this._wait(delayMs);
        }
      }

      return;
    }

    const batchSize = 25;

    for (let offset = 0; offset < count; offset += batchSize) {
      const batchCount = Math.min(batchSize, count - offset);
      const batchClients: WsClient[] = [];

      for (let i = 0; i < batchCount; i++) {
        batchClients.push(new WsClient({ url: wsUrl }));
      }

      await Promise.all(batchClients.map(async client => {
        await client.connect();
        this._wsClients.push(client);
      }));
    }
  }

  private async _disconnectWsClients(count?: number): Promise<void> {
    if (count === undefined) {
      for (const client of this._wsClients) {
        await client.close();
      }

      this._wsClients = [];
      return;
    }

    const target = Math.max(0, Math.floor(count));

    for (let i = 0; i < target && this._wsClients.length > 0; i++) {
      const client = this._wsClients.pop()!;
      await client.close();
    }
  }

  private async _probePerfApi(): Promise<boolean> {
    try {
      await this._serverApi.snapshot();
      return true;
    } catch {
      return false;
    }
  }

  private async _cleanup(): Promise<void> {
    if (this._headlessClient) {
      await this._headlessClient.close();
      this._headlessClient = null;
    }

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

    if (this._logStream) {
      this._logStream.end();
      this._logStream = null;
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

    const client = clientSnapshots.length > 0
      ? {
          avgFps: average(clientSnapshots, s => s.fps),
          minFps: Math.min(...clientSnapshots.map(s => s.fps)),
          avgFrameTimeMs: average(clientSnapshots, s => s.frameTimeMs),
          avgDrawCalls: average(clientSnapshots, s => s.drawCalls),
          maxDrawCalls: max(clientSnapshots, s => s.drawCalls),
          avgTriangles: average(clientSnapshots, s => s.triangles),
          maxTriangles: max(clientSnapshots, s => s.triangles),
          avgGeometries: average(clientSnapshots, s => s.geometries ?? 0),
          avgEntities: average(clientSnapshots, s => s.entities?.count ?? 0),
          avgVisibleChunks: average(clientSnapshots, s => s.chunks?.visible ?? 0),
          avgUsedMemoryMb: average(clientSnapshots, s => s.usedMemoryMb ?? 0),
        }
      : undefined;

    const avgFps = clientSnapshots.length > 0
      ? clientSnapshots.reduce((s, v) => s + v.fps, 0) / clientSnapshots.length
      : undefined;

    const networkSnapshots = snapshots.flatMap(s => (s.network ? [ s.network ] : []));
    const network = networkSnapshots.length > 0
      ? {
          totalBytesSent: Math.max(...networkSnapshots.map(s => s.bytesSentTotal)),
          totalBytesReceived: Math.max(...networkSnapshots.map(s => s.bytesReceivedTotal)),
          maxConnectedPlayers: Math.max(...networkSnapshots.map(s => s.connectedPlayers)),
          avgBytesSentPerSecond: average(networkSnapshots, s => s.bytesSentPerSecond),
          maxBytesSentPerSecond: max(networkSnapshots, s => s.bytesSentPerSecond),
          avgBytesReceivedPerSecond: average(networkSnapshots, s => s.bytesReceivedPerSecond),
          maxBytesReceivedPerSecond: max(networkSnapshots, s => s.bytesReceivedPerSecond),
          avgPacketsSentPerSecond: average(networkSnapshots, s => s.packetsSentPerSecond),
          maxPacketsSentPerSecond: max(networkSnapshots, s => s.packetsSentPerSecond),
          avgPacketsReceivedPerSecond: average(networkSnapshots, s => s.packetsReceivedPerSecond),
          maxPacketsReceivedPerSecond: max(networkSnapshots, s => s.packetsReceivedPerSecond),
          avgSerializationMs: average(networkSnapshots, s => s.avgSerializationMs),
          compressionCountTotal: Math.max(...networkSnapshots.map(s => s.compressionCount)),
        }
      : undefined;

    return {
      avgTickMs,
      maxTickMs,
      p95TickMs,
      p99TickMs,
      ticksOverBudgetPct: totalTicks > 0 ? (overBudget / totalTicks) * 100 : 0,
      avgMemoryMb,
      avgFps,
      client,
      operations,
      network,
    };
  }

  private _wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function average<T>(items: T[], get: (item: T) => number): number {
  if (items.length === 0) return 0;

  return items.reduce((s, v) => s + get(v), 0) / items.length;
}

function max<T>(items: T[], get: (item: T) => number): number {
  if (items.length === 0) return 0;

  return Math.max(...items.map(get));
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
