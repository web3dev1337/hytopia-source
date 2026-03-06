import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProcessSnapshot {
  timestamp: number;
  cpuPct: number;
  rssMb: number;
  threads: number;
  fds: number;
}

export interface ProcessMetrics {
  snapshots: ProcessSnapshot[];
  avgCpuPct: number;
  maxCpuPct: number;
  avgRssMb: number;
  maxRssMb: number;
  maxThreads: number;
  maxFds: number;
}

interface ProcStatSample {
  utime: number;
  stime: number;
  wallMs: number;
}

export default class ProcessMonitor {
  private _pid: number = 0;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _snapshots: ProcessSnapshot[] = [];
  private _lastSample: ProcStatSample | null = null;
  private _clockTick: number;

  constructor() {
    this._clockTick = 100; // sysconf(_SC_CLK_TCK) default on Linux
  }

  public start(pid: number, intervalMs: number = 1000): void {
    this._pid = pid;
    this._snapshots = [];
    this._lastSample = null;

    this._takeSample(); // prime the CPU delta baseline

    this._interval = setInterval(() => {
      try {
        const snapshot = this._collect();
        if (snapshot) this._snapshots.push(snapshot);
      } catch {
        // process may have exited
      }
    }, intervalMs);
  }

  public stop(): ProcessMetrics {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    // one final collection
    try {
      const snapshot = this._collect();
      if (snapshot) this._snapshots.push(snapshot);
    } catch {
      // ignore
    }

    return this._summarize();
  }

  private _collect(): ProcessSnapshot | null {
    const stat = this._takeSample();
    if (!stat || !this._lastSample) return null;

    const cpuPct = this._calcCpuPct(this._lastSample, stat);
    const rssMb = this._readRssMb();
    const threads = this._readThreads();
    const fds = this._countFds();

    this._lastSample = stat;

    return { timestamp: Date.now(), cpuPct, rssMb, threads, fds };
  }

  private _takeSample(): ProcStatSample | null {
    try {
      const raw = fs.readFileSync(`/proc/${this._pid}/stat`, 'utf-8');
      // fields: pid (comm) state ppid ... utime(14) stime(15)
      // comm can contain spaces/parens, so find the closing ')' first
      const closeParen = raw.lastIndexOf(')');
      const fields = raw.slice(closeParen + 2).split(' ');
      // fields[0] = state, fields[11] = utime (index 13 in full, but 11 after state)
      const utime = parseInt(fields[11], 10);
      const stime = parseInt(fields[12], 10);

      const sample: ProcStatSample = { utime, stime, wallMs: Date.now() };
      if (!this._lastSample) this._lastSample = sample;
      return sample;
    } catch {
      return null;
    }
  }

  private _calcCpuPct(prev: ProcStatSample, cur: ProcStatSample): number {
    const wallDeltaS = (cur.wallMs - prev.wallMs) / 1000;
    if (wallDeltaS <= 0) return 0;

    const cpuDeltaTicks = (cur.utime + cur.stime) - (prev.utime + prev.stime);
    const cpuDeltaS = cpuDeltaTicks / this._clockTick;

    return (cpuDeltaS / wallDeltaS) * 100;
  }

  private _readRssMb(): number {
    try {
      const raw = fs.readFileSync(`/proc/${this._pid}/status`, 'utf-8');
      const match = raw.match(/VmRSS:\s+(\d+)\s+kB/);
      return match ? parseInt(match[1], 10) / 1024 : 0;
    } catch {
      return 0;
    }
  }

  private _readThreads(): number {
    try {
      const raw = fs.readFileSync(`/proc/${this._pid}/status`, 'utf-8');
      const match = raw.match(/Threads:\s+(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  private _countFds(): number {
    try {
      return fs.readdirSync(`/proc/${this._pid}/fd`).length;
    } catch {
      return 0;
    }
  }

  private _summarize(): ProcessMetrics {
    const snapshots = this._snapshots;

    if (snapshots.length === 0) {
      return { snapshots: [], avgCpuPct: 0, maxCpuPct: 0, avgRssMb: 0, maxRssMb: 0, maxThreads: 0, maxFds: 0 };
    }

    return {
      snapshots,
      avgCpuPct: snapshots.reduce((s, v) => s + v.cpuPct, 0) / snapshots.length,
      maxCpuPct: Math.max(...snapshots.map(s => s.cpuPct)),
      avgRssMb: snapshots.reduce((s, v) => s + v.rssMb, 0) / snapshots.length,
      maxRssMb: Math.max(...snapshots.map(s => s.rssMb)),
      maxThreads: Math.max(...snapshots.map(s => s.threads)),
      maxFds: Math.max(...snapshots.map(s => s.fds)),
    };
  }
}
